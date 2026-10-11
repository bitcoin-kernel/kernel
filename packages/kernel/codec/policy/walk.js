// The scripts an input actually executes, by scriptPubKey type: the bare
// scriptPubKey, the P2SH redeem script (and, for P2SH-wrapped segwit, the
// witness script behind it), the P2WSH witness script, or the tapscript leaf.
// Shared by every policy overlay so they all look at the same bytes.
const ANNEX = '50';

const lastPush = (ops) => {
  const op = ops[ops.length - 1];
  return op && !op.error && op.data !== undefined ? op.data : null;
};

export function executedScripts(tx, inIndex, prevout, scriptEngine) {
  if (!prevout) return [];                         // coinbase: nothing to execute
  const input = tx.inputs[inIndex];
  const witness = tx.witness?.[inIndex] ?? [];
  const spk = prevout.scriptPubKey;
  const type = scriptEngine.classify(spk).type;
  const out = [];
  switch (type) {
    case 'p2sh': {
      const redeem = lastPush(scriptEngine.parse(input.scriptSig ?? ''));
      if (redeem === null) break;
      out.push({ where: 'p2sh', script: redeem });
      const inner = scriptEngine.classify(redeem).type;
      if (inner === 'p2wsh' && witness.length) out.push({ where: 'p2sh-p2wsh', script: witness[witness.length - 1] });
      break;
    }
    case 'p2wsh':
      if (witness.length) out.push({ where: 'p2wsh', script: witness[witness.length - 1] });
      break;
    case 'p2tr': {
      const stack = witness.slice();
      if (stack.length > 1 && stack[stack.length - 1].startsWith(ANNEX)) stack.pop();
      if (stack.length > 1) out.push({ where: 'tapscript', script: stack[stack.length - 2] });
      break;                                       // key path: no script runs
    }
    case 'p2pkh': case 'p2wpkh': case 'p2pk':
      break;                                       // fixed templates, nothing to inspect
    default:
      out.push({ where: 'bare', script: spk });    // multisig, nulldata, nonstandard
  }
  return out;
}

// A literal script number as CHECKMULTISIG reads m and n: OP_0, OP_1..OP_16,
// or a one-byte push holding 0..127 (17..20 can only be written this way;
// consensus caps n at 20, so the caller bounds it). Null for anything else.
export function smallInt(op) {
  if (!op || op.error) return null;
  if (op.code === 0x00) return 0;
  if (op.code >= 0x51 && op.code <= 0x60) return op.code - 0x50;
  if (op.data !== undefined && op.data.length === 2) {
    const v = parseInt(op.data, 16);
    return v <= 0x7f ? v : null;                     // one byte, sign bit clear: a positive script number
  }
  return null;
}
