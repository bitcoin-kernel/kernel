// SwiftSync hash aggregator — matches the reference `aggregate` crate
// (github.com/2140-dev/swiftsync) so our digests interoperate with it and the
// btcd/floresta implementations, which lets us validate against *their* hints
// (our differential de-risker).
//
// The accumulator is TWO INDEPENDENT 128-bit lanes (high, low), each wrapping
// mod 2^128 — not a single 256-bit number, so there is no carry between lanes.
// Each element is a tagged hash SHA256("SwiftSync" tag) of a preimage, split into
// high/low 16-byte big-endian halves which are added to / subtracted from the
// lanes. A set whose elements are added and spent an equal number of times
// returns to zero.
//
//   element  = taggedSHA256("SwiftSync", preimage)         (32 bytes)
//   lane.high += be_u128(element[0..16])  (mod 2^128)
//   lane.low  += be_u128(element[16..32]) (mod 2^128)
//
// Preimage = the outpoint for the assumevalid variant (reference default), or the
// full coin 5-tuple for the non-assumevalid (full-validation) variant — same
// accumulator either way (see ../index.js encodeOutpoint / encodeCoin).
//
// sha256 is injected (kernel-coupling-free; WASM-backed keeps it fast).
//
// SALT is intentional, not optional hardening: per Somsen it is "a cheap way to
// get a secure hash aggregate" — the saltless alternative is MuHash, "a much more
// expensive operation". The salt is per-run (derive from the validation-height
// blockhash, ideally + per-node randomness), so it is NOT an interop value: the
// shareable artifact is the salt-free 1-bit hint, while each node recomputes its
// own salted commitment locally. Production passes a salt; salt=null reproduces
// the early reference prototype (currently unsalted) and is used by the tests.

const M = 1n << 128n;
const beU128 = (b, off) => { let n = 0n; for (let i = 0; i < 16; i++) n = (n << 8n) | BigInt(b[off + i]); return n; };
const u128be = (n) => { const b = new Uint8Array(16); for (let i = 15; i >= 0; i--) { b[i] = Number(n & 0xffn); n >>= 8n; } return b; };

export class Accumulator {
  // opts.sha256: (Uint8Array) -> Uint8Array(32). opts.salt: Uint8Array | null.
  constructor({ sha256, salt = null } = {}) {
    if (typeof sha256 !== 'function') throw new Error('Accumulator needs a sha256(bytes) function');
    this._h = sha256;
    this._tag = sha256(new TextEncoder().encode('SwiftSync')); // BIP340-style tag
    this._salt = salt;
    this.high = 0n;
    this.low = 0n;
  }

  // taggedSHA256(preimage) = SHA256(tag || tag || preimage [|| salt])
  hash(preimage) {
    const sl = this._salt ? this._salt.length : 0;
    const m = new Uint8Array(64 + preimage.length + sl);
    m.set(this._tag, 0); m.set(this._tag, 32); m.set(preimage, 64);
    if (this._salt) m.set(this._salt, 64 + preimage.length);
    return this._h(m);
  }

  add(preimage)       { return this.addHash(this.hash(preimage)); }
  spend(preimage)     { return this.spendHash(this.hash(preimage)); }
  // hot path: feed a precomputed 32-byte element hash (hashing dominates cost)
  addHash(h)   { this.high = (this.high + beU128(h, 0)) % M; this.low = (this.low + beU128(h, 16)) % M; return this; }
  spendHash(h) { this.high = (this.high - beU128(h, 0) + M) % M; this.low = (this.low - beU128(h, 16) + M) % M; return this; }

  isZero()  { return this.high === 0n && this.low === 0n; }
  digest()  { const d = new Uint8Array(32); d.set(u128be(this.high), 0); d.set(u128be(this.low), 16); return d; }
  merge(o)  { this.high = (this.high + o.high) % M; this.low = (this.low + o.low) % M; return this; }
}
