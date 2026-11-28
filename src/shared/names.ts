// Random battle names (#54): a form ("Battle of", "Siege of", ...) and a place built from varied parts,
// for example "Battle of Raven's Ford" or "Clash at Blackwater Crossing". Thousands of combinations.

const FORMS = [
  'Battle of', 'Battle of', 'Battle of', 'Siege of', 'Clash at', 'Stand at', 'Struggle for', 'Defence of',
  'Assault on', 'Skirmish at', 'Fight at', 'Last Stand at', 'Storming of', 'Retreat from', 'Raid on', 'Holding of',
];
// Places: one word ("Ashford") or a first part and a feature ("Raven's Ford", "Blackwater Crossing").
const FIRST = [
  'Raven', 'Black', 'Red', 'Grey', 'White', 'Iron', 'Stone', 'Oak', 'Ash', 'Elm', 'Thorn', 'Wolf', 'Hawk', 'Crow',
  'Fox', 'Bear', 'Kings', 'Queens', 'Bishops', 'Millers', 'Fallow', 'Hollow', 'High', 'Low', 'Long', 'Broad', 'Cold',
  'Windy', 'Misty', 'Silver', 'Golden', 'Copper', 'Willow', 'Hazel', 'Bramble', 'Heather', 'Marsh', 'Moor', 'Old',
  'Saint', 'Crown', 'Lantern', 'Bell', 'Gallows', 'Beacon',
];
const SECOND = [
  'ford', 'bridge', 'hill', 'ridge', 'wood', 'field', 'mill', 'water', 'brook', 'gate', 'crossing', 'heath', 'fen',
  'marsh', 'hollow', 'farm', 'church', 'tower', 'wall', 'pass', 'vale', 'dale', 'cross', 'well', 'barrow', 'stead',
  'ham', 'ton', 'by', 'wick', 'combe', 'mere', 'moor', 'down', 'bank',
];
const FEATURES = [
  'Ford', 'Bridge', 'Hill', 'Ridge', 'Wood', 'Crossing', 'Heath', 'Farm', 'Mill', 'Church', 'Tower', 'Pass', 'Gap',
  'Crossroads', 'Orchard', 'Quarry', 'Farmhouse', 'Spur', 'Heights', 'Junction', 'Fields', 'Copse', 'Causeway',
];

// Possessive places only with words that can own one ("Raven's Ford", not "Long's Ford").
const OWNERS = ['Raven', 'Wolf', 'Hawk', 'Crow', 'Fox', 'Bear', 'Kings', 'Queens', 'Bishops', 'Miller', 'Smith', 'Abbot',
  'Shepherd', 'Hunter', 'Tanner', 'Cooper', 'Fletcher', 'Mason', 'Baron', 'Widow', 'Piper', 'Drummer', 'Ferryman'];
const possessive = (owner: string, feature: string) => `${owner}${owner.endsWith('s') ? "'" : "'s"} ${feature}`;

/** A random item, from the browser's (or Node's) cryptographic random numbers. */
const pick = <T>(list: T[]): T => list[globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % list.length];

/** A random battle name, e.g. "Battle of Raven's Ford", "Siege of Oakham" or "Stand at Greymoor Ridge". */
export function randomBattleName(): string {
  const first = pick(FIRST);
  const shape = pick([0, 0, 1, 1, 2]);
  const place =
    shape === 0 ? `${first}${pick(SECOND)}` // "Ravenford"
      : shape === 1 ? `${first}${pick(SECOND)} ${pick(FEATURES)}` // "Greymoor Ridge"
        : possessive(pick(OWNERS), pick(FEATURES)); // "Raven's Ford", "Kings' Ford"
  const form = pick(FORMS);
  return `${form} ${place}`.replace(/(\w)\1\1/g, '$1$1'); // no triple letters ("Bellll")
}
