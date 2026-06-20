// Amount + script compression validated byte-for-byte against the block-undo
// BIP's own test vectors (bitcoin/bips#2152).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressAmount, decompressAmount, compressScript, expandScript, encodeHeightCode, decodeHeightCode, encodeCoin, decodeCoin } from '../undo.js';

const bh = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const hb = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

const AMOUNTS = [[0, '0x0'], [1, '0x1'], [1000000, '0x7'], [100000000, '0x9'], [5000000000, '0x32'], [2100000000000000, '0x1406f40']];
const SCRIPTS = [
  ['76a9142365e46227cc171083ea275f45ea8646c61d1fbb88ac', '012365e46227cc171083ea275f45ea8646c61d1fbb'],
  ['a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87', '05b472a266d0bd89c13706a4132ccfb16f7c3b9fcb'],
  ['5120720b1ffb2c63684973c5e9898b188c9d367fa2bc1ce76b8ea02872b5e3ffe705', '08720b1ffb2c63684973c5e9898b188c9d367fa2bc1ce76b8ea02872b5e3ffe705'],
  ['00146262b97a514ea54d12f51e0a4fe4c09fb74ff7bd', '076262b97a514ea54d12f51e0a4fe4c09fb74ff7bd'],
  ['00200000000000000000000000000000000000000000000000000000000000000000', '060000000000000000000000000000000000000000000000000000000000000000'],
  ['210334ed84e3c579d5ff9122fb4215210ec5aaad51c3f60bf971d939db1c5b56a9fbac', '0334ed84e3c579d5ff9122fb4215210ec5aaad51c3f60bf971d939db1c5b56a9fb'],
  ['410441a5367189b64cc1601c2a708556e37ade94ec808be746e45e35d86d2ee0cb9cd3b2e65ee51baf285cda78589605c3a59ba0492d577349ad3f0afaac862aa59eac', '0441a5367189b64cc1601c2a708556e37ade94ec808be746e45e35d86d2ee0cb9cd3b2e65ee51baf285cda78589605c3a59ba0492d577349ad3f0afaac862aa59e'],
  ['6a', '00016a'],
];

test('CompressAmount matches BIP vectors + round-trips', () => {
  for (const [amt, hex] of AMOUNTS) {
    assert.equal(compressAmount(amt), BigInt(hex), `compress ${amt}`);
    assert.equal(decompressAmount(compressAmount(amt)), BigInt(amt), `round-trip ${amt}`);
  }
});

test('Reconstructable script matches BIP vectors (both directions)', () => {
  for (const [full, compressed] of SCRIPTS) {
    assert.equal(bh(compressScript(full)), compressed, `compress ${full.slice(0, 12)}…`);
    assert.equal(expandScript(hb(compressed)), full, `expand ${compressed.slice(0, 12)}…`);
  }
});

test('height code: shift + coinbase bit (spec example 39→79)', () => {
  assert.equal(encodeHeightCode(0b0010_0111, true), 0b0100_1111);  // 39 coinbase → 79
  assert.deepEqual(decodeHeightCode(79), { height: 39, coinbase: true });
  assert.deepEqual(decodeHeightCode(encodeHeightCode(840000, false)), { height: 840000, coinbase: false });
});

test('spent-coin record round-trips', () => {
  const coin = { inputIndex: 3, height: 840000, coinbase: false, scriptPubKey: '0014' + '11'.repeat(20), amount: 12345678n };
  const [got] = decodeCoin(encodeCoin(coin));
  assert.deepEqual(got, coin);
});
