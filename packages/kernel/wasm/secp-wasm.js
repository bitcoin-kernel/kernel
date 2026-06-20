// Bundler-free WASM secp256k1 verify backend for the browser engine.
//
// Loads tiny-secp256k1's libsecp256k1 (compiled to WebAssembly) with a plain
// WebAssembly.instantiate(fetch(...)) — no bundler, no `import "*.wasm"`, just
// standard browser APIs. Provides the engine's verify hook ({ ecdsa, schnorr });
// roughly 16x the pure-JS path per signature. This is the SAME .wasm the node
// validates against Bitcoin Core's script_tests vectors, with the same input
// marshalling as tiny-secp256k1's own verify(), so verdicts match the proven
// path. Falls back silently (loadSecpWasm resolves false) where WASM is
// unavailable, leaving the engine on its pure-JS default.

let X = null;                  // wasm exports
let buf = null;                // Uint8Array view over wasm memory
let HASH, PUB, XPUB, SIG;      // input windows at the exported pointer globals
let ready = null;

const win = (g, len) => buf.subarray(g.value, g.value + len);

export function loadSecpWasm(url = new URL('./secp256k1.wasm', import.meta.url).href) {
  if (ready) return ready;
  ready = (async () => {
    if (typeof WebAssembly === 'undefined' || typeof fetch === 'undefined') return false;
    try {
      const imports = {
        // libsecp256k1 randomizes its context for side-channel hardening
        './rand.js': { generateInt32: () => { const a = new Uint8Array(4); crypto.getRandomValues(a); return (a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]; } },
        './validate_error.js': { throwError: () => { throw new Error('secp wasm: invalid input'); } },
      };
      let instance;
      try { ({ instance } = await WebAssembly.instantiateStreaming(fetch(url), imports)); }
      catch { instance = (await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), imports)).instance; }
      X = instance.exports;
      X.initializeContext();
      buf = new Uint8Array(X.memory.buffer);
      HASH = win(X.HASH_INPUT, 32);
      PUB = win(X.PUBLIC_KEY_INPUT, 65);
      XPUB = win(X.X_ONLY_PUBLIC_KEY_INPUT, 32);
      SIG = win(X.SIGNATURE_INPUT, 64);
      return true;
    } catch { X = null; return false; }
  })();
  return ready;
}

// h: 32-byte hash, Q: 65-byte uncompressed pubkey, sig: 64-byte compact (r||s)
function verifyEcdsaRaw(h, Q, sig) {
  HASH.set(h); PUB.set(Q); SIG.set(sig);
  const ok = X.verify(Q.length, 0) === 1; // strict=0: low-S/DER are enforced by the engine via flags
  HASH.fill(0); PUB.fill(0); SIG.fill(0);
  return ok;
}
function verifySchnorrRaw(h, Q, sig) {
  HASH.set(h); XPUB.set(Q); SIG.set(sig);
  const ok = X.verifySchnorr() === 1;
  HASH.fill(0); XPUB.fill(0); SIG.fill(0);
  return ok;
}

const b32 = (n) => { const b = new Uint8Array(32); let x = n; for (let i = 31; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; } return b; };

// Engine verify backend. The engine hands ECDSA as {r,s} BigInts + pubkey as
// [x,y] BigInts, and Schnorr as raw 32/64-byte arrays — same shapes the node's
// wasm-secp.js converts, kept identical here.
export const wasmBackend = {
  ecdsa(msgHash, sig, pubkey) {
    const pub = new Uint8Array(65); pub[0] = 4; pub.set(b32(pubkey[0]), 1); pub.set(b32(pubkey[1]), 33);
    const s = new Uint8Array(64); s.set(b32(sig.r), 0); s.set(b32(sig.s), 32);
    try { return verifyEcdsaRaw(msgHash, pub, s); } catch { return false; }
  },
  schnorr(msg32, sig64, pubkey32) {
    try { return verifySchnorrRaw(msg32, pubkey32, sig64); } catch { return false; }
  },
};
