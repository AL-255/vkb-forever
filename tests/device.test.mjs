import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keyboard } from '../public/js/device.js';
import { Transport } from '../public/js/transport.js';
import { parseFrame, frame, pack7, unpack7, encodeParameter } from '../public/js/protocol.js';
import { createExchange, encryptSinger, decryptSinger } from '../public/js/session.js';
import { soundMessages, soundValue, canonicalSinger } from '../public/js/sound.js';
import { defaultWorkspace } from '../public/js/store.js';
const data=Object.fromEntries(['parameters','lyrics','skills'].map(name=>[name,JSON.parse(readFileSync(new URL(`../public/data/${name}.json`,import.meta.url)))]));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class FakeTransport extends EventTarget {
  constructor() {super();this.generation=0;this.connected=true;this.kind='midi';this.messages=[];}
  reply(address,payload=[]) {this.dispatchEvent(new CustomEvent('midi',{detail:frame(address,payload)}));}
  async send(bytes) {this.messages.push(parseFrame(bytes));await this.respond?.(parseFrame(bytes));}
  disconnect() {this.generation++;this.connected=false;this.dispatchEvent(new CustomEvent('connection',{detail:{connected:false}}));}
}
test('full version/DH/metadata/encrypted-availability startup with reordered singer registry',async()=>{
  const t=new FakeTransport(),k=new Keyboard(t);let peerKey;
  t.respond=({address:a,payload:p})=>{
    if(a.join(',')==='15,0,4')t.reply([15,0,17],[49,48,54]);
    if(a[0]===1){const peer=createExchange(Uint8Array.of(12,34,56));peerKey=peer.finish(p);t.reply([1,0,0],peer.payload);}
    if(a.join(',')==='15,0,0'){
      t.reply([15,0,16],[0]);t.reply([17,4,0],[...new TextEncoder().encode('VY100001')]);t.reply([17,0,0],[...new TextEncoder().encode('MEG00001')]);t.reply([15,0,16],[1]);
    }
    if(a[0]===127){assert.equal(new TextDecoder().decode(Uint8Array.from(decryptSinger(unpack7(p),peerKey))),'TRAVRQ');t.reply([127,0,0],pack7(encryptSinger(new TextEncoder().encode('TRAVRS01MEG000011VY100001'),peerKey)));}
  };
  await k.synchronize();assert.equal(k.ready,true);assert.equal(k.version,'106');assert.deepEqual(k.key,peerKey);
  assert.deepEqual(k.registry.map(r=>r.id),['MEG00001','VY100001']);assert.ok(k.registry.every(r=>r.available));
  assert.deepEqual(t.messages.map(m=>m.address),[[15,0,4],[1,0,0],[15,0,0],[127,0,0]]);
});
test('sound uploads have exact current-copy/stored ordering and preserve all four banks',()=>{
  const drafts=defaultWorkspace(data.parameters).drafts;
  for(const [owner,currentCount,storedCount] of [['vocal',84,82],['pcm',28,26]]){
    const current=soundMessages(drafts[owner],127,1,data),stored=soundMessages(drafts[owner],19,3,data),base=owner==='vocal'?48:64;
    assert.equal(current.length,currentCount);assert.equal(stored.length,storedCount);
    assert.deepEqual(current[0],{address:[base,127,1],payload:[]});assert.deepEqual(current.at(-1),{address:[base,127,2],payload:[1]});
    assert.equal(stored[0].address[2],3);assert.ok(stored.every(m=>m.address[1]===19));
    for(let i=0;i<4;i++)assert.ok(stored.some(m=>m.address[0]===base+1+i));
  }
});
test('singer presets use canonical identity and resolve the runtime registry at transmission',()=>{
  const d=data.parameters.find(d=>d.identifier==='VocaloNumber'),registry=[{id:'MEG00001',available:true},{id:'VY100001',available:true}];
  assert.equal(soundValue(d,0,registry),1);assert.equal(soundValue(d,2,registry),0);
  assert.equal(canonicalSinger(0,registry),2);assert.throws(()=>soundValue(d,1,registry));
  registry[1].available=false;assert.throws(()=>soundValue(d,0,registry));
});
test('lyric ACK arriving during send is retained, and ACK payload is not treated as a status',async()=>{
  const t=new FakeTransport(),k=new Keyboard(t);k.ready=true;
  t.respond=async m=>{t.reply([34,m.address[1],1],[99]);await delay(10);};
  await k.uploadLyric(19,[0,0,0,0,0]);assert.equal(k.waiters.size,0);assert.equal(k.lyricBusy,false);
});
test('requests time out, release waiters and isolate subsequent transactions from old timers',async()=>{
  const t=new FakeTransport(),k=new Keyboard(t);
  await assert.rejects(k.request([1,0,0],[],[1,0,1],8),/No reply/);assert.equal(k.waiters.size,0);
  const next=k.request([1,0,0],[],[1,0,1],100);t.reply([1,0,1],[42]);assert.deepEqual(await next,[42]);await delay(15);assert.equal(k.waiters.size,0);
});
test('send failure and disconnect reject pending request without leaving a stale listener',async()=>{
  const t=new FakeTransport(),k=new Keyboard(t);t.respond=()=>{throw Error('write failed');};
  await assert.rejects(k.request([1,0,0],[],[1,0,0]),/write failed/);assert.equal(k.waiters.size,0);
  t.respond=null;const request=k.request([1,0,0],[],[1,0,0]);t.disconnect();await assert.rejects(request,/Connection changed/);
  assert.equal(k.key,null);assert.equal(k.ready,false);assert.equal(k.waiters.size,0);
});
test('a second lyric upload is rejected while a first transfer awaits acknowledgement',async()=>{
  const t=new FakeTransport(),k=new Keyboard(t);k.ready=true;
  const first=k.uploadLyric(0,[0]);await assert.rejects(k.uploadLyric(1,[0]),/Another lyric transfer/);t.reply([34,0,1]);await first;
});
test('BLE writes are serialized and queued snapshots are abandoned after disconnect',async()=>{
  const t=new Transport(),sent=[];t.connected=true;t.kind='ble';
  t.characteristic={properties:{writeWithoutResponse:true},async writeValueWithoutResponse(p){sent.push([...p]);}};
  const first=t.send(frame([0,0,5],[2]));const queued=t.send(frame([0,0,5],[3]));
  const firstResult=assert.rejects(first,/disconnected/),queuedResult=assert.rejects(queued,/disconnected/);
  await delay(1);t.disconnect();await firstResult;await queuedResult;assert.equal(sent.length,1);
});
