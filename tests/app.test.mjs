import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { frame, parseFrame, pack7 } from '../public/js/protocol.js';
import { createExchange, encryptSinger } from '../public/js/session.js';

// DOM integration tests exercise the actual application, with only the browser
// permission/port boundary simulated. They do not establish rendered layout.
const window = new Window({ url: 'http://localhost:4173/vkb-forever/' });
for (const key of ['window','document','navigator','location','localStorage','Event','CustomEvent','EventTarget']) Object.defineProperty(globalThis,key,{value: key === 'window' ? window : window[key],configurable:true,writable:true});
globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
document.write(await readFile(new URL('../public/index.html',import.meta.url),'utf8'));
const $=s=>document.querySelector(s);
const until=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>5000)throw Error('DOM state did not settle');await new Promise(r=>setTimeout(r,5));}};
const click=s=>{assert.ok($(s),`Missing ${s}`);$(s).click();};
const fill=(s,value,event='input')=>{assert.ok($(s),`Missing ${s}`);$(s).value=value;$(s).dispatchEvent(new window.Event(event,{bubbles:true}));};
const route=async hash=>{location.hash=hash;await until(()=>document.querySelector(`[data-route="${hash}"].active`));};
let peerKey;
const input={id:'vkb-in',name:'VKB-100 input',state:'connected',async open(){},async close(){}};
const wire=[];
const reply=(address,payload=[])=>input.onmidimessage?.({data:frame(address,payload)});
const output={id:'vkb-out',name:'VKB-100 simulator',state:'connected',async open(){},async close(){},send(bytes){
  const message=parseFrame(bytes);if(!message)return;wire.push(message);const {address:a,payload:p}=message;
  if(a.join(',')==='15,0,4')reply([15,0,17],[49,48,54]);
  if(a[0]===1){const peer=createExchange(Uint8Array.of(78,42,21));peerKey=peer.finish(p);reply([1,0,0],peer.payload);}
  if(a.join(',')==='15,0,0'){reply([15,0,16],[0]);reply([17,0,0],[...new TextEncoder().encode('VY100001')]);reply([15,0,16],[1]);}
  if(a[0]===127)reply([127,0,0],pack7(encryptSinger(new TextEncoder().encode('TRAVRS01VY100001'),peerKey)));
  if(a[0]===34 && a[2]===0)reply([34,a[1],1]);
}};
const access=new window.EventTarget();access.inputs=new Map([[input.id,input]]);access.outputs=new Map([[output.id,output]]);
navigator.requestMIDIAccess=async options=>{assert.equal(options.sysex,true);return access;};
await import('../public/js/app.js');
await until(()=>!!$('[data-param="Gender1"]'));

