import { encodeParameter } from './protocol.js';
import { soundTitle } from './lyrics.js';
export const SINGER_PREFIXES = ['VY1','MIK','MEG','IA','YKR'];
// Local presets retain canonical singer identity. Only the wire selector uses
// the received, compacted registry ordering.
export function soundValue(def, value, registry) {
  if (def.identifier !== 'VocaloNumber' || !registry.length) return value;
  const index = registry.findIndex(r => r.id.startsWith(SINGER_PREFIXES[value]));
  if (index < 0 || index > 4) throw Error('This singer is absent from the instrument registry');
  if (registry[index].available === false) throw Error('This singer is not activated. Check Keyboard & settings.');
  return index;
}
export function canonicalSinger(value, registry) {
  if (!registry.length) return value;
  return SINGER_PREFIXES.findIndex(prefix => registry[value]?.id.startsWith(prefix));
}
export function soundMessages(draft, slot, bank, data, registry = []) {
  if (!['vocal','pcm'].includes(draft.type) || ![127,...Array.from({length:20},(_,i)=>i)].includes(slot) || !Number.isInteger(bank) || bank < 0 || bank > 3) throw Error('Invalid sound destination');
  const base = draft.type === 'vocal' ? 48 : 64;
  const messages = [];
  // Validate the entire set before emitting any part of a transfer.
  const parameters = data.parameters.filter(d => d.owner === draft.type).map(d => ({ address: [d.address[0],slot,d.address[2]], payload: encodeParameter(d,soundValue(d,draft.values[d.identifier],registry),data) }));
  if (slot === 127) messages.push({address:[base,127,1],payload:[]});
  messages.push({address:[base,slot,3],payload:soundTitle(draft.title,data.lyrics)},...parameters);
  if (slot === 127) messages.push({address:[base,127,2],payload:[bank]});
  return messages;
}
