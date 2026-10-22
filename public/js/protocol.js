export const PREFIX = [0xf0, 0x43, 0x73, 0x01, 0x52, 0x25, 0x27];
export const CURRENT = 0x7f;
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(' ');
export const fromHex = s => Uint8Array.from(s.replace(/\s/g, '').match(/../g) || [], b => parseInt(b, 16));
export function u7(value, width = 1) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 128 ** width) throw Error('Integer outside MIDI range');
  return Array.from({ length: width }, (_, i) => Math.floor(value / 128 ** (width - i - 1)) % 128);
}
export const readU7 = bytes => Array.from(bytes).reduce((n, b) => n * 128 + b, 0);
export function pack7(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 7) {
    const group = Array.from(bytes.slice(i, i + 7));
    out.push(group.reduce((n, b, j) => n | ((b >> 7) << (6 - j)), 0), ...group.map(b => b & 127));
  }
  return out;
}
export function unpack7(bytes) {
  if (Array.from(bytes).some(b => b > 127)) throw Error('Invalid packed MIDI data');
  const out = [];
  for (let i = 0; i < bytes.length; i += 8) {
    if (i + 1 === bytes.length) throw Error('Truncated packed MIDI data');
    for (let j = 0; j < Math.min(7, bytes.length - i - 1); j++) out.push(bytes[i + j + 1] | (((bytes[i] >> (6 - j)) & 1) << 7));
  }
  return out;
}
export function frame(address, payload = []) {
  if (address.length !== 3 || [...address, ...payload].some(b => !Number.isInteger(b) || b < 0 || b > 127)) throw Error('Invalid SysEx data');
  return Uint8Array.from([...PREFIX, 0x10, ...address, ...payload, 0xf7]);
}
export function parseFrame(bytes) {
  if (bytes.length < 12 || !PREFIX.every((b, i) => bytes[i] === b) || bytes.at(-1) !== 0xf7 || (bytes[7] & 0xf0) !== 0x10) return null;
  if (Array.from(bytes.slice(8, -1)).some(b => b > 127)) return null;
  return { address: Array.from(bytes.slice(8, 11)), payload: Array.from(bytes.slice(11, -1)) };
}
export class MidiStream {
  constructor(onMessage) { this.onMessage = onMessage; this.reset(); }
  reset() { this.sysex = null; this.status = null; this.data = []; }
  feed(bytes) {
    for (const b of bytes) {
      if (b >= 0xf8) { this.onMessage(Uint8Array.of(b)); continue; }
      if (b === 0xf0) { this.sysex = [b]; this.status = null; continue; }
      if (this.sysex) {
        if (b === 0xf7) { this.sysex.push(b); this.onMessage(Uint8Array.from(this.sysex)); this.sysex = null; }
        else if (b < 128 && this.sysex.length < 262144) this.sysex.push(b);
        else this.reset();
        continue;
      }
      if (b >= 128) { this.status = b < 0xf0 ? b : null; this.data = []; continue; }
      if (this.status) {
        this.data.push(b);
        if (this.data.length === ([0xc0, 0xd0].includes(this.status & 0xf0) ? 1 : 2)) {
          this.onMessage(Uint8Array.from([this.status, ...this.data])); this.data = [];
        }
      }
    }
  }
}
export const LOOKUPS = {
  'x6.c': [0, 13, 25, 38, 51, 64, 76, 89, 102, 114, 127],
  'x6.b': [10, 25, 50, 60, 70, 80, 100, 150, 300, 600, 999],
  'x6.a': [0, 5, 10, 15, 30, 60, 120], 'x6.n': [10, 20, 30, 40, 50], 'x6.k': [0, 4, 8, 12]
};
export function encodeParameter(def, value, data) {
  if (!Number.isInteger(value) || value < def.minimum || value > def.maximum) throw Error(`Invalid ${def.label}`);
  if (def.width === 162) return Array.from(fromHex(data.skills[value].hex));
  if (def.identifier === 'WordsForPhraseSkip') {
    const syllable = data.lyrics.syllables.find(r => r.text === def.choices[value]);
    if (!syllable) throw Error('Unknown phrase-skip syllable');
    return Array.from({ length: 8 }, (_, i) => syllable.phonemes.charCodeAt(i) || 0);
  }
  return u7(LOOKUPS[def.codec]?.[value] ?? value, def.width);
}
export function decodeParameter(def, payload, data) {
  if (def.width === 162) return Math.max(0, data.skills.findIndex(s => hex(fromHex(s.hex)) === hex(payload)));
  if (def.identifier === 'WordsForPhraseSkip') {
    const phonemes = String.fromCharCode(...payload).split('\0')[0];
    const syllable = data.lyrics.syllables.find(s => s.phonemes === phonemes && def.choices.includes(s.text));
    return syllable ? def.choices.indexOf(syllable.text) : 0;
  }
  if (payload.length !== def.width) return null;
  const wire = readU7(payload), lookup = LOOKUPS[def.codec];
  const value = lookup ? (def.codec === 'x6.k' ? Math.max(0, lookup.findIndex(n => n >= wire)) : lookup.indexOf(wire)) : wire;
  return value >= def.minimum && value <= def.maximum ? value : null;
}
