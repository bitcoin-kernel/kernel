// SwiftSync hintsfile (BIP "Hints for unspent coins") — the ONE cross-compatible
// artifact (per Somsen): a compact list, per block, of which output indices remain
// unspent at the target height, so a SwiftSync client knows what to keep.
//
// Per block the unspent indices form a monotonically increasing set, encoded with
// Elias-Fano. For a set { i0..i_{n-1} } with m = i_{n-1}:
//   ℓ = floor(log2((m+1)/n))                       low bits per element
//   L = each element's ℓ low bits, LSB-first, packed MSB-first into bytes
//   H = unary of the gaps between successive high parts (high = value >> ℓ)
//   encoding = CompactSize(n) ‖ CompactSize(m) ‖ L ‖ H
// H is self-delimiting: it holds exactly n ones and (m >> ℓ) zeros, so an encoding
// can be parsed without an explicit length. Validated byte-for-byte against the
// BIP's elias_fano.json test vectors.

const concat = (arrs) => { const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

function compactSize(n) {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  if (n <= 0xffffffff) { const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b; }
  const b = new Uint8Array(9); b[0] = 0xff; new DataView(b.buffer).setBigUint64(1, BigInt(n), true); return b;
}
function readCompactSize(b, off) {
  const f = b[off];
  if (f < 0xfd) return [f, off + 1];
  const dv = new DataView(b.buffer, b.byteOffset);
  if (f === 0xfd) return [dv.getUint16(off + 1, true), off + 3];
  if (f === 0xfe) return [dv.getUint32(off + 1, true), off + 5];
  return [Number(dv.getBigUint64(off + 1, true)), off + 9];
}

// MSB-first bit packing (first bit → high bit of byte 0).
class BitWriter {
  constructor() { this.bits = []; }
  push(b) { this.bits.push(b & 1); return this; }
  bytes() { const o = new Uint8Array(Math.ceil(this.bits.length / 8)); for (let i = 0; i < this.bits.length; i++) if (this.bits[i]) o[i >> 3] |= 1 << (7 - (i & 7)); return o; }
}
class BitReader {
  constructor(b, bitOff = 0) { this.b = b; this.i = bitOff; }
  next() { const byte = this.b[this.i >> 3] || 0; const bit = (byte >> (7 - (this.i & 7))) & 1; this.i++; return bit; }
}

const lowBitsFor = (n, m) => { let l = 0; while (n * 2 ** (l + 1) <= m + 1) l++; return l; };

// seq: monotonically increasing non-negative integers. -> Uint8Array
export function eliasFanoEncode(seq) {
  const n = seq.length;
  if (n === 0) return compactSize(0);
  const m = seq[n - 1];
  const l = lowBitsFor(n, m);
  const L = new BitWriter();
  for (const x of seq) { const low = x & ((1 << l) - 1); for (let b = 0; b < l; b++) L.push((low >> b) & 1); } // LSB-first
  const H = new BitWriter();
  let prevHigh = 0;
  for (const x of seq) { const high = Math.floor(x / 2 ** l); for (let z = 0; z < high - prevHigh; z++) H.push(0); H.push(1); prevHigh = high; }
  return concat([compactSize(n), compactSize(m), L.bytes(), H.bytes()]);
}

// Decode one Elias-Fano encoding starting at off. -> [seq, nextOffset]
export function eliasFanoDecode(bytes, off = 0) {
  let n; [n, off] = readCompactSize(bytes, off);
  if (n === 0) return [[], off];
  let m; [m, off] = readCompactSize(bytes, off);
  const l = lowBitsFor(n, m);
  const Llen = Math.ceil((n * l) / 8);
  const Lr = new BitReader(bytes.subarray(off, off + Llen));
  off += Llen;
  const lows = [];
  for (let i = 0; i < n; i++) { let low = 0; for (let b = 0; b < l; b++) low |= Lr.next() << b; lows.push(low); } // LSB-first
  const Hbits = n + Math.floor(m / 2 ** l);          // n ones + (m>>l) zeros
  const Hlen = Math.ceil(Hbits / 8);
  const Hr = new BitReader(bytes.subarray(off, off + Hlen));
  off += Hlen;
  const seq = [];
  let high = 0;
  for (let i = 0; i < n; i++) { let gap = 0; while (Hr.next() === 0) gap++; high += gap; seq.push(high * 2 ** l + lows[i]); }
  return [seq, off];
}

// ---- hintsfile container ----
const MAGIC = Uint8Array.of(0x55, 0x54, 0x58, 0x4f); // "UTXO"

// blockHints: array (one per block) of unspent output-index arrays.
export function encodeHintsfile({ height, blockHints }) {
  const head = new Uint8Array(5); head.set(MAGIC, 0); head[4] = 0x00; // version
  const h = new Uint8Array(4); new DataView(h.buffer).setUint32(0, height, true);
  return concat([head, h, compactSize(blockHints.length), ...blockHints.map(eliasFanoEncode)]);
}

export function decodeHintsfile(bytes) {
  if (!MAGIC.every((b, i) => bytes[i] === b)) throw new Error('bad hintsfile magic');
  if (bytes[4] !== 0x00) throw new Error('unsupported hintsfile version');
  const height = new DataView(bytes.buffer, bytes.byteOffset).getUint32(5, true);
  let [count, off] = readCompactSize(bytes, 9);
  const blockHints = [];
  for (let i = 0; i < count; i++) { let seq; [seq, off] = eliasFanoDecode(bytes, off); blockHints.push(seq); }
  return { height, blockHints };
}
