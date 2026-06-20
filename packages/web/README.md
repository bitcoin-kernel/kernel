# @bitcoin-kernel/web

A Bitcoin node in the browser — the reusable, DOM-free primitives that make a web
page a real (windowed) validating node:

- **`cache.js`** — OPFS block cache + IndexedDB txid→height index (the Store seam)
- **`sources.js`** — source registry: local cache → peers → explorers, capability-dispatched
- **`mesh.js`** — WebRTC peer mesh over a JSS `/.webrtc` tracker; blocks self-verify by hash, so peers are untrusted
- **`dag.js`** — in-window transaction DAG verification (real script+sig checks for spends whose funding coin is also held)

Verification is delegated to `@bitcoin-kernel/kernel`. Nothing here touches the
DOM — presentation lives in the demo apps that consume this library.

> Extraction in progress: these modules are being moved in clean from the
> bitcoin-kernel.com website repo, leaving the site as a thin presentation layer.
