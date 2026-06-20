// @bitcoin-kernel/web — a Bitcoin node in the browser.
//
// DOM-free primitives that make a web page a real (windowed) validating node.
// Verification is delegated to a kernel (Codec / BlockEngine) the caller injects
// into verifyDag — this library imports no engine code, only receives it.

export { cache } from './cache.js';                                   // OPFS block cache + txid→height index
export { Sources, CacheSource, PeerSource, ExplorerSource } from './sources.js'; // source registry
export { Mesh, swarmHash } from './mesh.js';                          // WebRTC peer mesh
export { verifyDag } from './dag.js';                                 // in-window transaction DAG verification
