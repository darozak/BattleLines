// Random names (#54, #55): battle names and commanders' names to suit each era. Places are built from
// word parts in the style of the countries each era's armies fought over, so names are varied (thousands
// of combinations) and invented rather than real battles or famous commanders.

/** A random item, from the browser's (or Node's) cryptographic random numbers. */
const pick = <T>(list: readonly T[]): T => list[globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % list.length];
const join = (a: string, b: string) => `${a}${b}`.replace(/(\w)\1\1/g, '$1$1'); // no triple letters

// ---------------------------------------------------------------- places, by style

const PLACES = {
  // English: "Ravenford", "Greymoor Ridge", "Miller's Farm".
  english: () => {
    const first = pick(['Raven', 'Black', 'Red', 'Grey', 'White', 'Iron', 'Stone', 'Oak', 'Ash', 'Elm', 'Thorn', 'Wolf', 'Hawk',
      'Crow', 'Fox', 'Kings', 'Queens', 'Fallow', 'Hollow', 'High', 'Long', 'Broad', 'Cold', 'Silver', 'Copper', 'Willow',
      'Hazel', 'Bramble', 'Heather', 'Moor', 'Old', 'Crown', 'Bell', 'Beacon']);
    const second = pick(['ford', 'bridge', 'hill', 'ridge', 'wood', 'field', 'mill', 'water', 'brook', 'gate', 'heath', 'fen',
      'vale', 'dale', 'cross', 'well', 'barrow', 'stead', 'ham', 'ton', 'by', 'wick', 'combe', 'mere', 'down']);
    const feature = pick(['Ford', 'Bridge', 'Hill', 'Ridge', 'Wood', 'Crossing', 'Heath', 'Farm', 'Mill', 'Church', 'Pass',
      'Crossroads', 'Orchard', 'Quarry', 'Heights', 'Copse', 'Causeway']);
    const owner = pick(['Raven', 'Wolf', 'Hawk', 'Kings', 'Queens', 'Bishops', 'Miller', 'Smith', 'Abbot', 'Shepherd',
      'Hunter', 'Tanner', 'Cooper', 'Fletcher', 'Mason', 'Widow', 'Piper', 'Ferryman']);
    const shape = pick([0, 0, 1, 1, 2]);
    return shape === 0 ? join(first, second) : shape === 1 ? `${join(first, second)} ${feature}`
      : `${owner}${owner.endsWith('s') ? "'" : "'s"} ${feature}`;
  },
  // French: "Beaumont", "Vauclair-le-Val", "Saint-Aubin".
  french: () => {
    const shape = pick([0, 0, 1, 2]);
    const town = join(pick(['Beau', 'Mont', 'Vau', 'Belle', 'Haute', 'Roche', 'Clair', 'Ver', 'Cham', 'Ville', 'Mar', 'Sau', 'Lan', 'Cour']),
      pick(['court', 'ville', 'mont', 'fort', 'champ', 'rive', 'val', 'bois', 'fontaine', 'lieu', 'marais', 'clair', 'pré']));
    return shape === 0 ? town
      : shape === 1 ? `${town}-${pick(['le-Val', 'la-Forêt', 'sur-Meuse', 'sur-Aisne', 'le-Château', 'les-Bois', 'en-Plaine'])}`
        : `${pick(['Saint', 'Sainte', 'Saint', 'Notre-Dame-de'])}-${pick(['Aubin', 'Rémy', 'Claire', 'Martin', 'Hilaire', 'Gervais', 'Odile', 'Laurent', 'Agnès', 'Pré'])}`;
  },
  // German: "Hohenfeld", "Altenbrück an der Saale".
  german: () => {
    const town = join(pick(['Hohen', 'Alten', 'Lichten', 'Rosen', 'Eich', 'Brand', 'Wald', 'Stein', 'Linden', 'Schwarz',
      'Grün', 'Falken', 'Kirch', 'Wolf', 'Mühl', 'Neu', 'Ober', 'Unter']),
      pick(['dorf', 'feld', 'berg', 'heim', 'stadt', 'bach', 'au', 'burg', 'hausen', 'brück', 'wald', 'stein', 'tal']));
    return pick([0, 0, 0, 1]) ? town : `${town} ${pick(['an der Saale', 'am Main', 'an der Elbe', 'am Rhein', 'an der Oder'])}`;
  },
  // Flemish and Dutch: "Hooghout", "Zandbeke".
  dutch: () => join(pick(['Hoog', 'Ooster', 'Wester', 'Zand', 'Molen', 'Kort', 'Ter', 'Wijn', 'Broek', 'Veen', 'Linde', 'Groen']),
    pick(['hout', 'gem', 'dijk', 'beke', 'veld', 'straten', 'kerke', 'hove', 'brugge', 'dam', 'loo'])),
  // Spanish: "Villanueva", "Puente de San Miguel".
  spanish: () => pick([
    () => `Villa${pick(['nueva', 'franca', 'real', 'verde', 'mayor', 'blanca', 'seca'])}`,
    () => `${pick(['Puente', 'Fuente', 'Torre', 'Cerro'])} de ${pick(['San Miguel', 'Piedra', 'los Olmos', 'la Reina', 'Santa Ana', 'Oro'])}`,
    () => pick([`San ${pick(['Cristóbal', 'Vicente', 'Esteban', 'Lorenzo'])}`, `Santa ${pick(['Lucía', 'Marta', 'Clara', 'Inés'])}`]),
  ])(),
  // Italian: "Monte Castello", "Castelverde".
  italian: () => pick([
    () => `${pick(['Monte', 'Colle', 'Ponte', 'Borgo'])} ${pick(['Castello', 'Rosso', 'Alto', 'Nero', 'San Pietro', 'Verde'])}`,
    () => join(pick(['Castel', 'Villa', 'Monte', 'Rocca', 'Valle']), pick(['verde', 'franco', 'nuovo', 'bianco', 'rosa', 'lunga'])),
  ])(),
  // Russian: "Krasnovka", "Belaya Gorka".
  russian: () => pick([
    () => join(pick(['Krasno', 'Belo', 'Novo', 'Staro', 'Zeleno', 'Bystro', 'Sosno', 'Kamen', 'Berezo', 'Ozer', 'Gorod']),
      pick(['vka', 'ino', 'grad', 'sk', 'yevo', 'polye', 'dar', 'nik', 'ovo'])),
    () => `${pick(['Belaya', 'Krasnaya', 'Staraya', 'Zelenaya', 'Vysokaya'])} ${pick(['Gorka', 'Roshcha', 'Polyana', 'Reka'])}`,
  ])(),
};

