// @effect-diagnostics globalRandom:off - fresh seeds for a local run only; the gate's seeds are fixed.
/**
 * A seeded generator: the harness's only source of choice, so a seed replays a run exactly.
 * mulberry32 — small, fast, good enough for test schedules.
 */
export interface Rng {
  readonly seed: number;
  readonly next: () => number;
  readonly int: (lo: number, hi: number) => number;
  readonly chance: (p: number) => boolean;
  readonly pick: <T>(items: ReadonlyArray<T>) => T;
  readonly weighted: <T>(entries: ReadonlyArray<readonly [T, number]>) => T;
}

export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    seed,
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, w] of entries) {
        roll -= w;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
  };
};

/** Seeds for the gate: fixed, so a red gate is a red gate on every machine. */
export const fixedSeeds = (count: number, base = 1): ReadonlyArray<number> =>
  Array.from({ length: count }, (_, i) => base + i * 7919);

/** `ENGINE_PROOF_SEED=123` replays one seed; `ENGINE_PROOF_RANDOM=n` adds n fresh ones. */
export const gateSeeds = (fixed: number): ReadonlyArray<number> => {
  const one = process.env.ENGINE_PROOF_SEED;
  if (one !== undefined) return [Number(one)];
  const extra = Number(process.env.ENGINE_PROOF_RANDOM ?? 0);
  const random = Array.from({ length: extra }, () => Math.floor(Math.random() * 2 ** 31));
  return [...fixedSeeds(fixed), ...random];
};
