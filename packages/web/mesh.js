// Browser block mesh over WebRTC, signalled by a JSS /.webrtc tracker.
//
// Bring-your-own tracker — there is no default; the codebase hard-codes no
// endpoint. A peer joins a swarm (a hex hash) on a tracker URL the user provides
// (setting or ?tracker=), connects to other peers in that swarm over WebRTC data
// channels, and serves/fetches raw block bytes. Every block self-verifies by
// hash, so peers are untrusted: a hostile peer can stall but cannot feed a bad
// block (the caller checks PoW + merkle against the header it already trusts).
//
// Signalling (JSS content-addressed mode, non-trickle ICE):
//   → { type:'announce', resource:<hex>, offers:[{ sdp, offer_id }, ...] }
//   ← { type:'resource-peers', resource, count }
//   ← { type:'offer',  resource, from, offer_id, sdp }   (a later joiner's offer)
//   → { type:'answer', resource, to,   offer_id, sdp }
//   ← { type:'answer', resource, from, offer_id, sdp }   (answer to one of my offers)
//   → { type:'leave',  resource }
// Full STUN-gathered candidates are baked into each SDP before it is sent (the
// tracker does not relay ICE candidates in this mode).
//
// Block protocol over the data channel:
//   → {"t":"want","h":<hash>}                request a block by hash
//   ← {"t":"blk","h":<hash>,"n":<size>} + n bytes in binary chunks   (held)
//   ← {"t":"no","h":<hash>}                  not held

const CHUNK = 16 * 1024;            // data-channel-safe chunk size
const HIWATER = 4 * 1024 * 1024;    // backpressure threshold on bufferedAmount
const OFFER_BATCH = 4;              // offers per announce (≈ peers we try to reach)
const REANNOUNCE_MS = 90_000;       // re-announce to discover new peers / refill slots
const FETCH_TIMEOUT = 12_000;       // per-peer block fetch timeout

