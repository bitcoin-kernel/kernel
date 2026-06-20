# @bitcoin-kernel/swiftsync

Stateless, parallel **fast initial validation**. Instead of building the UTXO set
block-by-block, keep a single **cancelling accumulator**: add a coin when it's
created, remove it when it's spent. Coins created-and-spent within the range
cancel, so the final digest is the hash of exactly the unspent set — checked
against a trusted UTXO-set commitment. Commutative, so it parallelises across all
cores; still validates every script. The hint is untrusted (a wrong hint only
makes validation fail, never falsely pass).

```js
import { Accumulator, encodeCoin } from '@bitcoin-kernel/swiftsync';
const acc = new Accumulator({ sha256 });          // sha256 injected (WASM-backed for speed)
acc.add(encodeCoin(coin));                          // coin created
acc.remove(encodeCoin(coin));                        // coin spent
acc.digest();                                        // 32-byte commitment of the live set
```

See **DESIGN.md** for the approach, the validate-sync oracle, and open decisions.
Status: accumulator with verified invariants; engine wiring pending decision (3)
in DESIGN.md (prevout sourcing at spend time).
