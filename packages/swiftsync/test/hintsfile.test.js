// Elias-Fano encoding validated byte-for-byte against the SwiftSync hintsfile
// BIP's own test vectors (bitcoin/bips#2152, elias_fano.json). The hintsfile is
// the one cross-compatible artifact, so matching these is interop-critical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eliasFanoEncode, eliasFanoDecode, encodeHintsfile, decodeHintsfile } from '../hintsfile.js';

const hex = (b) => Buffer.from(b).toString('hex');
const VECTORS = [
  [[13, 16, 19, 22, 25, 28, 31, 34, 37, 40], '0a288d8d8016ad50'],
  [[5, 12, 19, 26, 33, 40, 47, 54, 61, 68, 75, 82, 89, 96, 103, 110, 117], '11758d8d8d8d804a4949292524'],
  [Array.from({ length: 50 }, (_, i) => 17 + 3 * i), '32a4aaaaaaaaaaaa800094a5294a5294a5294a5294a5294a5290'],
];

for (const [seq, expected] of VECTORS) {
  test(`Elias-Fano vector n=${seq.length} m=${seq[seq.length - 1]} encodes to spec bytes`, () => {
    assert.equal(hex(eliasFanoEncode(seq)), expected);
  });
  test(`Elias-Fano vector n=${seq.length} round-trips`, () => {
    assert.deepEqual(eliasFanoDecode(eliasFanoEncode(seq))[0], seq);
  });
}

test('Elias-Fano edge cases round-trip (empty, single, spec example [3,7,12])', () => {
  for (const seq of [[], [0], [5], [3, 7, 12], [1, 2, 3, 100, 1000]]) {
    assert.deepEqual(eliasFanoDecode(eliasFanoEncode(seq))[0], seq);
  }
});

test('hintsfile container round-trips (magic, version, height, per-block hints)', () => {
  const blockHints = [[0, 6], [], [3, 7, 12], [2]];
  const bytes = encodeHintsfile({ height: 840000, blockHints });
  assert.equal(hex(bytes.subarray(0, 4)), '5554584f');           // "UTXO"
  const { height, blockHints: got } = decodeHintsfile(bytes);
  assert.equal(height, 840000);
  assert.deepEqual(got, blockHints);
});
