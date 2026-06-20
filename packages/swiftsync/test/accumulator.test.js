// The accumulator's invariants are what make SwiftSync correct: a coin created
// and spent cancels, order never matters, and parallel partials merge to the
// same digest as a single thread. These hold regardless of the final coin
// encoding or hash construction, so they can be pinned now.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Accumulator } from '../accumulator.js';

const sha256 = (b) => new Uint8Array(createHash('sha256').update(b).digest());
const coin = (s) => new TextEncoder().encode(s);
const hex = (b) => Buffer.from(b).toString('hex');
const ZERO = '00'.repeat(32);

test('empty accumulator digests to zero', () => {
  assert.equal(hex(new Accumulator({ sha256 }).digest()), ZERO);
});

test('add then remove cancels back to empty', () => {
  const a = new Accumulator({ sha256 });
  a.add(coin('utxo-1'));
  assert.notEqual(hex(a.digest()), ZERO);
  a.remove(coin('utxo-1'));
  assert.equal(hex(a.digest()), ZERO, 'a created-then-spent coin leaves no trace');
});

test('order-independent (commutative)', () => {
  const a = new Accumulator({ sha256 }).add(coin('A')).add(coin('B')).add(coin('C'));
  const b = new Accumulator({ sha256 }).add(coin('C')).add(coin('A')).add(coin('B'));
  assert.equal(hex(a.digest()), hex(b.digest()));
});

test('parallel partials merge to the single-thread digest', () => {
  const whole = new Accumulator({ sha256 });
  for (const c of ['A', 'B', 'C', 'D']) whole.add(coin(c));
  const w1 = new Accumulator({ sha256 }).add(coin('A')).add(coin('B'));
  const w2 = new Accumulator({ sha256 }).add(coin('C')).add(coin('D'));
  w1.merge(w2);
  assert.equal(hex(w1.digest()), hex(whole.digest()));
});

test('salt changes the digest (collision-resistance lever is actually mixed in)', () => {
  const a = new Accumulator({ sha256, salt: new Uint8Array([1, 2, 3]) }).add(coin('x'));
  const b = new Accumulator({ sha256, salt: new Uint8Array([9, 9, 9]) }).add(coin('x'));
  assert.notEqual(hex(a.digest()), hex(b.digest()), 'same coin, different salt → different element');
  // but the same salt is reproducible (deterministic per run)
  const c = new Accumulator({ sha256, salt: new Uint8Array([1, 2, 3]) }).add(coin('x'));
  assert.equal(hex(a.digest()), hex(c.digest()));
});

test('SwiftSync end state equals the real unspent set', () => {
  // create a,b,c ; spend b within range  →  digest must equal the set {a,c}
  const fast = new Accumulator({ sha256 });
  fast.add(coin('a')).add(coin('b')).add(coin('c')).remove(coin('b'));
  const truth = new Accumulator({ sha256 }).add(coin('a')).add(coin('c'));
  assert.equal(hex(fast.digest()), hex(truth.digest()));
});
