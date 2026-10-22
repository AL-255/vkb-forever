import { frame, parseFrame, pack7, unpack7, hex, u7 } from './protocol.js';
import { createExchange, encryptSinger, decryptSinger } from './session.js';
export class Keyboard extends EventTarget {
  constructor(transport) {
    super(); this.transport = transport; this.waiters = new Set(); this.registry = []; this.metadata = new Map(); this.ready = false; this.key = null; this.logs = [];
    transport.addEventListener('midi', e => this.receive(e.detail));
    transport.addEventListener('packet', e => this.log(e.detail.direction, e.detail.hex));
    transport.addEventListener('connection', e => {
      this.ready = false; this.key = null; this.registry = []; this.metadata.clear();
      for (const w of this.waiters) w.reject(Error('Connection changed'));
      this.waiters.clear(); this.emit('status', e.detail.connected ? 'Connected; synchronization needed' : 'Offline');
    });
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  log(direction, message) { this.logs.push({ time: new Date().toISOString(), direction, message }); if (this.logs.length > 1200) this.logs.shift(); this.emit('log', this.logs.at(-1)); }
  send(address, payload = []) { return this.transport.send(frame(address, payload)); }
  requireReady() { if (!this.ready) throw Error('Connect and synchronize the keyboard first'); }
  async request(address, payload, reply, timeout = 10000, predicate = () => true) {
    let timer, settled = false, resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const waiter = { address: reply.join(','), predicate, resolve: result => finish(null, result), reject: error => finish(error) };
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); this.waiters.delete(waiter); error ? reject(error) : resolve(value); };
    // Install before sending, so an ACK during a slow upload is not lost.
    this.waiters.add(waiter);
    const sent = Promise.resolve().then(() => this.send(address, payload)).then(() => {
      if (!settled) timer = setTimeout(() => finish(Error(`No reply at ${hex(reply)} after ${timeout / 1000}s; device state is unknown`)), timeout);
    }, error => { finish(error); throw error; });
    // An early reply must not report success before the complete send finishes.
    return Promise.all([sent,promise]).then(([,replyPayload]) => replyPayload);
  }
  receive(bytes) {
    const message = parseFrame(bytes); if (!message) return;
    this.log('RX MIDI', hex(bytes));
    const { address: a, payload: p } = message;
    if (a[0] === 0x0f && a[2] === 0x10) {
      if (p[0] === 0) this.metadata.clear();
      if (p[0] === 1) {
        this.registry = [...this.metadata.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r).filter(r => /^(VY1|MIK|MEG|IA|YKR)/.test(r.id || ''));
        this.emit('registry', this.registry);
      }
    }
    if (a[0] === 0x11) {
      const r = this.metadata.get(a[1]) || {};
      if (a[2] === 0) r.id = new TextDecoder().decode(Uint8Array.from(p)).replace(/\0.*$/, '');
      if (a[2] === 8) r.language = new TextDecoder().decode(Uint8Array.from(p)).replace(/\0.*$/, '');
      this.metadata.set(a[1], r);
    }
    for (const w of [...this.waiters]) if (w.address === a.join(',') && w.predicate(p)) w.resolve(p);
    this.emit('message', message);
  }
  async synchronize() {
    if (this.syncing) throw Error('Synchronization is already running');
    if (!this.transport.connected) throw Error('Connect a keyboard first');
    this.syncing = true; this.ready = false; this.key = null;
    const generation = this.transport.generation;
    try {
      this.emit('status', 'Reading firmware version…');
      if (this.transport.kind === 'ble') await new Promise(resolve => setTimeout(resolve, 3000));
      if (generation !== this.transport.generation) throw Error('Connection changed');
      const version = await this.request([15,0,4], [], [15,0,17], 20000);
      this.version = new TextDecoder().decode(Uint8Array.from(version)).replace(/\0/g, '');
      this.emit('status', 'Establishing instrument session…');
      const exchange = createExchange();
      this.key = exchange.finish(await this.request([1,0,0], exchange.payload, [1,0,0], 20000));
      this.emit('status', 'Receiving instrument data…');
      await this.request([15,0,0], [], [15,0,16], 20000, p => p[0] === 1);
      if (generation !== this.transport.generation) throw Error('Connection changed');
      this.ready = true;
      try { await this.availability(); } catch (error) { this.log('INFO', `Singer availability: ${error.message}`); }
      this.emit('status', 'Ready');
    } catch (error) { this.ready = false; this.key = null; this.emit('status', 'Synchronization failed'); throw error; }
    finally { this.syncing = false; }
  }
  async singerCommand(operation, text) {
    if (!this.key) throw Error('No instrument session key');
    if (this.singerBusy) throw Error('A singer request is already running');
    this.singerBusy = true;
    try {
      const key = this.key;
      const payload = pack7(encryptSinger(new TextEncoder().encode(text), key));
      const response = await this.request([127,0,operation], payload, [127,0,operation], 3000);
      const decoded = new TextDecoder().decode(Uint8Array.from(decryptSinger(unpack7(response), key))).split('\0')[0];
      if (!decoded.startsWith(operation ? 'TRACRS' : 'TRAVRS')) throw Error('Unexpected singer reply');
      const result = Number(decoded[6]);
      if (decoded[6] !== '0') throw Error(['Success','Device rejected request','Already activated','Low battery','Device timeout','Transmission error'][result] || 'Unknown singer result');
      return decoded.slice(7);
    } finally { this.singerBusy = false; }
  }
  async availability() {
    const records = await this.singerCommand(0, 'TRAVRQ');
    for (let i = 0; i + 9 <= records.length; i += 9) {
      if (!/^\d$/.test(records[i])) break;
      const id = records.slice(i + 1, i + 9); const singer = this.registry.find(r => r.id === id);
      if (singer) singer.available = records[i] === '1';
    }
    this.emit('registry', this.registry);
  }
  async activate(id) { this.requireReady(); await this.singerCommand(1, 'TRACRQ1' + id); await this.availability(); }
  async uploadLyric(slot, payload) {
    this.requireReady(); if (this.lyricBusy) throw Error('Another lyric transfer is running');
    this.lyricBusy = true;
    try { await this.request([34,slot,0], payload, [34,slot,1], 5000); }
    finally { this.lyricBusy = false; }
  }
  async position(index) { this.requireReady(); await this.send([33,127,0], u7(index, 2)); }
  async loop(start, count) { this.requireReady(); await this.send([33,127,2], [...u7(start,2), ...u7(count,2)]); }
}