export async function swarmHash(label) {
  const data = new TextEncoder().encode(label);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const rid = () => crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');

export class Mesh {
  // opts: { tracker, swarm(hex), stun(['stun:...']), serve(hash)->Uint8Array|null,
  //         inventory()->[[height,hash],...], onstatus() }
  constructor(opts) {
    this.tracker = opts.tracker;
    this.swarm = opts.swarm;
    this.iceServers = (opts.stun || ['stun:stun.l.google.com:19302']).map((u) => ({ urls: u }));
    this.serve = opts.serve || (async () => null);
    this.inventory = opts.inventory || (() => []); // what blocks this node holds, for peers to query
    this.onstatus = opts.onstatus || (() => {});
    this.ws = null;
    this.peers = new Map();          // peerId -> { pc, ch, recv }
    this.pendingOffers = new Map();  // offer_id -> pc (offers awaiting an answer)
    this.running = false;
    this._timer = null;
  }

  status() { return { connected: this.running && this.ws && this.ws.readyState === 1, peers: this.peers.size }; }
  _emit() { this.onstatus(this.status()); }

  start() {
    if (this.running) return;
    this.running = true;
    this._open();
  }

  stop() {
    this.running = false;
    if (this._timer) clearInterval(this._timer);
    try { this._send({ type: 'leave', resource: this.swarm }); } catch {}
    for (const { pc } of this.peers.values()) { try { pc.close(); } catch {} }
    this.peers.clear(); this.pendingOffers.clear();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this._emit();
  }

  _open() {
    let ws;
    try { ws = new WebSocket(this.tracker); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this._announce(); this._timer = setInterval(() => this._announce(), REANNOUNCE_MS); this._emit(); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this._onSignal(m); };
    ws.onclose = () => { if (this._timer) clearInterval(this._timer); this._emit(); if (this.running) setTimeout(() => this.running && this._open(), 3000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  _send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // Build a fresh peer connection that *originates* a data channel (offerer side).
  // The channel is kept on the pc and adopted once the answer reveals the peer id.
  async _makeOffer() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc._ch = pc.createDataChannel('blocks');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await iceComplete(pc);
    return { pc, sdp: pc.localDescription.sdp };
  }

  // Announce: attach OFFER_BATCH fresh offers; tracker fans them to distinct peers.
  async _announce() {
    if (!this.ws || this.ws.readyState !== 1) return;
    const offers = [];
    for (let i = 0; i < OFFER_BATCH; i++) {
      try {
        const { pc, sdp } = await this._makeOffer();
        const offer_id = rid();
        this.pendingOffers.set(offer_id, pc);
        // drop an unanswered offer after a while so it doesn't leak
        setTimeout(() => { if (this.pendingOffers.delete(offer_id)) { try { pc.close(); } catch {} } }, FETCH_TIMEOUT * 2);
        offers.push({ offer_id, sdp });
      } catch {}
    }
    if (offers.length) this._send({ type: 'announce', resource: this.swarm, offers });
  }

  async _onSignal(m) {
    if (m.type === 'offer' && m.resource === this.swarm && m.from) {
      // a later joiner wants to connect to us — answer (we receive their channel)
      try {
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        pc.ondatachannel = (ev) => this._adopt(m.from, pc, ev.channel); // answerer: receive the offerer's channel
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await iceComplete(pc);
        this._send({ type: 'answer', resource: this.swarm, to: m.from, offer_id: m.offer_id, sdp: pc.localDescription.sdp });
      } catch {}
    } else if (m.type === 'answer' && m.resource === this.swarm && m.offer_id) {
      const pc = this.pendingOffers.get(m.offer_id);
      if (pc) {
        this.pendingOffers.delete(m.offer_id);
        try { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); this._adopt(m.from, pc, pc._ch); } // offerer: adopt our own channel now we know the peer
        catch { try { pc.close(); } catch {} }
      }
    }
    // resource-peers / errors: informational, nothing to do
  }

  // Register a peer under its id once its data channel is open — same path for
  // both the offerer and the answerer, so both sides see each other.
  _adopt(peerId, pc, ch) {
    ch.binaryType = 'arraybuffer';
    const entry = { pc, ch, recv: null };
    const register = () => { this.peers.set(peerId, entry); this._emit(); };
    const drop = () => { if (this.peers.get(peerId) === entry) { this.peers.delete(peerId); this._emit(); } };
    if (ch.readyState === 'open') register(); else ch.addEventListener('open', register);
    ch.addEventListener('close', drop);
    ch.onmessage = (ev) => this._onData(entry, ev.data);
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) drop(); };
  }

  // Data-channel message: JSON control (string) or a binary chunk (ArrayBuffer).
  _onData(entry, data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'want') { this._serve(entry, m.h); return; }
      if (m.t === 'inv?') { try { entry.ch.send(JSON.stringify({ t: 'inv', b: this.inventory() })); } catch {} return; }
      if (m.t === 'inv') { entry._inv = Array.isArray(m.b) ? m.b : []; if (entry.invDone) { entry.invDone(); entry.invDone = null; } return; }
      if (m.t === 'no') { if (entry.recv && entry.recv.hash === m.h) { entry.recv.reject(new Error('peer lacks block')); entry.recv = null; } return; }
      if (m.t === 'blk') { entry.recv = { ...entry.recv, hash: m.h, size: m.n, buf: new Uint8Array(m.n), got: 0 }; return; }
    } else if (entry.recv) {
      const u = new Uint8Array(data);
      entry.recv.buf.set(u.subarray(0, entry.recv.size - entry.recv.got), entry.recv.got);
      entry.recv.got += u.length;
      if (entry.recv.got >= entry.recv.size) { const r = entry.recv; entry.recv = null; r.resolve(r.buf); }
    }
  }

  async _serve(entry, hash) {
    let bytes = null;
    try { bytes = await this.serve(hash); } catch {}
    if (!bytes) { try { entry.ch.send(JSON.stringify({ t: 'no', h: hash })); } catch {} return; }
    try {
      entry.ch.send(JSON.stringify({ t: 'blk', h: hash, n: bytes.length }));
      for (let i = 0; i < bytes.length; i += CHUNK) {
        if (entry.ch.bufferedAmount > HIWATER) await drain(entry.ch);
        entry.ch.send(bytes.subarray(i, i + CHUNK));
      }
    } catch {}
  }

  // What the swarm collectively holds: height -> hash, from every peer's inventory.
  // Lets the filler pull blocks a peer already has (no explorer hash lookup) and
  // only fall back to the explorer for the racing tip no peer has yet.
  async swarmInventory() {
    const peers = [...this.peers.values()].filter((e) => e.ch.readyState === 'open');
    await Promise.all(peers.map((entry) => new Promise((res) => {
      entry._inv = null; entry.invDone = res;
      const to = setTimeout(() => { entry.invDone = null; res(); }, 2000);
      const done = entry.invDone; entry.invDone = () => { clearTimeout(to); done(); };
      try { entry.ch.send(JSON.stringify({ t: 'inv?' })); } catch { clearTimeout(to); res(); }
    })));
    const inv = new Map();
    for (const entry of peers) if (Array.isArray(entry._inv)) for (const [h, hash] of entry._inv) if (!inv.has(h)) inv.set(h, hash);
    return inv;
  }

  // Ask connected peers for a block; first to return it wins. Caller verifies by hash.
  async getBlock(hash) {
    for (const entry of this.peers.values()) {
      if (entry.ch.readyState !== 'open' || entry.recv) continue;
      try {
        const bytes = await this._request(entry, hash);
        if (bytes) return { bytes, from: 'a peer', dlMs: 0 };
      } catch {}
    }
    return null;
  }

  _request(entry, hash) {
    return new Promise((resolve, reject) => {
      entry.recv = { hash, resolve, reject };
      const to = setTimeout(() => { if (entry.recv && entry.recv.hash === hash) { entry.recv = null; reject(new Error('timeout')); } }, FETCH_TIMEOUT);
      const done = (fn) => (v) => { clearTimeout(to); fn(v); };
      entry.recv.resolve = done(resolve); entry.recv.reject = done(reject);
      try { entry.ch.send(JSON.stringify({ t: 'want', h: hash })); } catch (e) { clearTimeout(to); entry.recv = null; reject(e); }
    });
  }
}

function iceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); res(); } };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(res, 4000); // don't wait forever for a slow/blocked STUN
  });
}

function drain(ch) {
  return new Promise((res) => {
    const lo = ch.bufferedAmountLowThreshold; ch.bufferedAmountLowThreshold = HIWATER / 2;
    const h = () => { ch.removeEventListener('bufferedamountlow', h); ch.bufferedAmountLowThreshold = lo; res(); };
    ch.addEventListener('bufferedamountlow', h);
  });
}
