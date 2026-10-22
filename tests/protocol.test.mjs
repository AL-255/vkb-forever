import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createCipheriv } from 'node:crypto';
import { frame, parseFrame, u7, readU7, pack7, unpack7, encodeParameter, decodeParameter, fromHex, hex, MidiStream } from '../public/js/protocol.js';
import { parseLyrics, lyricPayload, decodeLyric, soundTitle } from '../public/js/lyrics.js';
import { desBlock, parityKey, encryptSinger, decryptSinger, createExchange, modPow, DH_P } from '../public/js/session.js';
import { blePackets, BleDecoder } from '../public/js/transport.js';
import { defaultWorkspace, validateWorkspace, loadWorkspace, saveWorkspace } from '../public/js/store.js';
const data = Object.fromEntries(['parameters','lyrics','skills'].map(name => [name, JSON.parse(readFileSync(new URL(`../public/data/${name}.json`,import.meta.url)))]));

test('Yamaha envelope and strict data validation', () => {
  assert.equal(hex(frame([0,0,5],[2])), 'f0 43 73 01 52 25 27 10 00 00 05 02 f7');
  assert.deepEqual(parseFrame(frame([15,0,4])), { address:[15,0,4], payload:[] });
  assert.equal(parseFrame(Uint8Array.of(240,1,247)),null);
  assert.throws(() => frame([0,0,128]));
  assert.throws(() => frame([0,0,0],[-1]));
});
test('base-128 integer boundaries', () => {
  assert.deepEqual(u7(8192,2),[64,0]);assert.deepEqual(u7(128,4),[0,0,1,0]);
  for (const n of [0,1,127,128,8192,16383]) assert.equal(readU7(u7(n,2)),n);
  assert.throws(() => u7(16384,2));assert.throws(() => u7(-1));
});
test('7-bit packing uses bit 6 for first byte and round-trips arbitrary bytes', () => {
  assert.deepEqual(pack7([128,0,0,0,0,0,128]),[65,0,0,0,0,0,0,0]);
  assert.deepEqual(pack7([255]),[64,127]);
  for (let n = 0; n < 260; n++) { const bytes = Array.from({length:n}, (_,i)=>(i*73+n)%256);assert.deepEqual(unpack7(pack7(bytes)),bytes); }
  assert.throws(() => unpack7([0]));assert.throws(() => unpack7([0,128]));
});
test('all 116 parameter definitions encode default values and valid extremes', () => {
  assert.equal(data.parameters.length,116);
  assert.equal(data.parameters.filter(d=>d.owner==='vocal').length,81);
  assert.equal(data.parameters.filter(d=>d.owner==='pcm').length,25);
  for (const d of data.parameters) {
    for (const value of new Set([d.minimum,d.maximum,d.default])) {
      const bytes = encodeParameter(d,value,data);assert.equal(bytes.length,d.width,d.identifier);
      assert.ok(bytes.every(b=>b>=0 && b<=127),d.identifier);
      const decoded = decodeParameter(d,bytes,data);
      // Multiple humming syllables intentionally share a canonical phoneme.
      if (d.identifier !== 'WordsForPhraseSkip') assert.equal(decoded,value,d.identifier);
    }
    assert.throws(()=>encodeParameter(d,d.maximum+1,data));
  }
  assert.deepEqual(encodeParameter(data.parameters.find(d=>d.identifier==='FxDepth0'),8,data),[102]);
  assert.deepEqual(encodeParameter(data.parameters.find(d=>d.identifier==='VibType0'),3,data),[12]);
  assert.deepEqual(encodeParameter(data.parameters.find(d=>d.identifier==='DelayTime0'),10,data),[7,103]);
});
test('all four opaque skill presets retain protocol hashes', () => {
  const hashes = ['d00219c32b01d418be0fca0c2808341c0f6f9ca7ed55b7377a69da29d0495eb6','57989f115517cb3636fb5d9487326fe3a3da8f001acd50bf5512650ba7195437','d3671bf9ae6d26e7af621951112ad8c783e483641451970a26f9a17d347d488b'];
  for (let i=0;i<4;i++) { const b=fromHex(data.skills[i].hex);assert.equal(b.length,162);if(hashes[i])assert.equal(createHash('sha256').update(b).digest('hex'),hashes[i]); }
});
test('lyric parsing preserves longest match, duplicate order, kana conversion and key-off state', () => {
  assert.equal(data.lyrics.syllables.length,489);
  assert.deepEqual(parseLyrics('かい',data.lyrics).tokens.map(t=>t.phonemes),['k a','i']);
  assert.equal(parseLyrics('アーッ',data.lyrics).tokens.length,1);
  assert.deepEqual(parseLyrics('hyu',data.lyrics).tokens.map(t=>t.phonemes),['C M']);
  for (const [text,flags] of [['_a',[false]],['a__i',[false,true]],['a_i_u',[false,true,false]],['a_\ni',[false,false]]]) assert.deepEqual(parseLyrics(text,data.lyrics).tokens.map(t=>t.off),flags,text);
  assert.equal(parseLyrics('SHI',data.lyrics).tokens.length,0);
  assert.equal(parseLyrics('a\ri',data.lyrics).phrases.length,1);
  assert.equal(parseLyrics('a\ni',data.lyrics).phrases.length,2);
  assert.ok(parseLyrics('愛1🙂',data.lyrics).rejected);
});
test('lyric wire payload contains three separate strings and a packed-byte length', () => {
  const parsed=parseLyrics('カイ\na_i',data.lyrics), payload=lyricPayload('TEST',parsed,data.lyrics);
  assert.equal(readU7(payload.slice(1,5)),payload.length-5);
  assert.equal(hex(unpack7(payload.slice(5))),'54 45 53 54 00 b6 26 b2 2f 61 5f 69 00 6b 20 61 26 69 2f 61 5f 69 00');
  assert.deepEqual(decodeLyric(payload),{title:'TEST',text:'カイ\na_i',flag:0});
  assert.throws(()=>lyricPayload('X',parseLyrics('SHI',data.lyrics),data.lyrics));
  assert.throws(()=>lyricPayload('X',parseLyrics('a愛',data.lyrics),data.lyrics));
  assert.throws(()=>decodeLyric([0,0,0,0,8,0,0]));
  assert.equal(soundTitle('ガ',data.lyrics).length,11);
  assert.equal(unpack7(soundTitle('ガ',data.lyrics)).length,9);
});
test('standard DES known-answer test, then native-reference VKB synthetic vectors', () => {
  const block=fromHex('0123456789abcdef'),key=fromHex('133457799bbcdff1');
  assert.equal(hex(desBlock(block,key)).replaceAll(' ',''),'85e813540f0ab405');
  assert.deepEqual(desBlock(desBlock(block,key),key,true),block);
  assert.equal(hex(parityKey(fromHex('0001020304050607'))),'80 01 02 83 04 85 86 07');
  for (const [key,cipher] of [['0001020304050607','ee08eb354cd85f58'],['0011223344556677','e0d69030218bc334']]) {
    assert.equal(hex(encryptSinger(new TextEncoder().encode('TRAVRQ'),fromHex(key),0x12345678)).replaceAll(' ',''),cipher);
  }
});
test('DES-CBC agrees with OpenSSL triple-DES using repeated DES key, across block boundaries', () => {
  const key=fromHex('1020304050607080'),corrected=parityKey(key),triple=Buffer.concat([corrected,corrected,corrected]);
  for (let n=0;n<42;n++) {
    const plain=Uint8Array.from({length:n},(_,i)=>i*11%256), padded=[...plain], size=(Math.floor(n/8)+1)*8;
    const cycle=[0x78,0x56,0x34,0x12];while(padded.length<size-1)padded.push(cycle[(padded.length-n)%4]);padded.push(n%8);
    const expected=createCipheriv('des-ede3-cbc',triple,new Uint8Array(8));expected.setAutoPadding(false);
    const cipher=encryptSinger(plain,key,0x12345678);
    assert.equal(hex(cipher),hex(Buffer.concat([expected.update(Uint8Array.from(padded)),expected.final()])));
    assert.deepEqual(decryptSinger(cipher,key),Array.from(plain));
  }
});
test('DH peers derive matching session key; malformed peer values are rejected', () => {
  const a=createExchange(Uint8Array.from([20,30,40])),b=createExchange(Uint8Array.from([55,66,77]));
  assert.deepEqual(a.finish(b.payload),b.finish(a.payload));
  assert.equal(modPow(5n,1n),5n);assert.ok(modPow(5n,555n)<DH_P);
  assert.throws(()=>a.finish([0,1,49]));assert.throws(()=>a.finish([0,2,53]));
});
test('BLE SysEx framing handles every fragmentation boundary, timestamps and end markers', () => {
  for (let n=0;n<100;n++) for (const timestamp of [0,119,127,128,8191]) {
    const original=frame([34,127,0],Array.from({length:n},(_,i)=>i%128)),out=[];
    const decoder=new BleDecoder(msg=>out.push(msg));
    const packets=blePackets(original,timestamp);
    assert.ok(packets.every(p=>p.length<=20));
    packets.forEach(p=>decoder.feed(p));assert.equal(out.length,1,`length ${n}, timestamp ${timestamp}`);assert.deepEqual(out[0],original);
  }
});
test('BLE supports ordinary notes, multiple timestamped messages and running status', () => {
  const out=[],d=new BleDecoder(msg=>out.push(Array.from(msg)));
  d.feed([128,128,144,60,100,61,101,129,62,102]);
  d.feed([128,130,62,102]);
  assert.deepEqual(out,[[144,60,100],[144,61,101],[144,62,102]]);
});
test('MIDI streams retain fragmented SysEx and permit realtime interleaving', () => {
  const out=[],stream=new MidiStream(msg=>out.push(Array.from(msg)));
  stream.feed([240,67,1]);stream.feed([248,2,247]);
  assert.deepEqual(out,[[248],[240,67,1,2,247]]);
});
test('workspace validation bounds imported values, strips extra properties, and persists', () => {
  const workspace=defaultWorkspace(data.parameters), storage={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}};
  saveWorkspace(workspace,storage);assert.deepEqual(loadWorkspace(data.parameters,storage),workspace);
  workspace.drafts.vocal.values.Gender1=999;assert.throws(()=>validateWorkspace(workspace,data.parameters));
  const fresh=defaultWorkspace(data.parameters);fresh.library=[{...fresh.drafts.lyric,script:'malicious'}];
  assert.equal(validateWorkspace(fresh,data.parameters).library[0].script,undefined);
});
