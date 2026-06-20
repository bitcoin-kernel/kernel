// @bitcoin-kernel/swiftsync — stateless, parallel fast initial validation.
//
// See DESIGN.md for the approach and the decisions still open (construction,
// coin encoding, hint format, commitment source).

export { Accumulator } from './accumulator.js';

const hexToBytes = (h) => { const n = h.length >> 1; const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };

// Canonical bytes for a coin — the full 5-tuple (DESIGN.md decision 2).
// SwiftSync and the trusted commitment must encode coins identically:
//   txid(32) || vout(4 LE) || height(4 LE) || coinbase(1) || amount(8 LE) || scriptPubKey
// Committing to amount + coinbase + height is what binds monetary supply and
// coinbase maturity; the salt is applied separately by the Accumulator.
export function encodeCoin({ txid, vout, height = 0, coinbase = false, amount, scriptPubKey }) {
  const tx = hexToBytes(txid);
  const spk = hexToBytes(scriptPubKey || '');
  const out = new Uint8Array(tx.length + 17 + spk.length);
  out.set(tx, 0);
  const dv = new DataView(out.buffer);
  let o = tx.length;
  dv.setUint32(o, vout, true); o += 4;
  dv.setUint32(o, height, true); o += 4;
  out[o] = coinbase ? 1 : 0; o += 1;
  dv.setBigUint64(o, BigInt(amount), true); o += 8;
  out.set(spk, o);
  return out;
}
