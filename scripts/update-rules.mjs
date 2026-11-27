// Rewrite the generated tables in rules.md from the game's data (run `npm run rules`; see DV-02).
import { readFileSync, writeFileSync } from 'node:fs';
import { updateRules } from '../dist/src/rules/tables.js';

const before = readFileSync('rules.md', 'utf8');
const after = updateRules(before);
if (after === before) console.log('rules.md: generated sections already up to date.');
else { writeFileSync('rules.md', after); console.log('rules.md: generated sections updated.'); }
