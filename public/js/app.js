import { Transport } from './transport.js';
import { Keyboard } from './device.js';
import { frame, encodeParameter, decodeParameter, readU7 } from './protocol.js';
import { parseLyrics, lyricPayload, soundTitle, decodeLyric, titleBytes } from './lyrics.js';
import { newLyric, loadWorkspace, saveWorkspace, validateWorkspace, defaultWorkspace } from './store.js';
import { soundMessages, soundValue, canonicalSinger } from './sound.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = text => String(text).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const names = { vocal: 'Voice lab', pcm: 'Instruments', lyric: 'Lyrics', library: 'My library', device: 'Keyboard & settings', help: 'Getting started' };
const sounds = { vocal: ['VY1','Hatsune Miku','Megpoid','IA','Yuzuki Yukari'], pcm: ['Synth 1','Synth 2','Synth 3','Synth 4','Electric guitar','Harmonica','Tenor sax','Piano','Electric piano','Synth bass','Slap bass','Air choir','Applause'] };
const singerPrefixes = ['VY1','MIK','MEG','IA','YKR'];
const transport = new Transport(), keyboard = new Keyboard(transport);
let data, workspace, route = 'vocal', bank = { vocal: 1, pcm: 1 }, live = { vocal: false, pcm: false }, applied = { vocal: false, pcm: false };
let busy = false, activity = '', status = 'Offline', selectedToken = 0, currentLyric = null, loopActive = false, previewScript = 'typed', logVisible = false, libraryFilter = 'all', librarySearch = '', storageError = '', startupWarning = '';
const received = { vocal: new Map(), pcm: new Map(), lyrics: new Map() }, rawSingers = new Map(), globals = {};
let toastTimer;

