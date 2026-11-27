// Assemble the static site in dist/site: public/ files plus the compiled browser code.
// (Run after `tsc`, which compiles src/ to dist/src/.)
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { markdownToHtml } from './markdown.mjs';

const out = 'dist/site';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });
for (const dir of ['client', 'shared']) {
  cpSync(`dist/src/${dir}`, `${out}/src/${dir}`, { recursive: true, filter: (f) => !f.endsWith('.map') });
}

// The rules page, built from rules.md (DV-02): the rulebook with a table of contents.
const body = markdownToHtml(readFileSync('rules.md', 'utf8'));
const contents = [...body.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)].map(([, id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('');
const firstH2 = body.indexOf('<h2');
const rulesPage = readFileSync('public/index.html', 'utf8')
  .replace(/<title>.*<\/title>/, '<title>Rules · Battle Lines</title>')
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="The rules of Battle Lines, a correspondence hex wargame.">')
  .replace(/<main[\s\S]*<\/main>/, `<main class="rules">${body.slice(0, firstH2)}<nav class="contents"><h2>Contents</h2><ul>${contents}</ul></nav>${body.slice(firstH2)}</main>`)
  .replace(/\s*<script[^>]*><\/script>/, '');
writeFileSync(`${out}/rules.html`, rulesPage);

console.log(`Site built in ${out}/`);