test('offline voice and instrument editors expose every bank parameter and persist changes',async()=>{
  assert.equal(document.querySelectorAll('[data-param]').length,20);
  fill('[data-param="Gender1"]','78','change');
  assert.equal(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).drafts.vocal.values.Gender1,78);
  click('[data-bank="3"]');assert.ok($('[data-param="Gender3"]'));
  await route('pcm');assert.equal(document.querySelectorAll('[data-param]').length,6);
  assert.equal(document.querySelectorAll('[data-selector] option').length,13);
  await route('vocal');assert.ok($('[data-param="Gender3"]'));
});
test('each selected singer applies its reference colors and other routes clear the theme',async()=>{
  const expected=[['VY1','#fb6d6d','#fdece7'],['MIKU','#29c8c8','#dcf3ef'],['MEG','#3ecd54','#d8fbce'],['IA','#d06d6d','#fae7e7'],['YUKARI','#9c66d6','#f2e4f7']];
  for(let i=0;i<expected.length;i++){
    fill('[data-selector="vocal"]',String(i),'change');
    assert.equal($('#main').dataset.singer,expected[i][0]);
    assert.equal($('#main').style.getPropertyValue('--singer-accent'),expected[i][1]);
    assert.equal($('#main').style.getPropertyValue('--singer-background'),expected[i][2]);
    assert.equal(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).drafts.vocal.values.VocaloNumber,i);
    assert.ok($('[data-param="Gender3"]'));
  }
  await route('pcm');assert.equal($('#main').dataset.singer,undefined);assert.equal($('#main').style.getPropertyValue('--singer-accent'),'');
  await route('vocal');assert.equal($('#main').dataset.singer,'YUKARI');
  fill('[data-selector="vocal"]','0','change');
});
test('library supports save, update, duplicate and escaped names',async()=>{
  click('[data-action="save"]');fill('#save-name','<img src=x onerror=alert(1)>');click('#save-library');
  assert.equal(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).library.length,1);
  click('[data-action="save"]');assert.equal($('#save-library').textContent,'Update saved item');fill('#save-name','My edited voice');click('#save-library');
  assert.equal(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).library.length,1);
  await route('library');assert.equal($('.library-card h3').textContent,'My edited voice');assert.equal(document.querySelectorAll('.library-card img').length,0);
  click('[data-item-action="duplicate"]');assert.equal(document.querySelectorAll('.library-card').length,2);
  click('[data-item-action="rename"]');fill('#rename-item','First idea');click('#rename-save');
  click('[data-item-action="down"]');assert.equal(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).library[1].name,'First idea');
  fill('#library-search','not present');assert.ok($('.empty-state'));fill('#library-search','');
});
test('lyric preview refreshes without losing focus, surfaces rejected input and persists inclusive loop range',async()=>{
  await route('lyric');fill('#lyric-text','カイ\na_i');
  assert.equal(document.querySelectorAll('[data-token]').length,4);assert.ok($('#lyric-stats').textContent.includes('2 phrases'));
  fill('#preview-script','hiragana','change');assert.ok($('[data-token="0"]').textContent.includes('か'));assert.ok($('[data-token="0"]').textContent.includes('k a'));
  fill('#loop-start','2','change');fill('#loop-end','4','change');
  assert.deepEqual(JSON.parse(localStorage.getItem('vkb-forever.workspace.v1')).drafts.lyric.loop,[1,3]);
  fill('#lyric-text','カイ愛');assert.ok($('#lyric-warning').textContent.includes('愛'));assert.equal($('[data-action="transfer"]').disabled,true);
  fill('#lyric-text','カイ\na_i');click('[data-token="2"]');assert.equal($('[data-token="2"]').getAttribute('aria-pressed'),'true');
});
test('OS MIDI dialog, startup, sound upload, lyric acknowledgement and position controls work end to end',async()=>{
  await route('device');click('[data-action="midi"]');await until(()=>!!$('#midi-open'));
  click('#midi-open');await until(()=>$('#connection-badge').textContent.includes('Ready'));
  await until(()=>!$('.busy-strip'));
  assert.ok(document.body.textContent.includes('VY100001'));
  await route('vocal');click('[data-action="transfer"]');assert.ok($('#transfer-warning'));click('#transfer-confirm');await until(()=>!$('.busy-strip'));
  assert.equal(wire.filter(m=>m.address[0]>=48 && m.address[0]<=52).length,84);
  assert.equal($('#live-edit').disabled,false);
  $('#live-edit').checked=true;$('#live-edit').dispatchEvent(new window.Event('change'));
  await until(()=>!$('.busy-strip'));
  fill('[data-param="Gender3"]','80','change');await until(()=>wire.some(m=>m.address.join(',')==='52,127,30' && m.payload[0]===80));
  await route('lyric');click('[data-action="transfer"]');click('#transfer-confirm');await until(()=>!$('.busy-strip'));
  assert.equal($('[data-action="loop"]').disabled,false);click('[data-token="2"]');await until(()=>!$('.busy-strip'));
  assert.ok(wire.some(m=>m.address.join(',')==='33,127,0' && m.payload[1]===2));
  const before=wire.length;reply([33,127,2],[0,1,0,2]);assert.equal(wire.length,before);assert.ok($('#cursor-state').textContent.includes('Loop on'));
  await route('device');click('[data-action="disconnect"]');assert.ok($('#connection-badge').textContent.includes('Offline'));
  await route('vocal');assert.equal($('#live-edit').disabled,true);
});
test('help route and device settings remain accessible without hardware',async()=>{
  await route('device');assert.equal(document.querySelectorAll('[data-owner="global"][data-param]').length,10);
  await route('help');assert.ok(document.body.textContent.includes('Physical VKB-100 testing'));
});
after(async()=>{await window.happyDOM.abort();});
