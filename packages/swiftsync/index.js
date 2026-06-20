// @bitcoin-kernel/swiftsync — stateless, parallel fast initial validation.
// Construction matches github.com/2140-dev/swiftsync (see DESIGN.md).

export { Accumulator } from './accumulator.js';
export { applyBlocks } from './validate.js';
export { generateHints, reconstructUtxo } from './hint.js';
export { eliasFanoEncode, eliasFanoDecode, encodeHintsfile, decodeHintsfile } from './hintsfile.js';
export { compressAmount, decompressAmount, compressScript, expandScript, encodeHeightCode, decodeHeightCode, encodeCoin as encodeSpentCoin, decodeCoin as decodeSpentCoin } from './undo.js';

const hexToBytes = (h) => { const n = h.length >> 1; const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };
// A txid as displayed is the reverse of its internal/consensus byte order, which
// is what the reference hashes (`Txid::to_byte_array()`). Reverse it.
const txidInternal = (txidHex) => hexToBytes(txidHex).reverse();

// assumevalid element: the outpoint only (reference default).
//   txid(32, internal) || vout(4 LE)
export function encodeOutpoint({ txid, vout }) {
  const out = new Uint8Array(36);
  out.set(txidInternal(txid), 0);
  new DataView(out.buffer).setUint32(32, vout, true);
  return out;
}

// full (non-assumevalid) element: the 5-tuple, so the digest also binds the
// monetary supply, coinbase flag and height.
//   outpoint(36) || scriptPubKey || amount(8 LE) || coinbase(1) || height(4 LE)
export function encodeCoin({ txid, vout, height = 0, coinbase = false, amount, scriptPubKey }) {
  const op = encodeOutpoint({ txid, vout });
  const spk = hexToBytes(scriptPubKey || '');
  const out = new Uint8Array(op.length + spk.length + 13);
  out.set(op, 0);
  out.set(spk, op.length);
  const dv = new DataView(out.buffer);
  let o = op.length + spk.length;
  dv.setBigUint64(o, BigInt(amount), true); o += 8;
  out[o] = coinbase ? 1 : 0; o += 1;
  dv.setUint32(o, height, true);
  return out;
}
