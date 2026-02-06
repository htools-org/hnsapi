import BloomFilter from './BloomFilter';
import {assert} from 'chai';

describe('BloomFilter', () => {
  it('should properly check for membership and serialize', () => {
    const bloom = new BloomFilter(1678, 23);

    const incBufs = [
      Buffer.from('test string', 'utf-8'),
      Buffer.from([0x01, 0x02, 0x03]),
      Buffer.alloc(32),
    ];
    for (const buf of incBufs) {
      bloom.add(buf);
    }
    for (const buf of incBufs) {
      assert.isTrue(bloom.contains(buf));
    }

    const exclBufs = [
      Buffer.alloc(32, 1),
      Buffer.from('another test string', 'utf-8'),
      Buffer.from([0x03, 0x02, 0x01])
    ];
    for (const buf of exclBufs) {
      assert.isFalse(bloom.contains(buf));
    }

    assert.equal(
      bloom.toBuffer().toString('hex'),
      '000000000000068e0000000000000017' +
      '000000000000068e4000000280000080' +
      '00000800000000020008000000000000' +
      '00048000000000000810000008400000' +
      '00000000004000000002000000000000' +
      '00008080400080000000001001010002' +
      '00004000000000000000002000200000' +
      '00000202001002000002008000040400' +
      '00000800000000000000002000000040' +
      '00000808000000000020208000001020' +
      '00902200000000000000000042000000' +
      '00000000000000000002000000000100' +
      '10080000000020040008000000800000' +
      '00000081000000000000000400000200' +
      '08800020080000000000000000000000'
    );
  });
});