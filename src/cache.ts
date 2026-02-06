import redis, {RedisClient} from 'redis';
import {gzip, ungzip} from 'node-gzip';

export interface Cache {
  getKey (key: string): Promise<any>

  setKey (key: string, value: any, expiry: number): Promise<void>
}

export const BLOCK_HEIGHT_KEY = 'block_height';

export class RedisCache implements Cache {
  private redis: RedisClient;

  constructor (url: string) {
    this.redis = redis.createClient({
      url,
      return_buffers: true
    });
  }

  getKey (key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.redis.get(key, (err, res) => {
        if (err) {
          return reject(err);
        }

        if (res === null) {
          return resolve(null);
        }

        ungzip(res)
          .then((uncompressed) => resolve(JSON.parse(uncompressed.toString('utf-8'))))
          .catch(reject);
      });
    });
  }

  setKey (key: string, value: any, expiry: number): Promise<void> {
    return new Promise((resolve, reject) => {
      gzip(JSON.stringify(value)).then((compressed) => {
        this.redis.setex(key, expiry, compressed as any, (err) => {
          if (err) {
            return reject(err);
          }
          return resolve();
        });
      }).catch(reject);
    });
  }
}