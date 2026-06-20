// Shared OPFS block cache — a small Store seam used by every page on this origin.
// Keeps the most recent CAP blocks on the device so revisits don't go back to an
// explorer. Backing is naive (one file per block, named by hash) but the
// interface mirrors the node's BlockStore so it can evolve toward the sharded
// mesh, where a node serves the blocks it holds. OPFS is origin-scoped, so the
// verify page and the cache page read the exact same store.
// How many recent blocks to retain (the node's window). User-adjustable on the
// "Your node" page up to the browser's storage quota; persisted in localStorage.
const CAP_KEY = 'bk:maxblocks', CAP_DEFAULT = 50;
let capValue = CAP_DEFAULT;
try { const v = Number(localStorage.getItem(CAP_KEY)); if (Number.isFinite(v) && v >= 1) capValue = Math.floor(v); } catch {}

let dir = null, idx = { byHeight: {}, byHash: {} }, ready = null;

async function load() {
  if (!navigator.storage || !navigator.storage.getDirectory) throw new Error('no OPFS');
  const root = await navigator.storage.getDirectory();
  dir = await root.getDirectoryHandle('blocks', { create: true });
  try { idx = JSON.parse(await (await (await root.getFileHandle('blocks-index.json')).getFile()).text()); } catch {}
  idx.byHeight = idx.byHeight || {}; idx.byHash = idx.byHash || {};
  if (navigator.storage.persist) navigator.storage.persist();
}

async function saveIndex() {
  const root = await navigator.storage.getDirectory();
  const w = await (await root.getFileHandle('blocks-index.json', { create: true })).createWritable();
  await w.write(JSON.stringify(idx)); await w.close();
}

// Retention: keep the capValue highest blocks by height, so the node holds a
// contiguous recent window from the tip down (not a scatter of whatever was last
// touched). Lowering the cap evicts the excess; "Grow your node" fills/slides
// the window without evicting its own tip. Caller persists the index.
async function evictToCap() {
  if (!dir) return;
  const all = Object.keys(idx.byHash);
  if (all.length <= capValue) return;
  all.sort((a, b) => idx.byHash[b].height - idx.byHash[a].height);
  for (const old of all.slice(capValue)) {
    try { await dir.removeEntry(old + '.bin'); } catch {}
    const oh = idx.byHash[old].height; delete idx.byHash[old];
    if (idx.byHeight[oh] === old) delete idx.byHeight[oh];
  }
}

// --- txid -> height index (IndexedDB) ---
// A block has up to thousands of txids, so this needs many small entries with
// incremental writes and O(1) async lookups — IndexedDB, not a rewritten JSON
// file. The mapping is a permanent fact (a tx lives at one height forever, barring
// a deep reorg), so we keep it even after the block's bytes are evicted: the index
// only grows as you browse, and lets the tx page resolve a coin's funding block
// with zero explorer calls.
let db = null, dbReady = null;
function openDB() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open('bitcoin-kernel', 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('txheight')) d.createObjectStore('txheight'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}
function tx(mode) { return db.transaction('txheight', mode).objectStore('txheight'); }

export const cache = {
  get CAP() { return capValue; },                       // current window size (blocks)
  async setCap(n) {                                     // user changes the window size
    capValue = Math.max(1, Math.floor(n));
    try { localStorage.setItem(CAP_KEY, String(capValue)); } catch {}
    if (dir) { await evictToCap(); try { await saveIndex(); } catch {} }
  },
  avgBlockSize() {                                      // bytes; from what's cached, else ~2MB
    const e = Object.values(idx.byHash).filter((x) => x.size);
    return e.length ? Math.round(e.reduce((s, x) => s + x.size, 0) / e.length) : 2_000_000;
  },
  async maxBlocks() {                                   // how many blocks fit, at 80% of quota
    const q = await this.quota();
    if (!q.quota) return Math.max(capValue, 2000);
    return Math.max(capValue, Math.floor((q.quota * 0.8) / this.avgBlockSize()));
  },
  init() { if (!ready) ready = load().then(() => true).catch(() => { dir = null; return false; }); return ready; },
  available: () => !!dir,
  hashForHeight: (h) => idx.byHeight[h] || null,

  async get(hash) {
    if (!dir || !hash || !idx.byHash[hash]) return null;
    try {
      const bytes = new Uint8Array(await (await (await dir.getFileHandle(hash + '.bin')).getFile()).arrayBuffer());
      idx.byHash[hash].last = Date.now();
      return bytes;
    } catch { delete idx.byHash[hash]; return null; }
  },

  async put(hash, height, bytes) {
    if (!dir) return;
    try {
      const w = await (await dir.getFileHandle(hash + '.bin', { create: true })).createWritable();
      await w.write(bytes); await w.close();
      const prev = idx.byHash[hash] || {};
      idx.byHash[hash] = { height, size: bytes.length, last: Date.now(), verified: prev.verified || false };
      idx.byHeight[height] = hash;
      await evictToCap();
      await saveIndex();
    } catch {}
  },

  // mark a cached block as having passed full structural verification
  async markVerified(hash) {
    if (!dir || !idx.byHash[hash]) return;
    if (idx.byHash[hash].verified) return;
    idx.byHash[hash].verified = true;
    try { await saveIndex(); } catch {}
  },

  stats() {
    const e = Object.values(idx.byHash);
    return { n: e.length, bytes: e.reduce((s, x) => s + (x.size || 0), 0), verified: e.filter((x) => x.verified).length };
  },

  // full listing for the cache page, newest height first
  entries() {
    return Object.entries(idx.byHash)
      .map(([hash, v]) => ({ hash, height: v.height, size: v.size || 0, verified: !!v.verified, last: v.last || 0 }))
      .sort((a, b) => b.height - a.height);
  },

  async clear() {
    if (dir) {
      for (const hash of Object.keys(idx.byHash)) { try { await dir.removeEntry(hash + '.bin'); } catch {} }
      idx = { byHeight: {}, byHash: {} };
      try { await saveIndex(); } catch {}
    }
    await this.initTx();
    if (db) { try { tx('readwrite').clear(); } catch {} }
  },

  // --- txid -> height index ---
  initTx() { if (!dbReady) dbReady = openDB().then((d) => { db = d; return !!d; }); return dbReady; },

  // record every txid in a decoded block at that block's height (one transaction)
  async indexBlock(height, txids) {
    await this.initTx(); if (!db) return;
    try {
      const store = tx('readwrite');
      for (const t of txids) store.put(height, t);
      await new Promise((res, rej) => { store.transaction.oncomplete = res; store.transaction.onerror = () => rej(); });
    } catch {}
  },

  // record a single tx's height (learned from fetching one transaction)
  async indexTx(txid, height) {
    await this.initTx(); if (!db || height == null) return;
    try { tx('readwrite').put(height, txid); } catch {}
  },

  // the funding block of a coin, if we've already seen the block that created it
  async heightForTx(txid) {
    await this.initTx(); if (!db) return null;
    return new Promise((resolve) => { try { const r = tx('readonly').get(txid); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); } catch { resolve(null); } });
  },

  async txCount() {
    await this.initTx(); if (!db) return 0;
    return new Promise((resolve) => { try { const r = tx('readonly').count(); r.onsuccess = () => resolve(r.result || 0); r.onerror = () => resolve(0); } catch { resolve(0); } });
  },

  async quota() {
    try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; }
    catch { return { usage: 0, quota: 0 }; }
  },
};
