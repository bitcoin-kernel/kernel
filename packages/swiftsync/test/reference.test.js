// Byte-for-byte compatibility with the canonical reference
// (github.com/2140-dev/swiftsync, aggregate crate). Golden vector produced by
// running the reference's own hash_outpoint + Aggregate on a known outpoint:
//   internal txid 0102…20 (display 201f…0201), vout 0x12345678.
// This is a CORRECTNESS anchor, not an interop requirement: per Somsen the hash
// aggregate is a local computation (never shared between nodes), so cross-
// compatibility comes from the hintsfile, not the aggregate. We still pin this so
// our secure construction can't silently change underfoot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Accumulator, encodeOutpoint } from '../index.js';

const sha256 = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const hex = (b) => Buffer.from(b).toString('hex');

test('reference golden vector: matches 2140-dev/swiftsync byte-for-byte', () => {
  const pre = encodeOutpoint({ txid: '201f1e1d1c1b1a191817161514131211100f0e0d0c0b0a090807060504030201', vout: 0x12345678 });
  const acc = new Accumulator({ sha256 });
  assert.equal(hex(acc.hash(pre)), '13432e7cf5dd376a81cd0bdf3f11902550cb7d88345ffd324101db1bb625e32a', 'hash_outpoint');
  acc.add(pre);
  assert.equal(acc.high, 25604158700660416489130190155856056357n, 'aggregate high lane');
  assert.equal(acc.low, 107394822017515662388964130756158153514n, 'aggregate low lane');
});
