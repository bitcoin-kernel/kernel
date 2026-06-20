// In-window transaction DAG verification.
//
// A full node checks every input against the whole UTXO set. We don't hold the
// UTXO set — only a sliding window of recent blocks. But when an input spends a
// coin that was *created within the window* (its funding transaction is in a
// block we already hold), we can resolve the prevout — scriptPubKey + amount —
// ourselves and run the real script+signature check: the very same
// interpreter.verifyInput() the full validator uses, on WASM secp. So we verify
// the self-contained slice of the transaction DAG, and coverage climbs as the
// window deepens. Inputs that spend older coins outside the window are skipped
// honestly — not assumed valid, just out of reach.
//
// verifyDag({ cache, codec, be, onProgress, shouldStop }) ->
//   { inputs, resolvable, verified, failed, skipped, failures, blocks }
//   inputs    — non-coinbase inputs seen across the window
//   resolvable — those whose funding coin is also in the window (the DAG slice)
//   verified  — resolvable inputs whose script+signature checked out (ok:true)
//   failed    — resolvable inputs the engine rejected (ok:false) — should be 0;
//               any non-zero is a real finding, captured in `failures`
//   skipped   — resolvable but unverifiable here (ok:null): an unknown witness
//               version, or taproot in a tx that didn't fully resolve
//
// Two passes so only one decoded block is ever live at once (a window can be
// thousands of blocks): pass 1 builds the txid->outputs index, pass 2 verifies.

// The kernel reaches dag only through the injected codec/be — never an import.
// bytesToHex is the one primitive needed at module level, so it stays local.
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

const NULL_TXID = '00'.repeat(32);
const isCoinbase = (tx) =>
  tx.inputs.length === 1 && tx.inputs[0].prevout.txid === NULL_TXID;
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export async function verifyDag({ cache, codec, be, onProgress, shouldStop }) {
  if (!be.interpreter) return null;
  const stop = () => (shouldStop ? shouldStop() : false);
  const entries = cache.entries();              // newest height first

  // Pass 1 — index the funding side: txid -> outputs ({ value, scriptPubKey }).
  const outputsByTxid = new Map();
  let indexed = 0;
  for (const e of entries) {
    if (stop()) return null;
    const bytes = await cache.get(e.hash);
    if (!bytes) continue;
    let block; try { block = codec.decode('Block', bytesToHex(bytes)); } catch { continue; }
    for (const tx of block.transactions) outputsByTxid.set(codec.txid(tx), tx.outputs);
    indexed++;
    if (onProgress) onProgress({ phase: 'index', done: indexed, total: entries.length });
    await yieldUI();
  }

  // Pass 2 — verify every input whose prevout we can resolve from the window.
  let inputs = 0, resolvable = 0, verified = 0, failed = 0, skipped = 0, scanned = 0;
  const failures = [];
  for (const e of entries) {
    if (stop()) break;
    const bytes = await cache.get(e.hash);
    if (!bytes) continue;
    let block; try { block = codec.decode('Block', bytesToHex(bytes)); } catch { continue; }
    for (const tx of block.transactions) {
      if (isCoinbase(tx)) continue;
      const resolved = new Map();
      for (let i = 0; i < tx.inputs.length; i++) {
        inputs++;
        const p = tx.inputs[i].prevout;
        const outs = outputsByTxid.get(p.txid);
        const out = outs && outs[p.vout];
        if (out) { resolved.set(i, out); resolvable++; }
      }
      if (resolved.size === 0) continue;
      // taproot sighash commits to every input's prevout, so the full array is
      // only available (and taproot only verifiable) when the whole tx resolved
      const allPrevouts = resolved.size === tx.inputs.length
        ? tx.inputs.map((_, i) => resolved.get(i)) : null;
      for (const [i, prevout] of resolved) {
        let v;
        try { v = be.interpreter.verifyInput(tx, i, prevout, allPrevouts); }
        catch (err) { v = { ok: false, error: err.message }; }
        if (v.ok === true) verified++;
        else if (v.ok === false) {
          failed++;
          if (failures.length < 20) failures.push({ height: e.height, txid: codec.txid(tx), input: i, type: v.type, error: v.error || v.reason });
        } else skipped++;
      }
    }
    scanned++;
    if (onProgress) onProgress({ phase: 'verify', done: scanned, total: entries.length, inputs, resolvable, verified, failed, skipped });
    await yieldUI();
  }

  return { inputs, resolvable, verified, failed, skipped, failures, blocks: scanned };
}
