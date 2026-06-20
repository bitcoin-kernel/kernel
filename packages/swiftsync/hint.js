// Hint generation + reconstruction.
//
// generateHints: walk a contiguous range, build the UTXO set at the end, then for
// each block list the block-local output indices that remain unspent. The index
// counts ALL outputs in transaction order (so a verifier walking outputs aligns);
// OP_RETURN outputs get an index but are never in the UTXO set, so never in a
// hint. These per-block index lists are what hintsfile.js Elias-Fano encodes.
//
// reconstructUtxo: the assumevalid verifier side — rebuild the UTXO set purely
// from the blocks + the hint bitmap (no input processing). With the matching
// accumulator check (validate.js), this is SwiftSync: fast set construction from
// hints, verified against a trusted commitment.
//
// Engine-agnostic: caller injects txidOf(tx).

const NULL_TXID = '00'.repeat(32);
const isOpReturn = (spk) => typeof spk === 'string' && spk.startsWith('6a');

export function generateHints(blocks, { txidOf }) {
  const utxo = new Set();
  for (const block of blocks) for (const tx of block.transactions) {
    const txid = txidOf(tx);
    for (let v = 0; v < tx.outputs.length; v++) if (!isOpReturn(tx.outputs[v].scriptPubKey)) utxo.add(txid + ':' + v);
    for (const inp of tx.inputs) if (inp.prevout.txid !== NULL_TXID) utxo.delete(inp.prevout.txid + ':' + inp.prevout.vout);
  }
  const blockHints = [];
  for (const block of blocks) {
    const idx = []; let i = 0;
    for (const tx of block.transactions) {
      const txid = txidOf(tx);
      for (let v = 0; v < tx.outputs.length; v++) { if (utxo.has(txid + ':' + v)) idx.push(i); i++; }
    }
    blockHints.push(idx);
  }
  return { height: blocks.length, blockHints };
}

export function reconstructUtxo(blocks, blockHints, { txidOf }) {
  const utxo = new Set();
  for (let b = 0; b < blocks.length; b++) {
    const want = new Set(blockHints[b]); let i = 0;
    for (const tx of blocks[b].transactions) {
      const txid = txidOf(tx);
      for (let v = 0; v < tx.outputs.length; v++) { if (want.has(i)) utxo.add(txid + ':' + v); i++; }
    }
  }
  return utxo;
}
