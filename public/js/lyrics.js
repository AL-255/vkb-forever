import { pack7, unpack7, u7, readU7 } from './protocol.js';
export function parseLyrics(text, tables) {
  let filtered = '', rejected = '';
  for (const ch of text) {
    if (ch in tables.katakana_to_hiragana) filtered += ch;
    else if (ch in tables.hiragana_to_katakana) filtered += tables.hiragana_to_katakana[ch];
    else if (/^[a-zA-Z _\-ー\r\n\u2028\u2029\u0085]$/.test(ch)) filtered += ch;
    else rejected += ch;
  }
  const candidates = new Map();
  tables.syllables.forEach(r => { const key = r.text[0]; if (!candidates.has(key)) candidates.set(key, []); candidates.get(key).push(r); });
  for (const rows of candidates.values()) rows.sort((a, b) => b.text.length - a.text.length);
  const phrases = []; let phrase = [], off = false, unmatched = '';
  for (let i = 0; i < filtered.length;) {
    const r = candidates.get(filtered[i])?.find(r => filtered.startsWith(r.text, i));
    if (!r) { unmatched += filtered[i++]; continue; }
    i += r.text.length;
    if (r.phonemes === '__LINEFEED__') { if (phrase.length) phrases.push(phrase); phrase = []; off = false; }
    else if (r.phonemes === '__OPTIONAL__') { if (phrase.length) phrase.at(-1).text += r.text; }
    else if (r.phonemes === '__OFFSOUND__') { if (phrase.length && !phrase.at(-1).off) off = true; }
    else { phrase.push({ text: (off ? '_' : '') + r.text, phonemes: r.phonemes, off }); off = false; }
  }
  if (phrase.length) phrases.push(phrase);
  return { phrases, tokens: phrases.flat(), rejected: rejected + unmatched };
}
export function displayBytes(text, tables) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) bytes.push(...(tables.display_bytes[text[i]] || [text.charCodeAt(i) < 128 ? text.charCodeAt(i) : 63]));
  return bytes;
}
export function titleBytes(text, tables) {
  const out = [];
  for (let ch of text) {
    ch = tables.hiragana_to_katakana[ch] || ch;
    if (tables.display_bytes[ch]) out.push(...tables.display_bytes[ch]);
    else if (ch.charCodeAt(0) >= 0xff66 && ch.charCodeAt(0) <= 0xff9f) out.push(ch.charCodeAt(0) - 0xff00 + 0x40);
    else if (ch.charCodeAt(0) < 128) out.push(ch.charCodeAt(0));
    else if (/^[\u3400-\u9fff]$/.test(ch)) continue;
    else out.push(...Array(ch.length).fill(63));
  }
  return out.map(b => (b >= 32 && b <= 125) || (b >= 166 && b <= 223) ? b : 32);
}
export function soundTitle(text, tables) {
  const bytes = titleBytes(text, tables).slice(0, 9);
  while (bytes.length < 9) bytes.push(32);
  return pack7(bytes);
}
export function lyricPayload(title, parsed, tables) {
  if (!parsed.tokens.length) throw Error('Enter at least one playable syllable');
  if (parsed.rejected) throw Error('Resolve unsupported lyric text before sending');
  const display = [], phonemes = [];
  parsed.phrases.forEach((phrase, pi) => {
    if (pi) { display.push(47); phonemes.push(47); }
    phrase.forEach((token, ti) => {
      if (ti) { if (token.off) phonemes.push(95); else { display.push(38); phonemes.push(38); } }
      display.push(...displayBytes(token.text, tables));
      phonemes.push(...Array.from(token.phonemes, ch => ch.charCodeAt(0)));
    });
  });
  const raw = [...titleBytes(title, tables), 0, ...display, 0, ...phonemes, 0];
  const packed = pack7(raw);
  return [0, ...u7(packed.length, 4), ...packed];
}
export function decodeLyric(payload) {
  if (payload.length < 7 || readU7(payload.slice(1, 5)) !== payload.length - 5) throw Error('Invalid lyric payload length');
  const bytes = unpack7(payload.slice(5)), first = bytes.indexOf(0), second = bytes.indexOf(0, first + 1);
  if (first < 0 || second < 0) throw Error('Missing lyric string terminators');
  const decoder = new TextDecoder('shift_jis');
  return { title: decoder.decode(Uint8Array.from(bytes.slice(0, first))).normalize('NFKC'), text: decoder.decode(Uint8Array.from(bytes.slice(first + 1, second).filter(b => b !== 38).map(b => b === 47 ? 10 : b))).normalize('NFKC'), flag: payload[0] };
}
