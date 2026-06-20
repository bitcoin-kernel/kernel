# SwiftSync — design

Fast initial validation (Ruben Somsen, 2024) implemented for the bitcoin-kernel
engine. Normal IBD is slow because it processes blocks strictly in order and
holds the whole UTXO set throughout. SwiftSync replaces the UTXO set with a
single **cancelling accumulator**:

- coin **created** → `add(+)`
- coin **spent** → `remove(−)`
- coins created *and* spent within the range **cancel**

After the chain, the residual digest equals the **UTXO set at the tip** (all
outputs − all inputs = the unspent set). Compare it to a **trusted UTXO-set
commitment**; match = validated. Because add/remove are commutative, validation
parallelises across cores (each worker keeps an `Accumulator`, all `merge()` at
the end) with no sequential UTXO-set dependency.

**The hint is a bit vector — exactly one bit per output** ("does this output
remain unspent at the tip"), ≈<100 MB compressed for all history. It is untrusted:
a wrong bit makes the digest not match and validation fails; it can never make an
invalid chain pass.

**Two versions (Somsen).** *assumevalid*: the accumulator element is just the
**outpoint**, and scripts are **not checked** (trusting the assumevalid
checkpoint) — this is the headline 5.28× speedup. *non-assumevalid (full)*: the
element is the **full coin** (outpoint, output script, amount, coinbase flag,
height), **every script is checked**, and the prevout data scripts need comes
from separate **undo data** (served P2P — most nodes already produce it). We build
the **full** version: it re-derives everything and trusts no checkpoint, matching
`validate-sync` and our pristine stance. Slower than 5.28×, still stateless and
parallel.

## Reference & ecosystem (as of 2026-06)

- **Reference:** `github.com/2140-dev/swiftsync` (Rust; `aggregate` + `node` crates).
  Working prototypes; **btcd** and **floresta** are also implementing SwiftSync.
- **Bandwidth-bound:** Somsen reports **<20 min** for assumevalid IBD on 10 Gbit —
  "it goes as fast as you can download". So for the **browser layer** (bandwidth-
  limited / lower-end), the **assumevalid** variant is the realistic fast path;
  full validation is the pristine *desktop* path. Same accumulator, different
  element (`encodeOutpoint` vs `encodeCoin`). Artifact size (hint + undo data) is
  the lever — 2140 is actively working on reducing it.
- **SwiftSync is IBD-only and mode-agnostic** (Somsen): it "doesn't force you into
  any specific validation mode — it just completes IBD very quickly and then you
  can do whatever you want" (Utreexo-style or regular validation).
- **Complementary with Utreexo, not competing:** the Utreexo team is switching to
  SwiftSync for IBD. The pairing: **SwiftSync bootstraps the chain fast → Utreexo
  (or full) holds the resulting state.** That's our two-layer plan exactly — build
  SwiftSync first (fast sync), then Utreexo (compact state) on top.

## The oracle (why this is low-risk for us)

`bitcoin-kernel/node`'s `validate-sync` already builds the **real** UTXO set the
slow way. So the same construction (see below) applied to validate-sync's final
UTXO set is our **trusted commitment**, and a SwiftSync run that ends on the same
digest is proven correct against our own ground truth — the same differential
method we use against Bitcoin Core. No external reference needed.

## Components

- `accumulator.js` — commutative salted add/remove/merge accumulator. **Done.**
- `index.js` `encodeCoin` — canonical coin bytes (the 5-tuple, below).
- (todo) `hint.js` — generate/parse the 1-bit-per-output hint from a validated chain.
- (todo) `undo.js` — read/serve spent-output data (≈Core `rev*.dat`) for the full version.
- (todo) `validate.js` — drive the engine over blocks → add/remove ops, parallel workers, end on a digest.
- (todo) oracle test — run validate-sync + SwiftSync over testnet4; assert equal digests.

## Decisions

1. **Construction — salted additive, two 128-bit lanes (matches SwiftSync).**
   Element = `taggedSHA256("SwiftSync", preimage [‖ salt])`; accumulator = two
   independent 128-bit lanes (high/low halves of the element, wrapping add/sub —
   no carry), matching `2140-dev/swiftsync` byte-for-byte as a **correctness
   anchor** (not an interop requirement). Per Somsen, the aggregate is a *local*
   computation — each node checks its own aggregate against its own commitment, the
   digest is never shared, so implementations are cross-compatible **no matter how
   they aggregate, as long as it's secure**. The one cross-compatibility artifact is
   the **hintsfile** (its own BIP, Elias-Fano) — that is what we must match exactly,
   not the aggregate. The construction history, per Somsen directly: **XOR** was
   suggested and **rejected as insecure**; the choice is a **salted additive** hash
   — "a cheap way to get a secure hash aggregate" — with **MuHash** as the saltless
   but "much more expensive" alternative (kept swappable). The salt is **per-run**
   (blockhash-derived + per-node randomness), so it is *not* an interop value: the
   shareable artifact is the salt-free **1-bit hint**, while each node recomputes
   its salted digest locally. (`salt=null` reproduces the early prototype, which
   currently hashes outpoints unsalted — used for vectors/tests.)
2. **Coin encoding — the 5-tuple (full version).** `outpoint ‖ scriptPubKey ‖
   amount ‖ coinbaseFlag ‖ height` (Somsen's "five data points"). Committing to the
   amount is essential — gmaxwell's point: an invalid chain would *steal* coins, not
   inflate, so the accumulator must bind amounts (and it does).
3. **Prevouts at spend time — undo data.** From a separate stream ≈ Core's
   `rev*.dat` (the spent outputs' script+amount), ~10% more data, P2P-served. Not
   the hint (the hint is 1 bit/output). Needed for both script checks and to
   recompute the spent coin's element for removal.
4. **Commitment source.** validate-sync's UTXO-set digest as the trusted value
   (internal oracle); later, an assumeUTXO-style published hash.

## Subtleties to handle (from the bitcoin-dev review)

- **BIP30** duplicate-output check without a UTXO set (Somsen's writeup addresses it).
- **Coinbase maturity** and **outputs created+spent in the same block** — keep correct.
- **Free checks still done:** nLocktime vs block height, etc.
- **Signatures:** batch-verify (the big cost once bookkeeping is cheap).
- **Negative tests:** invalid hints, tricky double-spends, accidental element collisions.

## Status

Accumulator (salted, additive) with verified invariants — cancellation,
commutativity, parallel merge, salt-sensitivity. Next: `encodeCoin` → 5-tuple,
then the engine driver + undo-data reader, then the oracle test against
validate-sync.
