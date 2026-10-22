import { cp, mkdir, readdir, rm } from 'node:fs/promises';
const target = new URL('../dist/', import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(new URL('../public/', import.meta.url), target, { recursive: true });
console.log(`Static app built: ${(await readdir(target)).length} entries in dist/`);
