/**
 * How many project cards this browser's overview drew last: what its stand-in draws while the
 * overview is read, so a one-project account is not promised three cards it takes back (the
 * onboarding run's first loads, for every role). Remembered beside the Mates' names for the
 * first frame (`mateIdentityMemory`); without it the stand-in draws one card.
 */
import { readOverviewCardsMemory, writeOverviewCardsMemory } from "./mateIdentityMemory";

/** As many as a first screen holds at the reference width: the least the stand-in may draw up to. */
const MOST_CARDS = 3;
/** A card's column and the gap to the next (`.ov-row`). */
const CARD_PITCH_PX = 396;

/**
 * The stand-in's cards from what was remembered: one when unknown, and none past a first screen —
 * `fits` cards where the window holds more than the reference width's three, so the cards read a
 * moment later stand in the places it drew and none is added beside them.
 */
export function standInCards(remembered: string | null, fits = MOST_CARDS): number {
  const count = remembered === null ? Number.NaN : Number.parseInt(remembered, 10);
  if (!Number.isFinite(count) || count < 0) return 1;
  return Math.min(count, Math.max(MOST_CARDS, fits));
}

export function rememberedOverviewCards(): number {
  const fits =
    typeof window === "undefined" ? MOST_CARDS : Math.ceil(window.innerWidth / CARD_PITCH_PX);
  return standInCards(readOverviewCardsMemory(), fits);
}

export function rememberOverviewCards(count: number): void {
  writeOverviewCardsMemory(count);
}
