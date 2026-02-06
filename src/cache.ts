import { createClient, type RedisClientType } from 'redis';
import nodeGzip from 'node-gzip';

export interface Cache {
  getKey(key: string): Promise<any>;

  setKey(key: string, value: any, expiry: number): Promise<void>;
}

export const BLOCK_HEIGHT_KEY = 'block_height';

export class RedisCache implements Cache {
  private redis: RedisClientType;
  private ready: Promise<void>;

  constructor(url: string) {
    this.redis = createClient({ url });
    this.redis.on('error', (err) => {
      console.error('Redis client error:', err);
    });
    this.ready = this.redis.connect().then(() => undefined);
  }

  async getKey(key: string): Promise<any> {
    await this.ready;
    const res = (await this.redis.get(key)) as string | null;
    if (res === null) {
      return null;
    }

    const uncompressed = await nodeGzip.ungzip(Buffer.from(res, 'base64'));
    return JSON.parse(uncompressed.toString('utf-8'));
  }

  async setKey(key: string, value: any, expiry: number): Promise<void> {
    await this.ready;
    const compressed = await nodeGzip.gzip(JSON.stringify(value));
    await this.redis.setEx(key, expiry, compressed.toString('base64'));
  }
}
