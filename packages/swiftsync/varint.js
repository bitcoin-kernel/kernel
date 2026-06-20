// Shared serialization helpers: Bitcoin CompactSize + byte concat.

export const concat = (arrs) => { const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

export function compactSize(n) {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) { const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b; }
  const b = new Uint8Array(9); b[0] = 0xff; new DataView(b.buffer).setBigUint64(1, BigInt(n), true); return b;
}

export function readCompactSize(b, off) {
  const f = b[off];
  if (f < 0xfd) return [f, off + 1];
  const dv = new DataView(b.buffer, b.byteOffset);
  if (f === 0xfd) return [dv.getUint16(off + 1, true), off + 3];
  if (f === 0xfe) return [dv.getUint32(off + 1, true), off + 5];
  return [Number(dv.getBigUint64(off + 1, true)), off + 9];
}
