// A commutative, invertible UTXO-set accumulator for SwiftSync.
//
// add() a coin when it is created, remove() it when it is spent. A coin created
// and spent within the validated range cancels, so after the whole chain the
// digest is the hash of exactly the *unspent* set — which you compare against a
// trusted UTXO-set commitment. Because add/remove are commutative and order
// never matters, blocks can be validated in any order and across many cores:
// each worker keeps its own Accumulator and they merge() at the end.
//
// Construction (default): an additive hash. Each coin's canonical encoding is
// domain-separated-SHA256'd to a 256-bit element; the accumulator is the sum of
// those elements mod 2^256 (remove = subtract). This is fast — SwiftSync's whole
// point — and secure enough *because the same construction also computes the
// trusted commitment* (it's an internal, self-consistent choice). DESIGN.md
// records the stronger alternative (ECMH, an elliptic-curve multiset hash) for
// when a published, cross-implementation commitment is wanted.
//
// sha256 is injected — this package couples to the kernel only through what the
// caller passes, never an import (a WASM-backed sha256 keeps add/remove fast).

const MOD = 1n << 256n;
const toBig = (b) => { let n = 0n; for (let i = 0; i < b.length; i++) n = (n << 8n) | BigInt(b[i]); return n; };
const fromBig = (n) => { const b = new Uint8Array(32); for (let i = 31; i >= 0; i--) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };

export class Accumulator {
  // opts.sha256: (Uint8Array) -> Uint8Array(32)
  constructor({ sha256 } = {}) {
    if (typeof sha256 !== 'function') throw new Error('Accumulator needs a sha256(bytes) function');
    this._h = sha256;
    this.acc = 0n;
  }

  // Map a canonical coin encoding to a 256-bit element (domain-separated so a raw
  // coin encoding can never collide with some other hashed structure).
  _elem(coinBytes) {
    const tagged = new Uint8Array(coinBytes.length + 1);
    tagged[0] = 0x53;                 // 'S' — SwiftSync coin domain tag
    tagged.set(coinBytes, 1);
    return toBig(this._h(tagged));
  }

  add(coinBytes)    { this.acc = (this.acc + this._elem(coinBytes)) % MOD; return this; }
  remove(coinBytes) { this.acc = (this.acc - this._elem(coinBytes) + MOD) % MOD; return this; }
  digest()          { return fromBig(this.acc); }            // 32-byte commitment of the live set
  merge(other)      { this.acc = (this.acc + other.acc) % MOD; return this; }  // combine a parallel partial
}
