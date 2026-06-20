// The driver walks blocks emitting add (created output) / spend (consumed input),
// skipping coinbase prevouts and OP_RETURN outputs. Over a self-contained set the
// residual accumulator equals the real UTXO set.
//
// (Verified separately against 5,000 real testnet4 blocks: streaming digest ==
// independently-built UTXO set digest. This keeps a fast, portable unit check.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyBlocks } from '../validate.js';
import { Accumulator, encodeOutpoint } from '../index.js';

const sha256 = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const hex = (b) => Buffer.from(b).toString('hex');
const A = 'aa'.repeat(32), B = 'bb'.repeat(32), NULL = '00'.repeat(32);

test('driver: coinbase skipped, spend cancels, OP_RETURN excluded', () => {
  const blocks = [
    { transactions: [
      { id: A, inputs: [{ prevout: { txid: NULL, vout: 0xffffffff } }], outputs: [{ scriptPubKey: '51' }] }, // coinbase → A:0
    ] },
    { transactions: [
      { id: B, inputs: [{ prevout: { txid: A, vout: 0 } }],                                                 // spends A:0
        outputs: [{ scriptPubKey: '51' }, { scriptPubKey: '6a00' }] },                                       // B:0 spendable, B:1 OP_RETURN
    ] },
  ];
  const streaming = applyBlocks(blocks, { txidOf: (tx) => tx.id, acc: new Accumulator({ sha256 }) });

  // real UTXO set = { B:0 }  (A:0 spent; B:1 is OP_RETURN, never in the set)
  const real = new Accumulator({ sha256 }).add(encodeOutpoint({ txid: B, vout: 0 }));
  assert.equal(hex(streaming.digest()), hex(real.digest()), 'driver digest == real UTXO set');

  // spending the lone remaining coin closes the books to zero
  streaming.spend(encodeOutpoint({ txid: B, vout: 0 }));
  assert.ok(streaming.isZero());
});
