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

1. **Construction — additive+salt (default), MuHash swappable.** Default is the
   salted additive hash: `Σ SHA256(tag‖coin‖salt) mod 2²⁵⁶` (remove = subtract).
   Plain additive hashing is collision-weak (subset-sum / generalized-birthday),
   so the **salt** is load-bearing: derive it from the validation-height blockhash
   **plus per-node randomness**, so a forger gets only one blind try per node.
   SwiftSync's *original* construction was **MuHash** (provably birthday-resistant);
   keep the `Accumulator` interface swappable so MuHash is a drop-in when provable
   security (no salt argument) is wanted, at some speed cost.
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
