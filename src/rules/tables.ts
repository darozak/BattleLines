// The tables in rules.md that come straight from the game's data: terrain, map sizes and every era's
// units. `npm run rules` rewrites them in rules.md; a test fails if rules.md is out of date (DV-02).
import { TERRAIN } from '../shared/terrain.js';
import { ERAS, MAP_SIZES, POINT_LIMITS, SCENARIOS, ROUND_OPTIONS, OBJECTIVE_OPTIONS } from '../shared/setup.js';
import { LINK_VERSION } from '../shared/link.js';
import type { TerrainType } from '../shared/types.js';

const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const table = (head: string[], rows: (string | number)[][]) =>
  [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

function terrainTable(): string {
  return table(['Terrain', 'Move cost', 'Cover', 'Blocks sight'],
    (Object.keys(TERRAIN) as TerrainType[]).map((id) => {
      const t = TERRAIN[id];
      return [t.name, t.impassable ? 'impassable' : t.cost, t.impassable ? '–' : t.defense ? `+${t.defense}` : 0,
        t.blocksSight ? 'yes' : t.sightBonus ? `no (+${t.sightBonus} sight from it)` : 'no'];
    }));
}

function sizesTable(): string {
  return table(['Map', 'Hexes', 'Rounds (default)', 'Objectives (default)', 'Starting zone depth'],
    Object.values(MAP_SIZES).map((s) => [s.name, `${s.cols} × ${s.rows}`, s.turnLimit, s.objectives, `${s.zoneDepth} hexes`]))
    + `\n\nPoint limits: ${POINT_LIMITS.join(', ')}. Rounds: ${ROUND_OPTIONS.join(', ')}. Objectives, where the scenario lets you choose: ${OBJECTIVE_OPTIONS.join(', ')}.`;
}

function unitsTables(): string {
  const out: string[] = [];
  for (const era of Object.values(ERAS)) {
    out.push(`### ${era.name}`, '', era.description, '');
    for (const army of era.armies) {
      out.push(`**${army.name}.** ${army.description}`, '');
      out.push(table(['Unit', 'Points', 'Move', 'Climb', 'Strength', 'Fire', 'Range', 'Morale', 'Rally', 'Sight'],
        Object.values(army.units).map((u) => [u.name, u.points, u.move, u.climb, u.strength,
          u.range ? u.fire : '–', u.range || '–', u.morale, u.rally || '–', u.sight])), '');
    }
  }
  return out.join('\n').trimEnd();
}

function scenariosTable(): string {
  return table(['Scenario', 'How to win'], Object.values(SCENARIOS).map((sc) => [`**${sc.name}**`, sc.description]));
}

/** Every generated section of rules.md, by the name in its markers. */
export function generatedSections(): Record<string, string> {
  return {
    version: `These rules are version **${LINK_VERSION}**, the same as the game's link version: a link from another version won't open.`,
    terrain: terrainTable(),
    sizes: sizesTable(),
    scenarios: scenariosTable(),
    units: unitsTables(),
  };
}

// The content between the markers is empty or ends with a newline; the lazy match stops at the first end marker.
const MARKER = /<!-- generated:(\w+) -->\n[\s\S]*?<!-- \/generated -->/g;

/** rules.md with every generated section brought up to date. */
export function updateRules(markdown: string): string {
  const sections = generatedSections();
  return markdown.replace(MARKER, (whole, name: string) =>
    name in sections ? `<!-- generated:${name} -->\n${sections[name]}\n<!-- /generated -->` : whole);
}

/** The names of the generated sections present in rules.md. */
export const sectionsIn = (markdown: string) => [...markdown.matchAll(MARKER)].map((m) => m[1]);
