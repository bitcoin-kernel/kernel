// SwiftSync block undo / "spent coins" (BIP "Peer sharing of block spent coins").
// For the full (non-assumevalid) variant, validating a block statelessly needs,
// per spent input, the prevout's height, coinbase flag, script, and amount. This
// is Bitcoin Core's undo data, re-serialized compactly for the wire:
//   - amount  → CompressAmount (Core's algorithm) then CompactSize
//   - script  → reconstructable-script prefix table (P2PKH/P2SH/P2PK/P2WPKH/P2WSH/P2TR, else raw)
//   - height+coinbase → a single "height code" (height << 1 | coinbase)
// The amount and script compressions are validated byte-for-byte against the
// BIP's compressed_amount.json / reconstructable_script.json vectors.

import { concat, compactSize, readCompactSize } from './varint.js';

const hb = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
const bh = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---- amount (Bitcoin Core CompressAmount / DecompressAmount), BigInt-safe ----
export function compressAmount(n) {
  n = BigInt(n);
  if (n === 0n) return 0n;
  let e = 0n;
  while (n % 10n === 0n && e < 9n) { n /= 10n; e++; }
  if (e < 9n) { const d = n % 10n; n /= 10n; return 1n + (n * 9n + d - 1n) * 10n + e; }
  return 1n + (n - 1n) * 10n + 9n;
}
export function decompressAmount(x) {
  x = BigInt(x);
  if (x === 0n) return 0n;
  x -= 1n;
  let e = x % 10n; x /= 10n;
  let n;
  if (e < 9n) { const d = (x % 9n) + 1n; x /= 9n; n = x * 10n + d; }
  else n = x + 1n;
  while (e > 0n) { n *= 10n; e--; }
  return n;
}

// ---- reconstructable script ----
export function compressScript(spkHex) {
  let m;
  if ((m = /^76a914([0-9a-f]{40})88ac$/.exec(spkHex))) return hb('01' + m[1]); // P2PKH
  if ((m = /^a914([0-9a-f]{40})87$/.exec(spkHex)))      return hb('05' + m[1]); // P2SH
  if ((m = /^0014([0-9a-f]{40})$/.exec(spkHex)))        return hb('07' + m[1]); // P2WPKH
  if ((m = /^0020([0-9a-f]{64})$/.exec(spkHex)))        return hb('06' + m[1]); // P2WSH
  if ((m = /^5120([0-9a-f]{64})$/.exec(spkHex)))        return hb('08' + m[1]); // P2TR
  if ((m = /^21(0[23])([0-9a-f]{64})ac$/.exec(spkHex))) return hb(m[1] + m[2]); // P2PK compressed (prefix = parity)
  if ((m = /^4104([0-9a-f]{128})ac$/.exec(spkHex)))     return hb('04' + m[1]); // P2PK uncompressed
  const raw = hb(spkHex);                                                       // unknown
  return concat([Uint8Array.of(0x00), compactSize(raw.length), raw]);
}
export function expandScript(bytes) {
  const p = bytes[0], rest = bh(bytes.subarray(1));
  switch (p) {
    case 0x01: return '76a914' + rest + '88ac';
    case 0x05: return 'a914' + rest + '87';
    case 0x07: return '0014' + rest;
    case 0x06: return '0020' + rest;
    case 0x08: return '5120' + rest;
    case 0x02: case 0x03: return '21' + p.toString(16).padStart(2, '0') + rest + 'ac';
    case 0x04: return '4104' + rest + 'ac';
    case 0x00: { const [len, off] = readCompactSize(bytes, 1); return bh(bytes.subarray(off, off + len)); }
    default: throw new Error('unknown reconstructable-script prefix 0x' + p.toString(16));
  }
}

// ---- height code (height << 1 | coinbase) ----
export const encodeHeightCode = (height, coinbase) => (height << 1) | (coinbase ? 1 : 0);
export const decodeHeightCode = (code) => ({ height: code >>> 1, coinbase: (code & 1) === 1 });

// ---- a spent coin record ----
// { inputIndex, height, coinbase, scriptPubKey, amount } -> Uint8Array
export function encodeCoin({ inputIndex, height, coinbase, scriptPubKey, amount }) {
  const head = new Uint8Array(8); const dv = new DataView(head.buffer);
  dv.setUint32(0, inputIndex, true);
  dv.setUint32(4, encodeHeightCode(height, coinbase), true);
  return concat([head, compressScript(scriptPubKey), compactSize(Number(compressAmount(amount)))]);
}
export function decodeCoin(bytes, off = 0) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const inputIndex = dv.getUint32(off, true);
  const { height, coinbase } = decodeHeightCode(dv.getUint32(off + 4, true));
  off += 8;
  // script: peek prefix to find its length
  const p = bytes[off];
  let scriptLen;
  if (p === 0x00) { const [l, o] = readCompactSize(bytes, off + 1); scriptLen = (o - (off + 1)) + 1 + l; }
  else scriptLen = 1 + ({ 0x01: 20, 0x05: 20, 0x07: 20, 0x06: 32, 0x08: 32, 0x02: 32, 0x03: 32, 0x04: 64 }[p]);
  const scriptPubKey = expandScript(bytes.subarray(off, off + scriptLen));
  off += scriptLen;
  const [ca, o2] = readCompactSize(bytes, off);
  return [{ inputIndex, height, coinbase, scriptPubKey, amount: decompressAmount(ca) }, o2];
}
