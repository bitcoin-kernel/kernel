// Source interface — where blocks and chain data come from.
//
// A source can serve raw block bytes by hash; some can also resolve a height to
// a hash, fetch a transaction, or report the chain tip. Sources are tried in
// priority order behind the cache: local cache -> peers (future) -> explorers.
//
// Every block self-verifies by hash, so the caller never has to trust a source:
// it checks proof-of-work and the merkle root against the header it already
// trusts. That is exactly what lets a peer mesh slot in here as just another
// source, with no change to the verification path.
//
// getBlock(hash, onProgress?) resolves to { bytes, from, dlMs } or null.
// from is a human label for where it came from ('your device', a host, a peer).

export class CacheSource {
  constructor(cache) { this.cache = cache; this.name = 'cache'; }
  hashForHeight(h) { return this.cache.hashForHeight(h); }       // sync, from the local index
  async getBlock(hash) {
    const b = await this.cache.get(hash);
    return b ? { bytes: b, from: 'your device', dlMs: 0 } : null;
  }
}

// Peers in the WebRTC mesh, between cache and explorer in the registry. The mesh
// returns { bytes, from:'a peer' } or null; the caller verifies by hash, so an
// untrusted peer cannot pass off a bad block.
export class PeerSource {
  constructor(mesh) { this.mesh = mesh; this.name = 'peer'; }
  async getBlock(hash) { return this.mesh ? this.mesh.getBlock(hash) : null; }
}

export class ExplorerSource {
  constructor(bases) { this.bases = bases; this.name = 'explorer'; this.host = bases[0].replace('https://', ''); }
  async _res(path) {
    let lastErr;
    for (const base of this.bases) {
      try {
        const r = await fetch(base + path);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        this.host = base.replace('https://', '');
        return r;
      } catch (e) { lastErr = e; }
    }
    throw new Error('block explorers unreachable (' + (lastErr ? lastErr.message : 'CORS/offline') + ')');
  }
  async tipHeight() { return Number((await (await this._res('/api/blocks/tip/height')).text()).trim()); }
  async hashForHeight(h) { return (await (await this._res('/api/block-height/' + h)).text()).trim(); }
  async tx(txid) { return (await this._res('/api/tx/' + txid)).json(); }
  async txHex(txid) { return (await (await this._res('/api/tx/' + txid + '/hex')).text()).trim(); }
  async getBlock(hash, onProgress) {
    const resp = await this._res('/api/block/' + hash + '/raw');
    const total = +resp.headers.get('content-length') || 0;
    const reader = resp.body.getReader();
    const chunks = []; let received = 0; const t0 = performance.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (onProgress) onProgress(received, total);
    }
    const bytes = new Uint8Array(received); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, from: this.host, dlMs: performance.now() - t0 };
  }
}

// Registry: tries each source in order for a given capability, first hit wins.
// A source that lacks a method is skipped; a source that throws is treated as a
// miss but its error is kept, so a total failure surfaces the real reason.
export class Sources {
  constructor(list) { this.list = list || []; }
  add(src) { this.list.push(src); return this; }

  async _firstTruthy(method, args, { throwIfNone = false } = {}) {
    let lastErr;
    for (const s of this.list) {
      if (typeof s[method] !== 'function') continue;
      try { const x = await s[method](...args); if (x != null && x !== '') return x; }
      catch (e) { lastErr = e; }
    }
    if (throwIfNone && lastErr) throw lastErr;
    return null;
  }

  hashForHeight(h) { return this._firstTruthy('hashForHeight', [h], { throwIfNone: true }); }
  tipHeight() { return this._firstTruthy('tipHeight', [], { throwIfNone: true }); }
  tx(txid) { return this._firstTruthy('tx', [txid], { throwIfNone: true }); }
  txHex(txid) { return this._firstTruthy('txHex', [txid], { throwIfNone: true }); }

  async getBlock(hash, onProgress) {
    let lastErr;
    for (const s of this.list) {
      if (typeof s.getBlock !== 'function') continue;
      try { const r = await s.getBlock(hash, onProgress); if (r && r.bytes) return r; }
      catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    throw new Error('no source could provide block ' + hash);
  }
}
