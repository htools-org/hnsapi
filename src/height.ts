import {Backend} from './client';
import {BLOCK_HEIGHT_KEY, Cache} from './cache';

let lock: Promise<number> | null = null;

export default function getHeight (backend: Backend, cache: Cache): Promise<number> {
  if (lock) {
    return lock;
  }

  lock = new Promise<number>((resolve, reject) => doGetHeight(backend, cache)
    .then((height) => {
      lock = null;
      resolve(height);
    })
    .catch((err) => {
      lock = null;
      reject(err);
    }));
  return lock;
}

async function doGetHeight (backend: Backend, cache: Cache): Promise<number> {
  let height = await cache.getKey(BLOCK_HEIGHT_KEY) as number | null;
  if (!height) {
    const heightRes = await backend.execRpc('getblockcount', []);
    if (heightRes.error) {
      throw new Error('Error getting block height, bailing out.');
    }
    height = heightRes.result;
    await cache.setKey(BLOCK_HEIGHT_KEY, height, 10);
  }
  return height!;
}