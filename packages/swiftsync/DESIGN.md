# SwiftSync — design

Fast initial validation (Ruben Somsen, 2024) implemented for the bitcoin-kernel
engine. Normal IBD is slow because it processes blocks strictly in order and
holds the whole UTXO set throughout. SwiftSync replaces the UTXO set with a
single **cancelling accumulator**:

- coin **created** → `add(+)`
- coin **spent** → `remove(−)`
- coins created *and* spent within the range **cancel**

After the chain, the accumulator's digest is the hash of exactly the **unspent**
set. Compare it to a **trusted UTXO-set commitment**; match = validated. Because
add/remove are commutative, validation parallelises across cores (each worker
keeps an `Accumulator`, all `merge()` at the end) with no sequential UTXO-set
dependency. Every script/signature is still checked — only the bookkeeping
changed. The **hint** (which coins are spent-within-range) is untrusted: a wrong
hint makes the digest *not match* and validation fail; it can never make an
invalid chain pass.

## The oracle (why this is low-risk for us)

`bitcoin-kernel/node`'s `validate-sync` already builds the **real** UTXO set the
slow way. So the same construction (see below) applied to validate-sync's final
UTXO set is our **trusted commitment**, and a SwiftSync run that ends on the same
digest is proven correct against our own ground truth — the same differential
method we use against Bitcoin Core. No external reference needed.

## Components

- `accumulator.js` — the commutative add/remove/merge accumulator. **Done.**
- `index.js` `encodeCoin` — canonical coin bytes. Default format; see decisions.
- (todo) `hint.js` — generate/parse the spent-within-range hint from a validated chain.
- (todo) `validate.js` — drive the engine over blocks producing add/remove ops, in parallel workers, ending on a digest.
- (todo) oracle test — run validate-sync + SwiftSync over testnet4; assert equal digests.

## Open decisions

1. **Accumulator construction.** Default = *additive hash* (sum of domain-separated
   SHA256 elements mod 2²⁵⁶): fast, fine because we compute *both* sides. Stronger
   alternative = **ECMH** (elliptic-curve multiset hash; we already have secp256k1)
   — pick this only if we want a *published, cross-implementation* commitment.
   Recommendation: ship additive now, keep the `Accumulator` interface swappable.
2. **Coin encoding.** Default `txid||vout||amount||scriptPubKey`. Decision: include
   `height`/`coinbase`? Only if the commitment must bind coinbase maturity.
3. **Prevout data at spend time.** Scripts still need the spent output's
   scriptPubKey+amount. Decide how the validator obtains it without the UTXO set
   (carry it in the hint, or a bounded two-pass). This is the main remaining design
   question and the next thing to pin down.
4. **Commitment source for testnet4.** Use validate-sync's UTXO-set digest as the
   trusted value (internal oracle); later, an assumeUTXO-style published hash.

## Status

Scaffold + accumulator with verified invariants (cancellation, commutativity,
parallel merge). Not yet wired to the engine — that follows once decision (3) is
settled.
