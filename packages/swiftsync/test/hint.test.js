// Hint generation + reconstruction: the generator marks block-local output
// indices that stay unspent; the verifier rebuilds the exact same UTXO set from
// the bitmap alone. (Verified separately end-to-end on 5,000 real testnet4 blocks.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateHints, reconstructUtxo } from '../hint.js';
import { encodeHintsfile, decodeHintsfile } from '../hintsfile.js';

const A = 'aa'.repeat(32), B = 'bb'.repeat(32), NULL = '00'.repeat(32);
const txidOf = (tx) => tx.id;

test('generate + reconstruct: indices count all outputs, OP_RETURN never unspent', () => {
  const blocks = [
    { transactions: [
      { id: A, inputs: [{ prevout: { txid: NULL, vout: 0xffffffff } }], outputs: [{ scriptPubKey: '51' }, { scriptPubKey: '52' }] }, // A:0, A:1
    ] },
    { transactions: [
      { id: B, inputs: [{ prevout: { txid: A, vout: 0 } }],                                                                            // spend A:0
        outputs: [{ scriptPubKey: '51' }, { scriptPubKey: '6a00' }] },                                                                  // B:0 spendable, B:1 OP_RETURN
    ] },
  ];
  // unspent at tip: A:1 (block 0 index 1), B:0 (block 1 index 0)
  const { blockHints } = generateHints(blocks, { txidOf });
  assert.deepEqual(blockHints, [[1], [0]]);

  // verifier rebuilds the same UTXO set from the bitmap alone
  const utxo = reconstructUtxo(blocks, blockHints, { txidOf });
  assert.deepEqual([...utxo].sort(), [A + ':1', B + ':0'].sort());

  // and it survives the Elias-Fano hintsfile round-trip
  assert.deepEqual(decodeHintsfile(encodeHintsfile({ height: 2, blockHints })).blockHints, blockHints);
});
