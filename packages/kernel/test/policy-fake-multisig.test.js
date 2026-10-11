// Real transactions from BLAKE2b mainnet (Knots chain) blocks 976646/976647,
// fetched from mempool.guide on 2026-10-11. Prevouts alongside each as JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKernel } from '../index.js';
import { check as checkFakeMultisig, multisigs } from '../codec/policy/fake-multisig.js';
import { check, weightShare, overlays, defaults } from '../codec/policy/index.js';
import schema from '../schema/policy/fake-multisig.js';

const K = createKernel();
const dir = new URL('./vectors/policy/', import.meta.url);
const vector = (name) => {
  const bytes = new Uint8Array(readFileSync(new URL(`${name}.bin`, dir)));
  const meta = JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
  return { tx: K.codec.decode('Transaction', bytes), bytes, ...meta };
};
const opts = { scriptEngine: K.script };

test('schema: the threshold lives in the rule set, the code reads it', () => {
  const rs = schema['@graph'].find((n) => n['@type'] === 'RuleSet');
  assert.equal(rs.maxUnprovenKeys, 10);
  assert.equal(rs.rules[0].errorCode, 'policy-fake-multisig');
  assert.equal(schema['@graph'][0].layer, 'policy');
});

test('must fail: the 1-of-15 P2WSH loop; 254 of its 255 inputs are violations', () => {
  const v = vector('fake-multisig-1of15');
  assert.equal(v.tx.inputs.length, 255);
  const out = checkFakeMultisig(v.tx, v.prevouts, opts);
  assert.equal(out.length, 254);
  assert.deepEqual(out[0], { rule: 'btc:rule-policy-fake-multisig', errorCode: 'policy-fake-multisig', input: 0, where: 'p2wsh', m: 1, n: 15, unproven: 14 });
  assert.ok(out.every((x) => x.m === 1 && x.n === 15));
  // The last input is the tail of the data: a 1-of-4 with only 3 unproven keys.
  // The rule leaves it alone, which is the point of a threshold, not a bug.
  assert.ok(!out.some((x) => x.input === 254));
  const tail = multisigs(K.script.parse(v.tx.witness[254].at(-1)));
  assert.deepEqual(tail.map(({ m, n }) => ({ m, n })), [{ m: 1, n: 4 }]);
});

for (const name of ['wallet-3of5-deadbranch', 'cltv-2of2-fccx', 'tapscript-nonce', 'payment-p2wpkh', 'coinbase']) {
  test(`must pass: ${name}`, () => {
    const v = vector(name);
    assert.deepEqual(checkFakeMultisig(v.tx, v.prevouts, opts), []);
  });
}

test('the 3-of-5 wallet is seen as multisig, just not a fake one', () => {
  const v = vector('wallet-3of5-deadbranch');
  const ws = v.tx.witness[0].at(-1);
  assert.deepEqual(multisigs(K.script.parse(ws)).map(({ m, n }) => ({ m, n })), [{ m: 3, n: 5 }]);
});

test('boundary: 11-of-15 (Liquid-shaped) passes, 1-of-12 fails, 10 unproven is the last allowed', () => {
  const key = '21' + '02' + 'ab'.repeat(32);
  // m and n as script writes them: OP_N up to 16, a one-byte push for 17..20.
  const num = (v) => v <= 16 ? (0x50 + v).toString(16) : '01' + v.toString(16).padStart(2, '0');
  const ms = (m, n) => num(m) + key.repeat(n) + num(n) + 'ae';
  const run = (m, n) => {
    const tx = { inputs: [{ scriptSig: '', prevout: { txid: '00'.repeat(32), vout: 0 }, sequence: 0 }], outputs: [], witness: [['', ms(m, n)]] };
    const prevouts = [{ value: 1000, scriptPubKey: '0020' + 'cd'.repeat(32) }];
    return checkFakeMultisig(tx, prevouts, opts).length;
  };
  assert.equal(run(11, 15), 0);
  assert.equal(run(1, 11), 0);   // 10 unproven: allowed
  assert.equal(run(1, 12), 1);   // 11 unproven: refused
  assert.equal(run(2, 16), 1);
  // 17..20 keys cannot be written with OP_N; the one-byte push form must be seen too.
  assert.equal(run(1, 20), 1);   // 19 unproven, the fattest this shape allows
  assert.equal(run(10, 20), 0);  // 10 unproven: allowed
  assert.equal(run(9, 20), 1);   // 11 unproven: refused
});

test('composition: the index runs the chosen overlays and reports weight share', () => {
  assert.deepEqual(Object.keys(overlays), ['fake-multisig']);
  assert.deepEqual(defaults, ['fake-multisig']);
  const spam = vector('fake-multisig-1of15'), pay = vector('payment-p2wpkh');
  assert.equal(check(spam.tx, spam.prevouts, opts)[0].overlay, 'fake-multisig');
  const weight = (v) => v.bytes.length * 4;      // generous stand-in: real weights come from the block
  const share = weightShare([{ ...spam, weight: weight(spam) }, { ...pay, weight: weight(pay) }], opts);
  assert.ok(share['fake-multisig'].share > 0.99);
  assert.throws(() => check(pay.tx, pay.prevouts, { ...opts, use: ['nope'] }), /unknown policy overlay/);
});
