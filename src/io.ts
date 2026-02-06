export function uint32LEBuf(input: number): Buffer {
  const arr = new ArrayBuffer(4);
  const dv = new DataView(arr);
  dv.setUint32(0, input, true);
  return Buffer.from(arr);
}