/**
 * A load's two fills. The first frame is the whole frame: the menu's column and the page's, each
 * part in its place. What is read afterwards comes in as two fills, each whole and once: the
 * menu's (its rows, the top row's count, the foot's balance) and the page's (a conversation with
 * its header's words and its composer's line; the overview's cards).
 *
 * Two fills that become ready close together start in one frame. Neither is slowed for it: the
 * page holds only as long as its own fade used to be delayed, and the menu holds only for a page
 * that has said it is about to stand (`soon`: its rows are being placed).
 */
import { MOTION } from "@t3tools/shared/brand";
import { useLayoutEffect, useState, useSyncExternalStore } from "react";

export type FillRegion = "menu" | "page";

/** The menu's patience for a page about to stand: one fade's length. */
export const MENU_WAITS_FOR_PAGE_MS = 150;

/**
 * How long the menu's rows, listed by Zerops, hold for HQ's directory while HQ is slow but
 * answering (HQ down settles at once): without it they stand ungrouped under the names this
 * browser remembers, and HQ's answer then renames and regroups every one of them, which is the
 * menu painting a state it takes back. Once the directory is read the rows are final, and only
 * what waits on the viewer is still out: that keeps its shorter patience (`Sidebar`).
 */
export const MENU_HOLDS_FOR_HQ_MS = 1_500;

/**
 * How long a ready region holds for a fact of its own still being read (`useFillFact`): as long
 * as the page holds for the menu anyway, so waiting for it makes no fill later than it was.
 */
export const FILL_WAITS_FOR_FACT_MS = 32;

/** One surface mounted for a region: what it last said of itself. */
interface Holder {
  ready: boolean;
  soon: boolean;
  patience: number;
}

