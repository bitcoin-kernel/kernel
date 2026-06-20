// @bitcoin-kernel/swiftsync — stateless, parallel fast initial validation.
//
// See DESIGN.md for the approach and the decisions still open (construction,
// coin encoding, hint format, commitment source).

export { Accumulator } from './accumulator.js';

const hexToBytes = (h) => { const n = h.length >> 1; const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };

// Canonical bytes for a coin. FORMAT DECISION (DESIGN.md): SwiftSync and the
// trusted commitment must encode coins identically. Default:
//   txid(32) || vout(4 LE) || amount(8 LE) || scriptPubKey
// Height/coinbase are omitted for now — include them only if the commitment
// commits to coinbase maturity (decision pending).
export function encodeCoin({ txid, vout, amount, scriptPubKey }) {
  const tx = hexToBytes(txid);
  const spk = hexToBytes(scriptPubKey || '');
  const out = new Uint8Array(tx.length + 12 + spk.length);
  out.set(tx, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(tx.length, vout, true);
  dv.setBigUint64(tx.length + 4, BigInt(amount), true);
  out.set(spk, tx.length + 12);
  return out;
}
