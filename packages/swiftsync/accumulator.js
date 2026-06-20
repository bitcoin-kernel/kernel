// A commutative, invertible UTXO-set accumulator for SwiftSync.
//
// add() a coin when it is created, remove() it when it is spent. A coin created
// and spent within the validated range cancels, so after the whole chain the
// digest is the hash of exactly the *unspent* set — which you compare against a
// trusted UTXO-set commitment. Because add/remove are commutative and order
// never matters, blocks can be validated in any order and across many cores:
// each worker keeps its own Accumulator and they merge() at the end.
//
// Construction (default): a salted additive hash. Each coin's canonical encoding
// is SHA256'd with a salt to a 256-bit element; the accumulator is the sum of
// those elements mod 2^256 (remove = subtract). This is fast — SwiftSync's point.
//
// The SALT is essential, not decoration: plain additive hashing is collision-weak,
// so per the bitcoin-dev review (gmaxwell) the salt must be a secret-ish function
// of the blockhash at the validation height (deterministic per run, ideally plus
// per-node randomness) — "an attacker should only get one try per node". The
// caller derives it and passes it in. MuHash (provably birthday-resistant) is the
// stronger, slower alternative; see DESIGN.md.
//
// sha256 is injected — this package couples to the kernel only through what the
// caller passes, never an import (a WASM-backed sha256 keeps add/remove fast).

const MOD = 1n << 256n;
const toBig = (b) => { let n = 0n; for (let i = 0; i < b.length; i++) n = (n << 8n) | BigInt(b[i]); return n; };
const fromBig = (n) => { const b = new Uint8Array(32); for (let i = 31; i >= 0; i--) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };

export class Accumulator {
  // opts.sha256: (Uint8Array) -> Uint8Array(32)
  // opts.salt:   Uint8Array — derive from the validation-height blockhash (+ per-node
  //              randomness). Default empty ONLY for tests; production MUST pass a salt.
  constructor({ sha256, salt = new Uint8Array(0) } = {}) {
    if (typeof sha256 !== 'function') throw new Error('Accumulator needs a sha256(bytes) function');
    this._h = sha256;
    this._salt = salt;
    this.acc = 0n;
  }

  // Map a canonical coin encoding to a 256-bit element: SHA256(tag || coin || salt).
  // The tag domain-separates; the salt is the collision-resistance lever.
  _elem(coinBytes) {
    const t = new Uint8Array(1 + coinBytes.length + this._salt.length);
    t[0] = 0x53;                       // 'S' — SwiftSync coin domain tag
    t.set(coinBytes, 1);
    t.set(this._salt, 1 + coinBytes.length);
    return toBig(this._h(t));
  }

  add(coinBytes)    { this.acc = (this.acc + this._elem(coinBytes)) % MOD; return this; }
  remove(coinBytes) { this.acc = (this.acc - this._elem(coinBytes) + MOD) % MOD; return this; }
  digest()          { return fromBig(this.acc); }            // 32-byte commitment of the live set
  merge(other)      { this.acc = (this.acc + other.acc) % MOD; return this; }  // combine a parallel partial
}
