// Policy overlays: Plumb's relay filters, one module each, composable like its
// -reject… options. Gauge first (what share of a block a Plumb node would have
// refused), gate later (a mempool). None of this touches consensus.
import fakeMultisig from './fake-multisig.js';

export const overlays = { 'fake-multisig': fakeMultisig };
export const defaults = ['fake-multisig'];         // deterministic tier only, by default

// (tx, prevouts, opts) -> [{ overlay, rule, errorCode, input, ... }]
export function check(tx, prevouts, { scriptEngine, use = defaults } = {}) {
  const out = [];
  for (const name of use) {
    const o = overlays[name];
    if (!o) throw new Error(`unknown policy overlay: ${name}`);
    for (const v of o.check(tx, prevouts, { scriptEngine })) out.push({ overlay: name, ...v });
  }
  return out;
}

// Per-overlay weight share over a block's transactions, each given as
// { tx, prevouts, weight }. A transaction counts once per overlay it trips.
export function weightShare(entries, opts) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  const hit = {};
  for (const e of entries) {
    const tripped = new Set(check(e.tx, e.prevouts, opts).map((v) => v.overlay));
    for (const name of tripped) hit[name] = (hit[name] ?? 0) + e.weight;
  }
  return Object.fromEntries(Object.entries(hit).map(([k, w]) => [k, { weight: w, share: total ? w / total : 0 }]));
}
