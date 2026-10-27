/**
 * How many project cards this browser's overview drew last: what its stand-in draws while the
 * overview is read, so a one-project account is not promised three cards it takes back (the
 * onboarding run's first loads, for every role). Remembered beside the Mates' names for the
 * first frame (`mateIdentityMemory`); without it the stand-in draws one card.
 */
import { readOverviewCardsMemory, writeOverviewCardsMemory } from "./mateIdentityMemory";

/** As many as a first screen holds at the reference width: more stand past its edge. */
const MOST_CARDS = 3;

/** The stand-in's cards from what was remembered: none past a first screen, one when unknown. */
export function standInCards(remembered: string | null): number {
  const count = remembered === null ? Number.NaN : Number.parseInt(remembered, 10);
  if (!Number.isFinite(count) || count < 0) return 1;
  return Math.min(count, MOST_CARDS);
}

export function rememberedOverviewCards(): number {
  return standInCards(readOverviewCardsMemory());
}

export function rememberOverviewCards(count: number): void {
  writeOverviewCardsMemory(count);
}
