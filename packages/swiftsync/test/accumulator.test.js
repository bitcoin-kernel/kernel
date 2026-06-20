// Invariants that make SwiftSync correct, plus a faithfulness check that mirrors
// the reference crate's own test (github.com/2140-dev/swiftsync aggregate/tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Accumulator } from '../accumulator.js';

const sha256 = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const pre = (s) => new TextEncoder().encode(s);
const hex = (b) => Buffer.from(b).toString('hex');
const ZERO = '00'.repeat(32);

test('empty accumulator digests to zero', () => {
  const a = new Accumulator({ sha256 });
  assert.ok(a.isZero());
  assert.equal(hex(a.digest()), ZERO);
});

test('add then spend cancels back to zero', () => {
  const a = new Accumulator({ sha256 });
  a.add(pre('utxo-1'));
  assert.equal(a.isZero(), false);
  a.spend(pre('utxo-1'));
  assert.ok(a.isZero(), 'a created-then-spent coin leaves no trace');
});

test('order-independent (commutative)', () => {
  const a = new Accumulator({ sha256 }).add(pre('A')).add(pre('B')).add(pre('C'));
  const b = new Accumulator({ sha256 }).add(pre('C')).add(pre('A')).add(pre('B'));
  assert.equal(hex(a.digest()), hex(b.digest()));
});

test('parallel partials merge to the single-thread digest', () => {
  const whole = new Accumulator({ sha256 });
  for (const c of ['A', 'B', 'C', 'D']) whole.add(pre(c));
  const w1 = new Accumulator({ sha256 }).add(pre('A')).add(pre('B'));
  const w2 = new Accumulator({ sha256 }).add(pre('C')).add(pre('D'));
  w1.merge(w2);
  assert.equal(hex(w1.digest()), hex(whole.digest()));
});

test('addHash/spendHash (precomputed) match add/spend', () => {
  const a = new Accumulator({ sha256 });
  const h = a.hash(pre('x'));
  const b = new Accumulator({ sha256 }).addHash(h);
  assert.equal(hex(new Accumulator({ sha256 }).add(pre('x')).digest()), hex(b.digest()));
});

test('salt is opt-in: null = reference, non-null diverges deterministically', () => {
  const ref = new Accumulator({ sha256 }).add(pre('x'));
  const salted = new Accumulator({ sha256, salt: new Uint8Array([1, 2, 3]) }).add(pre('x'));
  assert.notEqual(hex(ref.digest()), hex(salted.digest()));
  const salted2 = new Accumulator({ sha256, salt: new Uint8Array([1, 2, 3]) }).add(pre('x'));
  assert.equal(hex(salted.digest()), hex(salted2.digest()));
});

// Mirrors the reference's aggregate/tests/test.rs::test_static_utxo_set: with the
// same xorshift64 RNG (seed 420), spend N random outpoints (non-zero), then add
// them all back — must return to exactly zero. Proves cancellation under the
// reference's exact element layout (internal txid || vout LE).
test('reference test_static_utxo_set: spend N then add N returns to zero', () => {
  const M64 = (1n << 64n) - 1n;
  let s = 420n;
  const nextU64 = () => { s ^= (s << 13n) & M64; s ^= s >> 7n; s ^= (s << 17n) & M64; s &= M64; return s; };
  const next32 = () => { const b = new Uint8Array(32); const dv = new DataView(b.buffer); for (let i = 0; i < 4; i++) dv.setBigUint64(i * 8, nextU64(), true); return b; };
  const outpoint = () => { const txid = next32(); const vout = Number(nextU64() % BigInt(0xffffffff)); const op = new Uint8Array(36); op.set(txid, 0); new DataView(op.buffer).setUint32(32, vout, true); return op; };

  const acc = new Accumulator({ sha256 });
  const ops = [];
  for (let i = 0; i < 10000; i++) { const op = outpoint(); acc.spend(op); ops.push(op); }
  assert.equal(acc.isZero(), false);
  for (const op of ops) acc.add(op);
  assert.ok(acc.isZero(), 'spend-all then add-all cancels to zero');
});
