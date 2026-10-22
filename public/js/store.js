const KEY = 'vkb-forever.workspace.v1';
export function newSound(owner, definitions, name = 'Untitled sound') {
  return { id: crypto.randomUUID(), type: owner, name, title: owner === 'vocal' ? 'VOICE' : 'SOUND', values: Object.fromEntries(definitions.filter(d => d.owner === owner).map(d => [d.identifier, d.default])) };
}
export function newLyric() { return { id: crypto.randomUUID(), type: 'lyric', name: 'Untitled lyric', title: 'LYRIC', text: 'ラララ\nラララ', loop: [0,2] }; }
export function defaultWorkspace(definitions) {
  return { version: 1, drafts: { vocal: newSound('vocal', definitions, 'My voice'), pcm: newSound('pcm', definitions, 'My instrument'), lyric: newLyric() }, library: [] };
}
export function validateWorkspace(value, definitions) {
  if (!value || value.version !== 1 || !value.drafts || !Array.isArray(value.library) || value.library.length > 1500) throw Error('Invalid workspace backup');
  const validate = item => {
    if (!item || !['vocal','pcm','lyric'].includes(item.type) || typeof item.id !== 'string' || typeof item.name !== 'string' || item.name.length > 200 || typeof item.title !== 'string' || item.title.length > 100) throw Error('Invalid library item');
    if (item.type === 'lyric') {
      if (typeof item.text !== 'string' || item.text.length > 50000 || !Array.isArray(item.loop) || item.loop.length !== 2 || !item.loop.every(n => Number.isInteger(n) && n >= 0 && n < 16384)) throw Error('Invalid lyric item');
      return { id: item.id, type: item.type, name: item.name, title: item.title, text: item.text, loop: [...item.loop] };
    }
    const values = {};
    for (const d of definitions.filter(d => d.owner === item.type)) {
      const v = item.values?.[d.identifier];
      if (!Number.isInteger(v) || v < d.minimum || v > d.maximum) throw Error(`Invalid ${d.identifier} in backup`);
      values[d.identifier] = v;
    }
    return { id: item.id, type: item.type, name: item.name, title: item.title, values };
  };
  const drafts = {};
  for (const type of ['vocal','pcm','lyric']) { drafts[type] = validate(value.drafts[type]); if (drafts[type].type !== type) throw Error('Wrong draft type'); }
  const library = value.library.map(validate);
  if (new Set(library.map(item => item.id)).size !== library.length) throw Error('Duplicate library identifiers');
  for (const type of ['vocal','pcm','lyric']) if (library.filter(item=>item.type===type).length > 500) throw Error('Library category exceeds 500 items');
  return { version: 1, drafts, library };
}
export function loadWorkspace(definitions, storage = localStorage) {
  const raw = storage.getItem(KEY); return raw ? validateWorkspace(JSON.parse(raw), definitions) : defaultWorkspace(definitions);
}
export function saveWorkspace(workspace, storage = localStorage) { storage.setItem(KEY, JSON.stringify(workspace)); }
