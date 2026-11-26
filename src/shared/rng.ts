// Small seeded PRNG (mulberry32). Storing the seed with each turn makes every
// resolution reproducible for replays, dispute checks and bug reports.
export interface Rng {
  next(): number;
  int(n: number): number;
  d6(): number;
  pick<T>(arr: T[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    d6: () => 1 + Math.floor(next() * 6),
    pick: <T>(arr: T[]): T => arr[Math.floor(next() * arr.length)],
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