function toast(message, error = false) {
  $('#toast').textContent = message; $('#toast').className = 'visible' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').className = '', error ? 10000 : 6000);
}
function persist() {
  try { saveWorkspace(workspace); storageError = ''; $('#save-state').textContent = 'Saved on this browser'; }
  catch { storageError = 'Browser storage is unavailable or full. Export a backup to keep your edits.'; $('#save-state').textContent = 'Not saved — export a backup'; toast(storageError, true); }
  $('.library-count').textContent = workspace.library.length;
}
function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function modal(html) { $('#modal-body').innerHTML = html; $('#modal').showModal(); }
function closeModal() { $('#modal').close(); }
async function confirmAction(title, description, action, label = 'Continue') {
  modal(`<div class="eyebrow">PLEASE CONFIRM</div><h2 id="modal-title">${esc(title)}</h2><p>${esc(description)}</p><div class="toolbar"><button class="button dark" id="confirm-action">${esc(label)}</button><button class="button" id="cancel-action">Cancel</button></div>`);
  $('#cancel-action').onclick = closeModal;
  $('#confirm-action').onclick = () => { closeModal(); run(title, action); };
}
async function run(label, fn) {
  if (busy) { toast('Wait for the current operation to finish.'); return; }
  busy = true; activity = label; render(); updateConnection();
  try { await fn(); }
  catch (error) { toast(error.message || String(error), true); keyboard.log('ERROR', error.message || String(error)); }
  finally { busy = false; activity = ''; render(); updateConnection(); }
}
function pageHeader(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-header"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${actions ? `<div class="header-buttons">${actions}</div>` : ''}</div>`;
}
function connectionAside() {
  return `<div class="aside-stack"><section class="panel side-card"><div class="eyebrow">YOUR KEYBOARD</div><div class="connection-visual"><div class="connection-ring" aria-hidden="true">⌁</div></div><h3>${transport.connected ? esc(transport.name) : 'A little connection.'}</h3><p>${transport.connected ? esc(status) + '. Your local drafts stay in your browser.' : 'A whole lot of possibility. Connect your VKB-100 to bring these edits to life.'}</p><button class="button ${keyboard.ready ? '' : 'dark'}" data-action="${transport.connected ? 'device' : 'connect'}" ${busy ? 'disabled' : ''}>${transport.connected ? 'Keyboard details ↗' : 'Connect with Bluetooth →'}</button><div class="session-list"><div><span>Connection</span><strong>${transport.connected ? transport.kind === 'ble' ? 'Bluetooth LE' : 'OS MIDI' : 'Offline editing'}</strong></div><div><span>Sound storage</span><strong>20 slots per type</strong></div><div><span>Lyric storage</span><strong>20 slots</strong></div></div></section><section class="tip-card"><div class="eyebrow">ROOM TO EXPERIMENT</div><h3>Keep a sound for later.</h3><p>Save your favorite settings to your library, then export a backup to take them with you.</p><a href="#library">Open my library <span>↗</span></a></section></div>`;
}
function soundArt(owner) {
  return `<div class="sound-art ${owner}" aria-hidden="true">${[20,33,46,34,63,47,76,55,36,49,23].map(h => `<span style="--h:${h}%"></span>`).join('')}</div>`;
}
function valueLabel(d, value) {
  if (d.identifier.startsWith('Transpose')) return (value - 12 > 0 ? '+' : '') + (value - 12);
  if (d.identifier === 'MasterTune') return (value - 8192 > 0 ? '+' : '') + (value - 8192);
  return d.choices?.[value - d.minimum] ?? String(value);
}
function control(d, value, owner) {
  const id = `param-${d.identifier}`, attr = `data-param="${esc(d.identifier)}" data-owner="${owner}"`, choices = d.choices || [];
  const input = choices.length ? `<select id="${id}" ${attr} ${busy ? 'disabled' : ''}>${choices.map((label, i) => `<option value="${i + d.minimum}" ${value === i + d.minimum ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>` : `<input id="${id}" type="range" min="${d.minimum}" max="${d.maximum}" step="1" value="${value}" ${attr} ${busy ? 'disabled' : ''}><div class="bounds"><span>${esc(valueLabel(d, d.minimum))}</span><span>${esc(valueLabel(d, d.maximum))}</span></div>`;
  const label = d.identifier.startsWith('Breathness') ? 'Breathiness' : d.label;
  return `<div class="control"><div class="control-top"><label for="${id}">${esc(label)}</label><output for="${id}" id="value-${d.identifier}">${esc(valueLabel(d, value))}</output></div>${input}</div>`;
}
function selectorOptions(owner) {
  return sounds[owner].map((name, value) => {
    const singer = owner === 'vocal' && keyboard.registry.find(r => r.id.startsWith(singerPrefixes[value]));
    return { name: name + (singer?.available === false ? ' · unavailable' : ''), value };
  });
}
function soundPage(owner) {
  const draft = workspace.drafts[owner], defs = data.parameters.filter(d => d.owner === owner && d.bank === bank[owner]);
  const selector = owner === 'vocal' ? 'VocaloNumber' : 'PcmNumber', options = selectorOptions(owner);
  const selectedName = options.find(o => o.value === draft.values[selector])?.name || 'Unknown selection';
  const actions = `<button class="button" data-action="save" data-owner="${owner}" ${busy ? 'disabled' : ''}>＋ Save to library</button><button class="button dark" data-action="transfer" data-owner="${owner}" ${busy || !keyboard.ready ? 'disabled' : ''}>Send to keyboard ↗</button>`;
  const groups = owner === 'vocal' ? [
    ['VOICE CHARACTER', ['Gender','Brightness','Clearness','Breathness','Opening']],
    ['EXPRESSION & TIMING', ['DelayMode','DelayTime','DecayTime','Portamento']],
    ['VIBRATO', ['VibType','VibRate','VibDepth','VibDelay']],
    ['EFFECTS & PITCH', ['FxType','FxDepth','PbSens','OctaveShift','Transpose']],
    ['PERFORMANCE SKILLS', ['Skill1','Skill2']]
  ] : [['INSTRUMENT & EFFECTS', ['Volume','FxType','FxDepth']], ['PITCH & PERFORMANCE', ['PbSens','OctaveShift','Transpose']]];
  return pageHeader(owner === 'vocal' ? 'SHAPE YOUR SIGNATURE' : 'FIND YOUR TEXTURE', owner === 'vocal' ? 'Your voice. Reimagined.' : 'A sound of your own.', owner === 'vocal' ? 'Fine-tune the character, expression, and feeling behind every note.' : 'Explore 13 instruments and give each one your own character.', actions) + `<div class="workspace"><div class="editor-stack"><section class="panel"><div class="identity">${soundArt(owner)}<div class="sound-info"><div class="eyebrow">${owner === 'vocal' ? 'VOCAL ENGINE' : 'INSTRUMENT ENGINE'}</div><h2>${esc(selectedName)}</h2><p>${esc(draft.name)} <span aria-hidden="true">·</span> Local draft</p></div><label class="field sound-select">${owner === 'vocal' ? 'Singer' : 'Instrument'}<select data-selector="${owner}" aria-label="${owner === 'vocal' ? 'Singer' : 'Instrument'}" ${busy ? 'disabled' : ''}>${options.map(o => `<option value="${o.value}" ${draft.values[selector] === o.value ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div><div class="bank-bar"><div class="segments" role="group" aria-label="Parameter bank">${['Memory off','Memory 1','Memory 2','Memory 3'].map((name, i) => `<button data-bank="${i}" data-owner="${owner}" class="${bank[owner] === i ? 'selected' : ''}" aria-pressed="${bank[owner] === i}" ${busy ? 'disabled' : ''}>${name}</button>`).join('')}</div><label class="live-label"><input type="checkbox" id="live-edit" data-owner="${owner}" ${live[owner] ? 'checked' : ''} ${!keyboard.ready || !applied[owner] || busy ? 'disabled' : ''}> Live edits</label></div></section><section class="panel"><div class="panel-head"><h2>${owner === 'vocal' ? 'The details make the voice.' : 'Make every note count.'}</h2><button class="button small ghost" data-action="reset-bank" data-owner="${owner}" ${busy ? 'disabled' : ''}>Reset bank ↺</button></div><div style="padding-top:24px">${groups.map(([label, prefixes]) => `<div class="group-title">${label}</div><div class="control-grid">${prefixes.map(prefix => defs.find(d => d.identifier === prefix + bank[owner])).filter(Boolean).map(d => control(d, draft.values[d.identifier], owner)).join('')}</div>`).join('')}</div><div class="editor-note"><span>Four independent banks. One sound. ${live[owner] ? 'Live edits are being sent to the current buffer.' : 'Apply to the current buffer to enable live edits.'}</span><span class="mono">BANK ${String(bank[owner]).padStart(2,'0')} / 03</span></div></section><section class="panel panel-body"><div class="inline-fields"><label class="field">Draft name<input type="text" data-draft="name" data-owner="${owner}" maxlength="200" value="${esc(draft.name)}" ${busy ? 'disabled' : ''}></label><label class="field">Keyboard title <span class="small">9 wire bytes for sound memories</span><input type="text" data-draft="title" data-owner="${owner}" maxlength="30" value="${esc(draft.title)}" ${busy ? 'disabled' : ''}></label></div></section></div>${connectionAside()}</div>`;
}
function lyricPage() {
  const draft = workspace.drafts.lyric, parsed = parseLyrics(draft.text, data.lyrics);
  const actions = `<button class="button" data-action="save" data-owner="lyric" ${busy ? 'disabled' : ''}>＋ Save to library</button><button class="button dark" data-action="transfer" data-owner="lyric" ${busy || !keyboard.ready || !parsed.tokens.length || !!parsed.rejected ? 'disabled' : ''}>Send lyrics ↗</button>`;
  return pageHeader('WORDS BECOME MUSIC', 'Give your keys a voice.', 'Write in kana or lowercase romaji. Each syllable becomes a note to play.', actions) + `<div class="lyric-layout"><section class="panel"><div class="panel-head"><h2>Your words</h2><button class="button small ghost" data-action="new-lyric" ${busy ? 'disabled' : ''}>New draft ＋</button></div><div class="panel-body"><div class="inline-fields"><label class="field">Library name<input type="text" data-draft="name" data-owner="lyric" maxlength="200" value="${esc(draft.name)}" ${busy ? 'disabled' : ''}></label><label class="field">Keyboard title<input type="text" data-draft="title" data-owner="lyric" maxlength="30" value="${esc(draft.title)}" ${busy ? 'disabled' : ''}></label></div><label for="lyric-text" class="field mt">Lyrics <span>New line = new phrase · _ = key-off pronunciation</span></label><textarea id="lyric-text" class="lyric-text" maxlength="50000" spellcheck="false" autocapitalize="off" ${busy ? 'disabled' : ''}>${esc(draft.text)}</textarea><div id="lyric-stats" class="lyric-stats"></div><div id="lyric-warning"></div><p class="small muted">Kana and dictionary romaji are supported. Kanji, English words, and punctuation cannot be sung directly; use their kana reading.</p></div></section><section class="panel"><div class="panel-head"><h2>The playable phrase</h2><span class="eyebrow">SYLLABLE PREVIEW</span></div><div id="token-preview" class="panel-body"></div><div class="loop-tools"><p id="cursor-state"></p><div class="loop-fields"><label class="field">Loop start<input type="number" id="loop-start" min="1" max="${Math.max(1,parsed.tokens.length)}" value="${draft.loop[0] + 1}" ${busy ? 'disabled' : ''}></label><label class="field">Loop end<input type="number" id="loop-end" min="1" max="${Math.max(1,parsed.tokens.length)}" value="${draft.loop[1] + 1}" ${busy ? 'disabled' : ''}></label><button class="button small" data-action="loop" ${busy || !keyboard.ready || currentLyric !== lyricIdentity(draft) ? 'disabled' : ''}>Apply loop</button><button class="button small ghost" data-action="loop-off" ${busy || !keyboard.ready || currentLyric !== lyricIdentity(draft) ? 'disabled' : ''}>Loop off</button></div><p class="mt">Upload this draft to the current buffer to control the keyboard’s syllable position and loop.</p></div></section></div><div class="notice section-gap">Your browser library and the keyboard’s 20 lyric slots are separate. Sending a lyric to a numbered slot overwrites that slot. The current buffer is the temporary performance workspace.</div>`;
}
function lyricIdentity(draft) { return JSON.stringify([draft.title, draft.text]); }
function refreshLyricPreview() {
  if (!$('#token-preview')) return;
  const draft = workspace.drafts.lyric, parsed = parseLyrics(draft.text, data.lyrics);
  selectedToken = Math.min(selectedToken, Math.max(0, parsed.tokens.length - 1));
  let index = 0;
  $('#token-preview').innerHTML = `<label class="field" style="max-width:180px;margin-bottom:22px">Token labels<select id="preview-script"><option value="typed" ${previewScript === 'typed' ? 'selected' : ''}>As typed</option><option value="hiragana" ${previewScript === 'hiragana' ? 'selected' : ''}>Hiragana</option></select></label>` + (parsed.phrases.map((phrase, pi) => `<div class="phrase-number">PHRASE ${String(pi + 1).padStart(2, '0')}</div><div class="token-phrase">${phrase.map(token => { const n = index++, label = previewScript === 'hiragana' ? Array.from(token.text,ch => data.lyrics.katakana_to_hiragana[ch] || ch).join('') : token.text; return `<button class="token ${n === selectedToken ? 'selected' : ''} ${loopActive && n >= draft.loop[0] && n <= draft.loop[1] ? 'looped' : ''} ${token.off ? 'off' : ''}" data-token="${n}" aria-label="Syllable ${n+1}: ${esc(token.text)}, ${esc(token.phonemes)}" aria-pressed="${n === selectedToken}" ${busy ? 'disabled' : ''}><span>${esc(label)}</span><small>${n+1} · ${esc(token.phonemes)}</small></button>`; }).join('')}</div>`).join('') || '<div class="preview-empty">Your playable syllables will appear here.</div>');
  $('#preview-script').onchange = e => { previewScript = e.target.value; refreshLyricPreview(); };
  $('#lyric-stats').innerHTML = `<span>${parsed.tokens.length} syllables</span><span>${parsed.phrases.length} phrases</span><span>${titleBytes(draft.title, data.lyrics).length} title bytes</span>`;
  $('#lyric-warning').innerHTML = parsed.rejected ? `<div class="notice error">Unsupported or unmatched text: <strong>${esc([...new Set(parsed.rejected)].join(' '))}</strong>. Resolve it before sending. Use lowercase romaji or kana.</div>` : '';
  $('#cursor-state').textContent = `${parsed.tokens.length ? `Selected syllable ${selectedToken + 1} of ${parsed.tokens.length}. ` : ''}${currentLyric === lyricIdentity(draft) && keyboard.ready ? `Linked to current buffer. Loop ${loopActive ? 'on' : 'off'}.` : 'Local preview; keyboard position is not linked.'}`;
  const send = $('[data-action="transfer"][data-owner="lyric"]'); if (send) send.disabled = busy || !keyboard.ready || !parsed.tokens.length || !!parsed.rejected;
  for (const selector of ['[data-action="loop"]','[data-action="loop-off"]']) $(selector).disabled = busy || !keyboard.ready || currentLyric !== lyricIdentity(draft);
  for (const selector of ['#loop-start','#loop-end']) $(selector).max = Math.max(1, parsed.tokens.length);
}
function libraryPage() {
  const list = workspace.library.filter(item => (libraryFilter === 'all' || item.type === libraryFilter) && item.name.toLowerCase().includes(librarySearch.toLowerCase()));
  return pageHeader('GOOD IDEAS LIVE HERE', 'Your personal collection.', 'Sounds and words worth coming back to. Stored locally, ready to play.', `<button class="button" data-action="import">Import backup ↑</button><button class="button dark" data-action="export">Export backup ↓</button>`) + `<div class="toolbar"><div class="segments" role="group" aria-label="Filter library">${[['all','Everything'],['vocal','Voices'],['pcm','Instruments'],['lyric','Lyrics']].map(([id,label]) => `<button data-filter="${id}" class="${libraryFilter === id ? 'selected' : ''}" aria-pressed="${libraryFilter === id}">${label}</button>`).join('')}</div><input type="search" id="library-search" placeholder="Find something good…" aria-label="Search library" value="${esc(librarySearch)}" style="width:230px;margin-left:auto"></div><div class="library-grid">${list.map(item => `<article class="panel library-card"><div class="eyebrow">${item.type === 'vocal' ? 'VOICE PRESET' : item.type === 'pcm' ? 'INSTRUMENT PRESET' : 'LYRIC'}</div><h3>${esc(item.name)}</h3><p>${esc(item.type === 'lyric' ? item.text : 'Four parameter banks · Keyboard title: ' + item.title)}</p><div class="library-actions"><button class="button dark" data-item-action="open" data-id="${esc(item.id)}" ${busy ? 'disabled' : ''}>Open ↗</button><button class="button" data-item-action="duplicate" data-id="${esc(item.id)}" ${busy ? 'disabled' : ''}>Duplicate</button><button class="button danger" data-item-action="delete" data-id="${esc(item.id)}" ${busy ? 'disabled' : ''}>Delete</button></div></article>`).join('')}</div>${!list.length ? `<section class="panel empty-state section-gap"><div class="empty-symbol" aria-hidden="true">▧</div><h2>${workspace.library.length ? 'No matching ideas.' : 'A home for your next idea.'}</h2><p>${workspace.library.length ? 'Try another search or category.' : 'Create a voice, shape an instrument, or write a lyric. Save it here when it feels right.'}</p><a class="button dark" href="#vocal">Explore the voice lab →</a></section>` : ''}<input type="file" accept="application/json,.json" id="import-file" class="file-input">`;
}
function devicePage() {
  const rLyrics = [...received.lyrics.entries()], rSounds = ['vocal','pcm'].filter(type => received[type].has(127));
  return pageHeader('THE OTHER HALF OF YOUR WORKSPACE', 'Meet your keyboard.', 'Connect, synchronize, and look after the details.', `<button class="button" data-action="sync" ${busy || !transport.connected ? 'disabled' : ''}>Synchronize ↻</button>${transport.connected ? '<button class="button" data-action="disconnect">Disconnect</button>' : '<button class="button dark" data-action="connect">Connect Bluetooth</button>'}`) + `<div class="device-grid"><section class="panel"><div class="panel-head"><h2>Connection</h2><span class="status-badge ${keyboard.ready ? 'online' : ''}"><i></i>${keyboard.ready ? 'Ready' : transport.connected ? 'Connected' : 'Offline'}</span></div><div class="panel-body"><p class="small muted">${transport.connected ? esc(transport.name) + ' · ' + esc(status) : 'Use direct Bluetooth, or a MIDI port paired through your operating system.'}</p><div class="session-list"><div><span>Firmware reply</span><strong>${esc(keyboard.version || 'Not received')}</strong></div><div><span>Instrument session</span><strong>${keyboard.key ? 'Established' : 'Not established'}</strong></div><div><span>Browser Bluetooth</span><strong>${navigator.bluetooth ? 'Available' : 'Unavailable'}</strong></div><div><span>Browser MIDI</span><strong>${navigator.requestMIDIAccess ? 'Available' : 'Unavailable'}</strong></div></div><div class="toolbar mt"><button class="button" data-action="midi" ${busy ? 'disabled' : ''}>Choose OS MIDI ports</button><a class="button ghost" href="#help">Connection help ↗</a></div><div class="inline-fields mt"><label class="field">Bluetooth name <span>Printable ASCII, up to 8 characters</span><input type="text" id="device-name" maxlength="8" placeholder="VKB-100" ${!keyboard.ready || busy ? 'disabled' : ''}></label><button class="button" style="align-self:end" data-action="rename-device" ${!keyboard.ready || busy ? 'disabled' : ''}>Rename keyboard</button></div></div></section><section class="panel"><div class="panel-head"><h2>Singers on your instrument</h2><button class="button small ghost" data-action="availability" ${busy || !keyboard.ready ? 'disabled' : ''}>Refresh ↻</button></div><div class="panel-body">${keyboard.registry.length ? keyboard.registry.map(r => `<div class="singer-row"><span><strong>${esc(r.id)}</strong><br><span class="small muted">${esc(r.language || 'Language not reported')} · ${r.available === true ? 'Available' : r.available === false ? 'Not activated' : 'Availability unknown'}</span></span>${r.available === false ? `<button class="button small" data-activate="${esc(r.id)}" ${busy || !keyboard.ready ? 'disabled' : ''}>Activate</button>` : ''}</div>`).join('') : '<p class="small muted">Synchronize to receive the keyboard’s singer registry. Offline choices use the default ordering.</p>'}<p class="small muted mt">Synthesis and voice libraries live on the keyboard. This app does not download voices or process purchases.</p></div></section></div><section class="panel section-gap"><div class="panel-head"><h2>Keyboard settings</h2><span class="eyebrow">SEND INDIVIDUALLY</span></div><div class="panel-body"><div class="notice">These values begin at protocol defaults until read back. Changing a control edits a local value; use “Send settings” to write all displayed settings.</div><div class="settings-grid">${data.parameters.filter(d => d.owner === 'global').map(d => control(d, globals[d.identifier] ?? d.default, 'global')).join('')}</div><button class="button dark mt" data-action="send-globals" ${busy || !keyboard.ready ? 'disabled' : ''}>Send settings ↗</button></div></section><section class="panel section-gap"><div class="panel-head"><h2>Received from keyboard</h2><span class="eyebrow">${rLyrics.length + rSounds.length} ITEMS</span></div><div class="panel-body"><p class="small muted">Readback is kept separate from your drafts. Synchronization requests a device dump; individual slot reads are not documented.</p><div class="toolbar mt">${rSounds.map(type => `<button class="button" data-read-sound="${type}">Use received ${type === 'vocal' ? 'voice' : 'instrument'}</button>`).join('')}${rLyrics.map(([slot, value]) => `<button class="button" data-read-lyric="${slot}">${esc(value.title || 'Untitled')} · ${slot === 127 ? 'Current' : 'Slot ' + (slot+1)} ↗</button>`).join('') || ''}</div></div></section><section class="panel section-gap"><div class="panel-head"><h2>Connection journal</h2><div class="toolbar"><button class="button small ghost" data-action="toggle-log">${logVisible ? 'Hide' : 'Show'} traffic</button><button class="button small" data-action="export-log">Export log ↓</button></div></div>${logVisible ? '<pre id="traffic-log" class="log" tabindex="0" aria-label="MIDI traffic log"></pre>' : '<div class="panel-body small muted">Packet-level BLE and MIDI traffic is available for hardware testing. Lyrics and titles can appear in exported logs.</div>'}</section>`;
}
function helpPage() {
  return pageHeader('A SMALL GUIDE', 'Less setup. More playing.', 'An independent companion for your Yamaha VKB-100.') + `<div class="help-content"><section class="panel"><h2>Connect in a few steps</h2><ol><li>Turn on the VKB-100 and enable its Bluetooth MIDI connection. Close any other app using the keyboard.</li><li>Open this app over HTTPS in a browser with Web Bluetooth, such as a supported Chrome or Edge installation. Click <strong>Connect keyboard</strong> and choose the VKB-100.</li><li>Wait for the firmware request, session exchange, and instrument dump. The connection indicator becomes <strong>Ready</strong> when synchronization finishes.</li><li>Make an edit, then choose <strong>Send to keyboard</strong>. Choose the current buffer for temporary edits or a numbered memory slot to store it.</li></ol><p>Direct Bluetooth availability depends on the browser and operating system. Chrome on Linux may require experimental web platform features. If direct Bluetooth is unavailable, pair the keyboard using your OS’s Bluetooth MIDI tools, then choose its input and output through <strong>Keyboard & settings → Choose OS MIDI ports</strong>. A USB MIDI port is also supported where the OS exposes one.</p><p class="mt">See <a href="https://developer.chrome.com/docs/capabilities/bluetooth" target="_blank" rel="noreferrer">Chrome’s Web Bluetooth guide</a> for platform requirements. A downloaded file:// page cannot access these APIs; use HTTPS hosting or localhost.</p></section><section class="panel"><h2>Find your sound</h2><p>Voice lab has all 20 vocal parameters in each of four banks, including character, vibrato, timing, effects, pitch, and both performance skills. Instruments has 13 choices and six parameters per bank. “Memory off” is a fourth bank alongside Memory 1, 2, and 3.</p><p class="mt">Apply a full sound to the current buffer first, then enable <strong>Live edits</strong> to transmit individual changes. Saving to a numbered slot uploads the title, selector, and all banks. Sound uploads have no documented acknowledgement: “sent” means the browser transmitted them, not that the keyboard confirmed storage.</p></section><section class="panel"><h2>Write something singable</h2><p>Use kana or lowercase dictionary romaji, such as <strong>ラララ</strong> or <strong>ka ki ku ke ko</strong>. Romaji is phonetic input, not English text-to-speech. New lines separate phrases. A space or prolonged-sound mark extends the previous display token. An underscore before a syllable requests key-off pronunciation. The preview shows the resulting playable tokens.</p><p class="mt">Unsupported input is shown before upload. Upload the lyric to the current buffer to link its syllable buttons and loop controls. Loop start and end are inclusive and numbered from 1 in this interface. Lyric transfers wait for an acknowledgement at the matching slot address.</p></section><section class="panel"><h2>Your work stays with you</h2><p>Drafts and library entries are saved in this browser’s local storage. Clearing site data removes them. Export a workspace backup from My library; import validates the file before asking to replace the local workspace. No server, account, analytics, or original application artwork is involved.</p></section><section class="panel"><h2>Compatibility is a work in progress</h2><p>This is a new, independent interface built from a low-level interoperability specification. Physical VKB-100 testing is still required for timing, session acceptance, singer activation, and persistence. This app is not affiliated with Yamaha or the voice library owners.</p><p class="mt">If an upload times out, the device’s final state is unknown. Check the keyboard before retrying. Export the connection journal to help diagnose an issue. A disconnect stops queued work, and reconnecting requires synchronization again.</p><a class="button mt" href="https://github.com/AL-255/vkb-forever" target="_blank" rel="noreferrer">View source on GitHub ↗</a></section></div>`;
}
function render() {
  if (!data || !workspace) return;
  $('#breadcrumb').textContent = names[route];
  document.querySelectorAll('[data-route]').forEach(a => { const active = a.dataset.route === route; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
  const warning = startupWarning || storageError;
  $('#main').innerHTML = (warning ? `<div class="notice error">${esc(warning)}</div>` : '') + (busy ? `<div class="busy-strip" role="status">${esc(activity)}… Keep this page open.</div>` : '') + (route === 'vocal' || route === 'pcm' ? soundPage(route) : route === 'lyric' ? lyricPage() : route === 'library' ? libraryPage() : route === 'device' ? devicePage() : helpPage());
  if (route === 'lyric') refreshLyricPreview();
  if ($('#traffic-log')) { $('#traffic-log').textContent = keyboard.logs.map(row => `${row.time} ${row.direction} ${row.message}`).join('\n'); $('#traffic-log').scrollTop = $('#traffic-log').scrollHeight; }
  bind();
}
function updateConnection() {
  $('#connection-badge').innerHTML = `<i></i>${keyboard.ready ? 'Ready' : transport.connected ? 'Connected' : 'Offline'}`;
  $('#connection-badge').classList.toggle('online', keyboard.ready);
  $('#connect').innerHTML = transport.connected ? '⌁ <span>Keyboard details</span>' : '⌁ <span>Connect keyboard</span>';
  $('#connect').disabled = busy;
  $('#session-state').textContent = status === 'Offline' ? 'No keyboard connected' : status;
}
async function connect() {
  await transport.connectBluetooth();
  await keyboard.synchronize();
  toast('Keyboard synchronized. Your workspace is ready.');
}
function openMidi() {
  run('Finding MIDI ports', async () => {
    const ports = await transport.midiPorts();
    modal(`<div class="eyebrow">OS MIDI CONNECTION</div><h2 id="modal-title">Choose your MIDI ports.</h2><p>Pair Bluetooth MIDI in your operating system first, or attach a MIDI interface. Choose the VKB-100’s matching ports.</p><label class="field">From keyboard (input)<select id="midi-in">${ports.inputs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">To keyboard (output)<select id="midi-out">${ports.outputs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>${!ports.inputs.length || !ports.outputs.length ? '<div class="notice">No complete MIDI port pair was found. Connect the keyboard through your operating system and try again.</div>' : ''}<button class="button dark full-width" id="midi-open" ${!ports.inputs.length || !ports.outputs.length ? 'disabled' : ''}>Connect and synchronize</button>`);
    $('#midi-open').onclick = () => { const i = $('#midi-in').value, o = $('#midi-out').value; closeModal(); run('Connecting MIDI', async () => { await transport.connectMidi(i,o); await keyboard.synchronize(); toast('MIDI keyboard synchronized.'); }); };
  });
}
function saveToLibrary(owner) {
  const draft = workspace.drafts[owner];
  const existing = workspace.library.findIndex(i => i.id === draft.id);
  modal(`<div class="eyebrow">SAVE AN IDEA</div><h2 id="modal-title">Keep this ${owner === 'lyric' ? 'lyric' : 'sound'}.</h2><p>${existing >= 0 ? 'Update the saved idea, or keep these edits as a new copy.' : 'This saves a separate copy in this browser’s library.'}</p><label class="field">Name<input type="text" id="save-name" maxlength="200" value="${esc(draft.name)}"></label><div class="toolbar"><button class="button dark" id="save-library">${existing >= 0 ? 'Update saved item' : 'Save to library'}</button>${existing >= 0 ? '<button class="button" id="save-copy">Save new copy</button>' : ''}</div>`);
  const save = copy => {
    const name = $('#save-name').value.trim(); if (!name) { toast('Give your idea a name.', true); return; }
    if ((existing < 0 || copy) && workspace.library.filter(i => i.type === owner).length >= 500) { toast('This library category has reached its 500-item limit. Export or remove an item first.', true); return; }
    const item = { ...structuredClone(draft), id: existing >= 0 && !copy ? draft.id : crypto.randomUUID(), name };
    if (existing >= 0 && !copy) workspace.library[existing] = item; else workspace.library.push(item);
    draft.id = item.id; draft.name = name;
    closeModal(); persist(); render(); toast(existing >= 0 && !copy ? 'Library item updated.' : 'Saved a copy to your library.');
  };
  $('#save-library').onclick = () => save(false);
  if ($('#save-copy')) $('#save-copy').onclick = () => save(true);
}
function transferDialog(owner) {
  keyboard.requireReady();
  const draft = workspace.drafts[owner];
  modal(`<div class="eyebrow">SEND ${owner === 'lyric' ? 'LYRICS' : owner === 'vocal' ? 'VOICE' : 'INSTRUMENT'}</div><h2 id="modal-title">Where should it go?</h2><p>${esc(draft.name)} · ${owner === 'lyric' ? 'Text and phonemes' : 'Title, sound selection, and all four banks'}</p><label class="field">Destination<select id="transfer-target"><option value="127">Current buffer · temporary</option>${Array.from({length:20}, (_,i) => `<option value="${i}">${owner === 'lyric' ? 'Lyric' : owner === 'vocal' ? 'Vocal' : 'Instrument'} slot ${String(i+1).padStart(2,'0')} · overwrite</option>`).join('')}</select></label><div id="transfer-warning" class="transfer-summary">Replaces the keyboard’s temporary ${owner === 'lyric' ? 'lyric' : 'sound'} buffer. Numbered slots remain available for stored memories.</div><button class="button dark full-width" id="transfer-confirm">Apply to current buffer →</button>`);
  $('#transfer-target').onchange = () => {
    const stored = $('#transfer-target').value !== '127';
    $('#transfer-warning').textContent = stored ? `This replaces ${owner === 'lyric' ? 'lyric' : owner === 'vocal' ? 'vocal' : 'instrument'} slot ${Number($('#transfer-target').value) + 1} on the keyboard. Its previous contents cannot be restored by this app.` : `Replaces the temporary ${owner === 'lyric' ? 'lyric' : 'sound'} buffer.`;
    $('#transfer-confirm').textContent = stored ? 'Overwrite selected slot →' : 'Apply to current buffer →';
  };
  $('#transfer-confirm').onclick = () => {
    const slot = Number($('#transfer-target').value), snapshot = structuredClone(draft); closeModal();
    run('Sending ' + (owner === 'lyric' ? 'lyrics' : 'sound'), async () => {
      if (owner === 'lyric') {
        const parsed = parseLyrics(snapshot.text, data.lyrics);
        if (parsed.tokens.length >= 16384) throw Error('This lyric exceeds the supported syllable position range');
        await keyboard.uploadLyric(slot, lyricPayload(snapshot.title, parsed, data.lyrics));
        if (slot === 127) { currentLyric = lyricIdentity(snapshot); selectedToken = 0; loopActive = false; await keyboard.loop(0,0); await keyboard.position(0); }
        toast(`Lyric transfer acknowledged by the keyboard (${slot === 127 ? 'current buffer' : 'slot ' + (slot+1)}).`);
      } else {
        keyboard.requireReady();
        const messages = soundMessages(snapshot,slot,bank[owner],data,keyboard.registry);
        if (slot === 127) { applied[owner] = false; live[owner] = false; }
        for (const message of messages) await keyboard.send(message.address,message.payload);
        if (slot === 127) applied[owner] = true;
        toast(`Sound sent to ${slot === 127 ? 'current buffer' : 'slot ' + (slot+1)}. Sound writes have no device acknowledgement.`);
      }
    });
  };
}
function exportBackup() { download('vkb-forever-workspace.json', workspace); toast('Workspace backup exported.'); }
async function importBackup(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Backup is too large (maximum 10 MB).', true); return; }
  try {
    const incoming = validateWorkspace(JSON.parse(await file.text()), data.parameters);
    confirmAction('Replace this workspace?', `The backup contains ${incoming.library.length} library items and three drafts. Export your current workspace first if you want to keep it. The keyboard will not be changed.`, () => { workspace = incoming; live = {vocal:false,pcm:false}; applied = {vocal:false,pcm:false}; currentLyric = null; startupWarning = ''; persist(); toast('Workspace imported.'); }, 'Replace local workspace');
  } catch (error) { toast('Could not import: ' + error.message, true); }
}
async function sendParameter(owner, def, value) {
  if (!live[owner]) return;
  try { keyboard.requireReady(); await keyboard.send(def.address, encodeParameter(def,soundValue(def,value,keyboard.registry),data)); }
  catch (error) { live[owner] = false; applied[owner] = false; toast(error.message, true); render(); }
}
function invalidateSound(owner) {
  applied[owner]=false;live[owner]=false;
  if(route===owner && $('#live-edit')) {
    $('#live-edit').checked=false;$('#live-edit').disabled=true;
    const note=$('.editor-note span');if(note)note.textContent='Four independent banks. Apply this draft to the current buffer to enable live edits.';
  }
}
function bind() {
  document.querySelectorAll('[data-param]').forEach(input => {
    const owner = input.dataset.owner, d = data.parameters.find(d => d.owner === owner && d.identifier === input.dataset.param);
    input.oninput = () => { $(`#value-${d.identifier}`).textContent = valueLabel(d, Number(input.value)); };
    input.onchange = () => { const value = Number(input.value); if (owner === 'global') globals[d.identifier] = value; else { workspace.drafts[owner].values[d.identifier] = value; if(!live[owner])invalidateSound(owner);persist();sendParameter(owner, d, value); } };
  });
  document.querySelectorAll('[data-draft]').forEach(input => input.oninput = () => {
    workspace.drafts[input.dataset.owner][input.dataset.draft] = input.value;
    if(input.dataset.owner!=='lyric' && input.dataset.draft==='title')invalidateSound(input.dataset.owner);
    persist(); if (input.dataset.owner === 'lyric') refreshLyricPreview();
  });
  document.querySelectorAll('[data-bank]').forEach(button => button.onclick = () => {
    const owner = button.dataset.owner; bank[owner] = Number(button.dataset.bank);
    if (live[owner]) run('Selecting bank', () => keyboard.send([owner === 'vocal' ? 48 : 64,127,2],[bank[owner]])); else render();
  });
  document.querySelectorAll('[data-selector]').forEach(select => select.onchange = () => {
    const owner = select.dataset.selector, d = data.parameters.find(d => d.owner === owner && d.bank === -1);
    workspace.drafts[owner].values[d.identifier] = Number(select.value); if(!live[owner])invalidateSound(owner);persist();sendParameter(owner,d,Number(select.value));render();
  });
  if ($('#live-edit')) $('#live-edit').onchange = e => {
    const owner=e.target.dataset.owner;
    if(e.target.checked)run('Enabling live edits',async()=>{keyboard.requireReady();await keyboard.send([owner==='vocal'?48:64,127,2],[bank[owner]]);live[owner]=true;});
    else {live[owner]=false;render();}
  };
  if ($('#lyric-text')) $('#lyric-text').oninput = e => { workspace.drafts.lyric.text = e.target.value; persist(); refreshLyricPreview(); };
  if ($('#token-preview')) $('#token-preview').onclick = e => { const button = e.target.closest('[data-token]'); if (!button || busy) return; selectedToken = Number(button.dataset.token); if (keyboard.ready && currentLyric === lyricIdentity(workspace.drafts.lyric)) run('Moving lyric position', () => keyboard.position(selectedToken)); else refreshLyricPreview(); };
  for (const id of ['loop-start','loop-end']) if ($('#'+id)) $('#'+id).onchange = () => {
    const values = [Number($('#loop-start').value)-1,Number($('#loop-end').value)-1];
    if (!values.every(n => Number.isInteger(n) && n >= 0 && n < 16384)) { toast('Loop positions must be whole numbers from 1 to 16384.',true); return; }
    workspace.drafts.lyric.loop = values; persist(); refreshLyricPreview();
  };
  document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => { libraryFilter = button.dataset.filter; render(); });
  if ($('#library-search')) $('#library-search').oninput = e => { const position = e.target.selectionStart; librarySearch = e.target.value; render(); $('#library-search').focus(); $('#library-search').setSelectionRange(position, position); };
  if ($('#import-file')) $('#import-file').onchange = e => importBackup(e.target.files[0]);
  document.querySelectorAll('.library-card').forEach(card => {
    const id = $('[data-id]',card).dataset.id, index = workspace.library.findIndex(i=>i.id===id);
    const actions = $('.library-actions',card);
    for (const [action,label,disabled] of [['rename','Rename',false],['up','↑',index===0],['down','↓',index===workspace.library.length-1]]) {
      const button = document.createElement('button');button.type='button';button.className='button';button.textContent=label;
      button.dataset.itemAction=action;button.dataset.id=id;button.disabled=busy||disabled;
      button.setAttribute('aria-label',action==='up'?'Move item earlier':action==='down'?'Move item later':'Rename item');actions.append(button);
    }
  });
  document.querySelectorAll('[data-item-action]').forEach(button => button.onclick = () => {
    const index = workspace.library.findIndex(i => i.id === button.dataset.id), item = workspace.library[index];
    if (!item) return;
    if (button.dataset.itemAction === 'rename') {
      modal(`<div class="eyebrow">LIBRARY NAME</div><h2 id="modal-title">Rename this idea.</h2><label class="field">Name<input type="text" id="rename-item" maxlength="200" value="${esc(item.name)}"></label><button class="button dark" id="rename-save">Save name</button>`);
      $('#rename-save').onclick = () => { const name=$('#rename-item').value.trim();if(!name){toast('Enter a name.',true);return;}item.name=name;persist();closeModal();render(); };
    }
    if (button.dataset.itemAction === 'up' || button.dataset.itemAction === 'down') {
      const next=index+(button.dataset.itemAction==='up'?-1:1);
      if(next>=0 && next<workspace.library.length){workspace.library.splice(index,1);workspace.library.splice(next,0,item);persist();render();}
    }
    if (button.dataset.itemAction === 'open') confirmAction('Open this idea?', 'This replaces the local draft in its editor. Save your draft to the library first if you want to keep it.', () => { workspace.drafts[item.type] = structuredClone(item); live[item.type] = false; applied[item.type] = false; if (item.type === 'lyric') currentLyric = null; persist(); location.hash = item.type; }, 'Open in editor');
    if (button.dataset.itemAction === 'duplicate') {
      if (workspace.library.filter(i => i.type === item.type).length >= 500) { toast('Library category limit reached.',true); return; }
      workspace.library.splice(index+1,0,{...structuredClone(item),id:crypto.randomUUID(),name:item.name.slice(0,193)+' (copy)'});persist();render();
    }
    if (button.dataset.itemAction === 'delete') confirmAction('Delete this saved idea?', item.name + ' will be removed from this browser’s library.', () => { workspace.library.splice(index,1);persist();toast('Library item deleted.'); }, 'Delete item');
  });
  document.querySelectorAll('[data-activate]').forEach(button => button.onclick = () => confirmAction('Activate this singer?', `Send an activation request for ${button.dataset.activate} to the keyboard. Acceptance depends on the instrument; no purchase is performed.`, async () => { await keyboard.activate(button.dataset.activate); toast('Singer activation acknowledged.'); }, 'Send activation request'));
  document.querySelectorAll('[data-read-sound]').forEach(button => button.onclick = () => {
    const owner = button.dataset.readSound, values = received[owner].get(127);
    confirmAction('Use received sound settings?', 'This replaces the local draft’s received values. Any settings absent from the dump retain your existing draft values. No title readback is documented for sound memories.', () => { Object.assign(workspace.drafts[owner].values, values); applied[owner] = false;live[owner] = false;persist();location.hash = owner; }, 'Use received values');
  });
  document.querySelectorAll('[data-read-lyric]').forEach(button => button.onclick = () => {
    const item = received.lyrics.get(Number(button.dataset.readLyric));
    confirmAction('Open received lyric?', 'This replaces the local lyric draft. The incoming flag is retained in the receive journal; flagged content is not eligible for copying.', () => {
      if (item.flag) throw Error('The keyboard marked this lyric as non-copyable');
      workspace.drafts.lyric = {...newLyric(),name:item.title || 'Received lyric',title:item.title,text:item.text};currentLyric = null;persist();location.hash = 'lyric';
    }, 'Open lyric');
  });
  document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => handleAction(button.dataset.action, button.dataset.owner));
}
function handleAction(action, owner) {
  try {
    if (action === 'connect') return run('Connecting Bluetooth', connect);
    if (action === 'device') { location.hash = 'device'; return; }
    if (action === 'save') return saveToLibrary(owner);
    if (action === 'transfer') return transferDialog(owner);
    if (action === 'reset-bank') return confirmAction('Reset this bank?', 'Restore protocol constructor defaults in this bank. Other banks and the sound selector are preserved.', async () => {
      const defs = data.parameters.filter(d => d.owner === owner && d.bank === bank[owner]);
      const shouldSend=live[owner];
      for (const d of defs) workspace.drafts[owner].values[d.identifier] = d.default;
      if(!shouldSend)invalidateSound(owner);
      persist();
      if(shouldSend)for(const d of defs)await keyboard.send(d.address,encodeParameter(d,d.default,data));
      toast('Bank reset.');
    }, 'Reset bank');
    if (action === 'export') return exportBackup();
    if (action === 'import') return $('#import-file').click();
    if (action === 'midi') return openMidi();
    if (action === 'sync') return run('Synchronizing instrument', () => keyboard.synchronize());
    if (action === 'disconnect') { transport.disconnect(); return; }
    if (action === 'availability') return run('Checking singer availability', () => keyboard.availability());
    if (action === 'new-lyric') return confirmAction('Start a new lyric?', 'This replaces the current local lyric draft. Save it to your library first to keep it.', () => { workspace.drafts.lyric = newLyric(); currentLyric = null;selectedToken=0;persist(); }, 'New lyric');
    if (action === 'loop') {
      const start = workspace.drafts.lyric.loop[0], end = workspace.drafts.lyric.loop[1], count = parseLyrics(workspace.drafts.lyric.text,data.lyrics).tokens.length;
      if (currentLyric !== lyricIdentity(workspace.drafts.lyric)) throw Error('Upload this lyric to the current buffer first');
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= count) throw Error('Choose a valid inclusive loop range within this lyric');
      return run('Applying lyric loop', async () => { await keyboard.loop(start,end-start+1);loopActive=true;toast('Loop sent to keyboard.'); });
    }
    if (action === 'loop-off') return run('Disabling lyric loop', async () => { await keyboard.loop(0,0);loopActive=false;toast('Loop disabled.'); });
    if (action === 'send-globals') return confirmAction('Send these keyboard settings?', 'All displayed system settings will be sent. Values not received from the keyboard began at protocol defaults.', async () => { keyboard.requireReady(); for (const d of data.parameters.filter(d => d.owner === 'global')) { const v = globals[d.identifier] ?? d.default; await keyboard.send(d.address,encodeParameter(d,v,data)); if (d.identifier === 'MidiInterval') transport.interval = v; } toast('System settings sent.'); }, 'Send all settings');
    if (action === 'rename-device') {
      const name = $('#device-name').value;
      if (!/^[\x20-\x7e]{1,8}$/.test(name)) throw Error('Use 1–8 printable ASCII characters');
      return confirmAction('Rename your keyboard?', 'The keyboard may need a power cycle before its Bluetooth name changes. There is no rename acknowledgement.', async () => { keyboard.requireReady(); await transport.send(Uint8Array.from([240,67,115,1,51,80,0,1,...Array.from(name.padEnd(16,' '),c=>c.charCodeAt(0)),247]));toast('Rename sent. Power-cycle the keyboard to see its new name.'); }, 'Send new name');
    }
    if (action === 'toggle-log') { logVisible = !logVisible; render(); return; }
    if (action === 'export-log') return download('vkb-forever-midi-log.json',{ version:1,firmware:keyboard.version || null,transport:transport.kind || null,entries:keyboard.logs });
  } catch (error) { toast(error.message,true); }
}

transport.addEventListener('connection', () => {
  applied = {vocal:false,pcm:false}; live = {vocal:false,pcm:false}; currentLyric = null;loopActive=false;
  received.vocal.clear();received.pcm.clear();received.lyrics.clear();rawSingers.clear();keyboard.version = null;
  updateConnection(); if (!busy) render();
});
keyboard.addEventListener('status', e => {
  status = e.detail;
  if(status==='Reading firmware version…'){applied={vocal:false,pcm:false};live={vocal:false,pcm:false};currentLyric=null;loopActive=false;}
  updateConnection(); if (!busy) render();
});
keyboard.addEventListener('registry', () => {
  for (const [slot, raw] of rawSingers) {
    const values = received.vocal.get(slot), canonical = canonicalSinger(raw,keyboard.registry);
    if (values && canonical >= 0) values.VocaloNumber = canonical;
  }
  if (!busy) render();
});
keyboard.addEventListener('log', e => {
  if ($('#traffic-log')) { $('#traffic-log').textContent = keyboard.logs.map(row => `${row.time} ${row.direction} ${row.message}`).join('\n'); $('#traffic-log').scrollTop = $('#traffic-log').scrollHeight; }
});
keyboard.addEventListener('message', e => {
  if (!data) return;
  const {address:a,payload:p} = e.detail;
  try {
    const owner = a[0] >= 48 && a[0] <= 52 ? 'vocal' : a[0] >= 64 && a[0] <= 68 ? 'pcm' : a[0] === 0 ? 'global' : null;
    const def = data.parameters.find(d => d.owner === owner && d.address[0] === a[0] && d.address[2] === a[2]);
    if (def) {
      let value = decodeParameter(def,p,data);
      if (value !== null && def.identifier === 'VocaloNumber') { rawSingers.set(a[1],value); value = canonicalSinger(value,keyboard.registry); if (value < 0) value = null; }
      if (value !== null) {
        if (owner === 'global') { globals[def.identifier] = value; if (def.identifier === 'MidiInterval') transport.interval = value; }
        else { const snapshot = received[owner].get(a[1]) || {};snapshot[def.identifier]=value;received[owner].set(a[1],snapshot); }
      }
    }
    if (a[0] === 34 && a[2] === 0) {
      const incoming = decodeLyric(p); received.lyrics.set(a[1],incoming);
      // Only relink a known current lyric; new readback never silently replaces a draft.
      if (a[1] === 127 && incoming.text !== workspace.drafts.lyric.text) currentLyric = null;
    }
    if (a[0] === 33 && a[1] === 127 && a[2] === 0 && p.length === 2 && currentLyric === lyricIdentity(workspace.drafts.lyric)) { selectedToken = readU7(p); refreshLyricPreview(); }
    if (a[0] === 33 && a[1] === 127 && a[2] === 2 && p.length === 4 && currentLyric === lyricIdentity(workspace.drafts.lyric)) {
      const start=readU7(p.slice(0,2)),count=readU7(p.slice(2)),total=parseLyrics(workspace.drafts.lyric.text,data.lyrics).tokens.length;
      if(!count)loopActive=false;
      else if(start+count<=total){workspace.drafts.lyric.loop=[start,start+count-1];loopActive=true;persist();}
      refreshLyricPreview();
    }
  } catch (error) { keyboard.log('DECODE',error.message); }
});
window.addEventListener('hashchange', () => { route = names[location.hash.slice(1)] ? location.hash.slice(1) : 'vocal';render();window.scrollTo(0,0); });
$('#connect').onclick = () => { if (transport.connected) location.hash = 'device'; else run('Connecting Bluetooth',connect); };
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) { const rect = $('#modal').getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) closeModal(); } });

