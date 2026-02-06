// MurmurHash bloom filter
// taken from https://github.com/bits-and-blooms/bloom/blob/master/bloom.go.

import murmur from 'murmurhash-native/stream';
import BitSet from './BitSet';

export default class BloomFilter {
  private readonly m: number;

  private readonly k: number;

  private vector: BitSet;

  constructor(m: number, k: number) {
    this.m = m;
    this.k = k;

    this.vector = new BitSet(m);
  }

  add(value: Buffer): void {
    const hashes = this.baseHashes(value);
    for (let i = 0; i < this.k; i++) {
      this.vector.set(this.location(hashes, i));
    }
  }

  contains(value: Buffer) {
    const hashes = this.baseHashes(value);
    for (let i = 0; i < this.k; i++) {
      if (!this.vector.test(this.location(hashes, i))) {
        return false;
      }
    }
    return true;
  }

  toBuffer(): Buffer {
    const bitSetBuf = this.vector.toBuffer();
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setBigUint64(0, BigInt(this.m), false);
    view.setBigUint64(8, BigInt(this.k), false);
    return Buffer.concat([Buffer.from(buf), bitSetBuf]);
  }

  private baseHashes(value: Buffer): bigint[] {
    const hasher = murmur.createHash('murmurhash128');
    const b0 = hasher.update(value).digest('buffer') as Buffer;
    const b1 = hasher.update(Buffer.from([0x01])).digest('buffer') as Buffer;
    return [
      BigInt('0x' + b0.slice(0, 8).toString('hex')),
      BigInt('0x' + b0.slice(8).toString('hex')),
      BigInt('0x' + b1.slice(0, 8).toString('hex')),
      BigInt('0x' + b1.slice(8).toString('hex')),
    ];
  }

  private location(hashes: bigint[], i: number): number {
    const base =
      (hashes[i % 2] + BigInt(i) * hashes[2 + ((i + (i % 2)) % 4) / 2]) %
      BigInt(0xffffffffffffffff);
    return Number(base % BigInt(this.m));
  }
}

export interface RecommendedBloomSize {
  m: number;
  k: number;
}

export function getBloomSize(txCount: number): RecommendedBloomSize {
  if (txCount < 10) {
    return {
      m: 1007,
      k: 23,
    };
  }
  if (txCount < 100) {
    return {
      m: 5572,
      k: 13,
    };
  }
  if (txCount < 250) {
    return {
      m: 14378,
      k: 13,
    };
  }
  if (txCount < 500) {
    return {
      m: 28576,
      k: 13,
    };
  }
  if (txCount < 1000) {
    return {
      m: 57511,
      k: 13,
    };
  }
  return {
    m: 76681,
    k: 13,
  };
}
