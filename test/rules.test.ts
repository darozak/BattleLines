// rules.md is the rulebook players read on the live site. Its tables and version come from the game's
// data, so a change to the game can't pass the tests until the rules are brought up to date (DV-02).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { updateRules, sectionsIn, generatedSections } from '../src/rules/tables.js';

const rules = readFileSync('rules.md', 'utf8');

test('rules.md has every generated section', () => {
  assert.deepEqual(sectionsIn(rules).sort(), Object.keys(generatedSections()).sort());
});

test('rules.md is up to date with the game (run `npm run rules`, then review the prose, per DV-02)', () => {
  assert.equal(updateRules(rules), rules, 'a generated table or the rules version is out of date: run `npm run rules`');
});
