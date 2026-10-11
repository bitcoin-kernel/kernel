// Policy overlay: fake multisig (Plumb -rejectfakemultisig). See the schema
// module for the rule in words. Pure: (tx, prevouts) -> violations.
import schema from '../../schema/policy/fake-multisig.js';
import script from '../../schema/script.js';
import { executedScripts, smallInt } from './walk.js';

const ruleSet = schema['@graph'].find((n) => n['@id'] === 'btc:FakeMultisigRules');
const rule = ruleSet.rules[0];
const MULTISIG = new Set(['OP_CHECKMULTISIG', 'OP_CHECKMULTISIGVERIFY']);
// Consensus caps n at 20 (MAX_PUBKEYS_PER_MULTISIG); 17..20 are written as a
// one-byte push, not OP_N, and must still be seen: a 1-of-20 is the fattest
// data carrier this shape allows.
const MAX_KEYS = script['@graph'].find((n) => n['@id'] === 'btc:scriptLimits').maxMultisigKeys;

// Every literal m-of-n multisig in one script: [{m, n, at}].
export function multisigs(ops) {
  const found = [];
  for (let i = 2; i < ops.length; i++) {
    if (!MULTISIG.has(ops[i].name)) continue;
    const n = smallInt(ops[i - 1]);
    if (n === null || n > MAX_KEYS || i - 2 - n < 0) continue;   // n not a literal, over the cap, or too few ops
    const m = smallInt(ops[i - 2 - n]);
    if (m === null || m > n) continue;
    found.push({ m, n, at: ops[i].at });
  }
  return found;
}

export function check(tx, prevouts, { scriptEngine, maxUnprovenKeys = ruleSet.maxUnprovenKeys } = {}) {
  const violations = [];
  tx.inputs.forEach((_, inIndex) => {
    for (const { where, script } of executedScripts(tx, inIndex, prevouts[inIndex], scriptEngine)) {
      if (where === 'tapscript') continue;           // CHECKMULTISIG is disabled in tapscript (BIP 342)
      for (const { m, n } of multisigs(scriptEngine.parse(script))) {
        const unproven = n - m;
        if (unproven > maxUnprovenKeys) {
          violations.push({ rule: rule['@id'], errorCode: rule.errorCode, input: inIndex, where, m, n, unproven });
        }
      }
    }
  });
  return violations;
}

export default { id: schema['@graph'][0]['@id'], schema, rule, check };
