const WORD_SIZE = 64;

const LOG2_WORD_SIZE = 6;

export default class BitSet {
  private readonly length: number;

  private words: bigint[];

  constructor(length: number) {
    this.length = length;
    this.words = [];
    for (let i = 0; i < this.wordsNeeded(length); i++) {
      this.words.push(BigInt(0));
    }
  }

  set(i: number) {
    this.words[i >> LOG2_WORD_SIZE] |=
      BigInt(1) << (BigInt(i) & BigInt(WORD_SIZE - 1));
  }

  test(i: number): boolean {
    if (i >= this.length) {
      return false;
    }

    return (
      (this.words[i >> LOG2_WORD_SIZE] &
        (BigInt(1) << (BigInt(i) & BigInt(WORD_SIZE - 1)))) !==
      BigInt(0)
    );
  }

  toBuffer(): Buffer {
    // 8 * numwords + 8 for the length
    const buf = new ArrayBuffer(8 * this.words.length + 8);
    const view = new DataView(buf);
    view.setBigUint64(0, BigInt(this.length));
    for (let i = 0; i < this.words.length; i++) {
      view.setBigUint64(i * 8 + 8, this.words[i]);
    }
    return Buffer.from(buf);
  }

  private wordsNeeded(i: number): number {
    return (i + WORD_SIZE - 1) >> LOG2_WORD_SIZE;
  }
}