async function init() {
  const [parameters,lyrics,skills] = await Promise.all(['parameters','lyrics','skills'].map(async name => { const response = await fetch(new URL(`../data/${name}.json`,import.meta.url)); if (!response.ok) throw Error(`Could not load ${name}`); return response.json(); }));
  data = {parameters,lyrics,skills};
  const globalLabels = {EqType:'Equalizer',WrongKeyDetectTime:'Wrong-key detection',WordsForPhraseSkip:'Phrase-skip syllable',MasterTune:'Master tuning (raw offset)',BatteryType:'Battery type',AutoPowerOffTime:'Auto power off',MidiCh:'MIDI channel',MidiKeyboardEnabled:'MIDI keyboard',SpeakerEnabled:'Built-in speaker',MidiInterval:'MIDI pacing'};
  for (const d of parameters) if (globalLabels[d.identifier]) d.label = globalLabels[d.identifier];
  parameters.find(d => d.identifier === 'BatteryType').choices = ['Alkaline / manganese','Rechargeable Ni-MH'];
  for (const id of ['MidiKeyboardEnabled','SpeakerEnabled']) parameters.find(d => d.identifier === id).choices = ['Off','On'];
  try { workspace = loadWorkspace(parameters); }
  catch { workspace = defaultWorkspace(parameters); startupWarning = 'Saved browser data could not be loaded. A fresh workspace is open; the previous saved data will be replaced when you make an edit. Keep an exported backup of your work.'; }
  route = names[location.hash.slice(1)] ? location.hash.slice(1) : 'vocal';
  $('.library-count').textContent = workspace.library.length;
  render(); updateConnection();
}
init().catch(error => { $('#main').innerHTML = `<div class="notice error">${esc(error.message)}. Serve the app using “npm run dev” or open the HTTPS GitHub Pages site, then reload.</div>`; });