interface Region {
  /**
   * The surfaces mounted for the region now, each with its own word. A region is ready when every
   * one of them is: two surfaces that both draw the page can never overwrite one another's
   * readiness (the route's page is meant to be the only one; this holds if it ever is not).
   */
  holders: Map<object, Holder>;
  ready: boolean;
  /** When it became ready: its holds are counted from then. */
  readyAt: number;
  /** Its page is being placed: ready within a fade's length. */
  soon: boolean;
  /** Its first fill of this document has begun: nothing waits for it, or it for anything, again. */
  filled: boolean;
  /** How long it holds, ready, for a menu still being read. */
  patience: number;
  /** Facts of its own still being read, each with a seat held for it. */
  facts: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const make = (): Region => ({
  holders: new Map(),
  ready: false,
  readyAt: 0,
  soon: false,
  filled: false,
  patience: 0,
  facts: 0,
  timer: undefined,
});
const regions: Record<FillRegion, Region> = { menu: make(), page: make() };
const listeners = new Set<() => void>();
const otherOf = (region: FillRegion): FillRegion => (region === "menu" ? "page" : "menu");

/** Every reader asks again whether it stands; only one whose answer changed draws again. */
function emit(): void {
  for (const listener of listeners) listener();
}

/** How long `region`, ready now, holds for the other: 0 where nothing is worth waiting for. */
function waitOf(region: FillRegion, patience = regions[region].patience): number {
  const other = regions[otherOf(region)];
  if (other.holders.size === 0 || other.filled || other.ready) return 0;
  return region === "menu" ? (other.soon ? MENU_WAITS_FOR_PAGE_MS : 0) : patience;
}

/** How long `region` holds from the moment it is ready: for the other, and for its own facts. */
function holdOf(region: FillRegion, patience = regions[region].patience): number {
  return Math.max(waitOf(region, patience), regions[region].facts > 0 ? FILL_WAITS_FOR_FACT_MS : 0);
}

function fill(region: FillRegion): void {
  const self = regions[region];
  self.filled = true;
  if (self.timer !== undefined) clearTimeout(self.timer);
  self.timer = undefined;
}

function settle(region: FillRegion): void {
  const self = regions[region];
  if (!self.ready || self.filled) return;
  if (self.timer !== undefined) clearTimeout(self.timer);
  self.timer = undefined;
  const left = self.readyAt + holdOf(region) - performance.now();
  if (left <= 0) {
    fill(region);
    // The other was holding for this one: both start in this frame.
    const other = regions[otherOf(region)];
    if (other.holders.size > 0 && other.ready && !other.filled && other.facts === 0)
      fill(otherOf(region));
    emit();
    return;
  }
  self.timer = setTimeout(() => {
    self.timer = undefined;
    settle(region);
  }, left);
}

/** The region's word from its holders': ready when each is, soon when one says so. */
function reckon(region: FillRegion): void {
  const self = regions[region];
  const holders = [...self.holders.values()];
  const ready = holders.length > 0 && holders.every((each) => each.ready);
  const soon = !ready && holders.some((each) => each.soon);
  const changed = self.ready !== ready || self.soon !== soon;
  if (ready && !self.ready) self.readyAt = performance.now();
  self.ready = ready;
  self.soon = soon;
  self.patience = Math.max(0, ...holders.map((each) => each.patience));
  if (!ready && self.timer !== undefined) {
    clearTimeout(self.timer);
    self.timer = undefined;
  }
  settle(region);
  if (changed || holders.length === 0) emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const STANDS = () => true;

/**
 * Whether `region`'s content, `ready` now, stands: at once where the other region has stood, is
 * not being read, or is ready too; else once its short hold for the other ends. A surface that is
 * no region's (`null`: a conversation kept out of sight) stands as soon as it is ready.
 */
export function useLoadFill(
  region: FillRegion | null,
  ready: boolean,
  options?: { readonly soon?: boolean; readonly patience?: number },
): boolean {
  const soon = options?.soon === true;
  const patience = options?.patience ?? 0;
  // Read from the regions as they are at each ask, never from what a render remembered: once the
  // load's first fills have begun this is always true, and a later arrival costs no second pass.
  const free = useSyncExternalStore(
    subscribe,
    region === null ? STANDS : () => regions[region].filled || holdOf(region, patience) === 0,
    // Drawn with no page to load (a server's markup, a test's): nothing holds.
    STANDS,
  );
  const [holder] = useState<Holder>(() => ({ ready: false, soon: false, patience: 0 }));
  useLayoutEffect(() => {
    if (region === null) return;
    regions[region].holders.set(holder, holder);
    return () => {
      regions[region].holders.delete(holder);
      reckon(region);
    };
  }, [holder, region]);
  useLayoutEffect(() => {
    if (region === null) return;
    holder.ready = ready;
    holder.soon = soon && !ready;
    holder.patience = patience;
    reckon(region);
  }, [holder, region, ready, soon, patience]);
  return ready && free;
}

/**
 * A fact of `region`'s read apart from its content (who writes in a conversation, read after its
 * messages): while it is not `known` the region, ready, holds a moment for it, so it comes in with
 * the fill; later than that the fill goes without it, and it fades into the seat held for it.
 */
export function useFillFact(region: FillRegion, known: boolean): void {
  useLayoutEffect(() => {
    if (known) return;
    const self = regions[region];
    self.facts += 1;
    emit();
    return () => {
      self.facts -= 1;
      settle(region);
      emit();
    };
  }, [region, known]);
}

/** Whether `region`'s first fill has begun: what belongs to it but is read apart joins it. */
export function useLoadFilled(region: FillRegion): boolean {
  return useSyncExternalStore(subscribe, () => regions[region].filled, STANDS);
}

/**
 * Whether `region`'s first fill is still to come: something is mounted for it and has not stood
 * yet. What a page shows of the other region's facts (the header's Review, which the menu draws)
 * waits for exactly that long, and for nothing where no such region is on screen.
 */
export function useLoadFillComes(region: FillRegion): boolean {
  return useSyncExternalStore(
    subscribe,
    () => regions[region].holders.size > 0 && !regions[region].filled,
    () => false,
  );
}

/**
 * A fill's one motion: what came into a seat held for it fades in where it stands, once. Nothing
 * moves; under reduced motion it is simply there. Also a ref callback, for a part that only ever
 * mounts as an arrival.
 */
export function fadeFillIn(node: Element | null): void {
  fade(node, 0);
}

/**
 * The same motion for what takes a stand-in's place (the menu's rows over its loading rows, a
 * card over its grey one): it starts at about the stand-in's own weight, so the frame between the
 * two is never an empty one.
 */
export function fadeFillOver(node: Element | null): void {
  fade(node, STAND_IN_WEIGHT);
}

const STAND_IN_WEIGHT = 0.2;

function fade(node: Element | null, from: number): void {
  if (node === null || typeof node.animate !== "function") return;
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  node.animate([{ opacity: from }, { opacity: 1 }], {
    duration: MOTION.duration.quick,
    easing: MOTION.easing.out,
  });
}

/** A new document's fills, for a test that loads twice. */
export function resetLoadFills(): void {
  for (const region of Object.values(regions)) {
    if (region.timer !== undefined) clearTimeout(region.timer);
    Object.assign(region, make());
  }
  emit();
}
