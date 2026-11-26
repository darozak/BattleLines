// Assemble the static site in dist/site: public/ files plus the compiled browser code.
// (Run after `tsc`, which compiles src/ to dist/src/.)
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const out = 'dist/site';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });
for (const dir of ['client', 'shared']) {
  cpSync(`dist/src/${dir}`, `${out}/src/${dir}`, { recursive: true, filter: (f) => !f.endsWith('.map') });
}
console.log(`Site built in ${out}/`);