// ---------------------------------------------------------------- battle names, by era

const BATTLE = {
  napoleonic: () => {
    const place = pick([PLACES.french, PLACES.french, PLACES.german, PLACES.german, PLACES.dutch, PLACES.spanish, PLACES.english, PLACES.italian])();
    return `${pick(['Battle of', 'Battle of', 'Battle of', 'Combat of', 'Affair at', 'Siege of', 'Storming of', 'Stand at',
      'Clash at', 'Retreat from', 'Action at', 'Defence of'])} ${place}`;
  },
  ww2: () => pick([
    () => `${pick(['Battle for', 'Battle of', 'Assault on', 'Defence of', 'Breakout at', 'Fight for', 'Crossing at',
      'Counterattack at', 'Holding', 'Push on', 'Stand at'])} ${pick([PLACES.french, PLACES.german, PLACES.dutch, PLACES.italian, PLACES.russian, PLACES.russian, PLACES.english])()}`,
    () => `${pick(['Assault on', 'Battle for', 'Holding', 'Defence of'])} ${pick(['Hill', 'Point', 'Height'])} ${100 + (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 300)}`,
    () => `Operation ${pick(['Nightjar', 'Copperhead', 'Hammerfall', 'Bluebell', 'Iron Gate', 'Wildfire', 'Overcast', 'Kestrel',
      'Longbow', 'Thunderclap', 'Juniper', 'Riptide', 'Granite', 'Lodestar', 'Firebrand', 'Blackthorn', 'Sabre', 'Windmill'])}`,
  ])(),
};

/** A random battle name to suit the era, e.g. "Combat of Beaumont-le-Val" or "Assault on Hill 213". */
export function randomBattleName(era = 'napoleonic'): string {
  return (era === 'ww2' ? BATTLE.ww2 : BATTLE.napoleonic)();
}

// ---------------------------------------------------------------- commanders, by era

const COMMANDERS = {
  napoleonic: {
    ranks: ['Marshal', 'General', 'General', 'Colonel', 'Colonel', 'Major', 'Major', 'Captain', 'Brigadier'],
    surnames: [
      'Beaumont', 'Duval', 'Marchand', 'Lefèvre', 'Girard', 'Rousseau', 'Moreau', 'Fontaine', 'Lacoste', 'Picard', 'Renard', 'Delorme',
      'Ashby', 'Hartley', 'Pembroke', 'Whitmore', 'Carrington', 'Thornton', 'Ellison', 'Langley', 'Fenwick', 'Aldridge',
      'von Lindt', 'von Hagen', 'Brandt', 'Falkenrath', 'Hollweg', 'Steiner', 'Kessler', 'von Auer', 'Lindqvist', 'Gruber',
    ],
  },
  ww2: {
    ranks: ['General', 'Colonel', 'Colonel', 'Major', 'Major', 'Captain', 'Captain', 'Lieutenant', 'Sergeant'],
    surnames: [
      'Walker', 'Hayes', 'Brennan', 'Kowalski', 'Delgado', 'Fletcher', 'Morrison', 'Sullivan', 'Novak', 'Reyes', 'Doyle',
      'Hughes', 'Pemberton', 'Ashworth', 'Collins', 'Barrett', 'Hartmann', 'Becker', 'Krüger', 'Hoffmann', 'Weiss', 'Lange',
      'Vogel', 'Sokolov', 'Volkov', 'Petrov', 'Orlov', 'Belov', 'Morozov', 'Kuznetsov', 'Lebedev',
    ],
  },
};

/** A random commander's name to suit the era, e.g. "Colonel Beaumont" or "Captain Kowalski", not one of `taken`. */
export function randomPlayerName(era = 'napoleonic', taken: string[] = []): string {
  const c = era === 'ww2' ? COMMANDERS.ww2 : COMMANDERS.napoleonic;
  const surnames = (taken: string[]) => c.surnames.filter((s) => !taken.some((t) => t.endsWith(` ${s}`)));
  const free = surnames(taken);
  return `${pick(c.ranks)} ${pick(free.length ? free : c.surnames)}`;
}
