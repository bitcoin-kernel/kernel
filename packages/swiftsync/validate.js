// SwiftSync driver — walk a sequence of blocks, feeding the accumulator: every
// output created is added, every non-coinbase input spent is removed. Over a
// contiguous range starting at genesis the residual accumulator equals the UTXO
// set at the final block (all outputs − all inputs).
//
// This is the assumevalid shape (outpoint-only elements, no script execution).
// The full version swaps encodeOutpoint → encodeCoin and pulls prevout data from
// undo data; the walk is the same.
//
// Engine-agnostic: the caller injects txidOf(tx) (e.g. the kernel codec's txid)
// and the Accumulator, so this package imports no engine code.

import { encodeOutpoint } from './index.js';

const NULL_TXID = '00'.repeat(32);
const isOpReturn = (spk) => typeof spk === 'string' && spk.startsWith('6a'); // provably unspendable — never in the UTXO set

// blocks: iterable of decoded blocks (each { transactions:[{ inputs, outputs }] }).
// opts: { txidOf(tx)->hex, acc:Accumulator }. Returns acc.
export function applyBlocks(blocks, { txidOf, acc }) {
  for (const block of blocks) {
    for (const tx of block.transactions) {
      const txid = txidOf(tx);
      for (let v = 0; v < tx.outputs.length; v++) {
        if (isOpReturn(tx.outputs[v].scriptPubKey)) continue; // skip OP_RETURN, like the UTXO set
        acc.add(encodeOutpoint({ txid, vout: v }));
      }
      for (const inp of tx.inputs) {
        if (inp.prevout.txid === NULL_TXID) continue;          // coinbase has no prevout
        acc.spend(encodeOutpoint({ txid: inp.prevout.txid, vout: inp.prevout.vout }));
      }
    }
  }
  return acc;
}
