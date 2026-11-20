import { expect, it } from "vite-plus/test";
import { makeStaleChunkRecovery, STALE_CHUNK_RELOAD_GUARD_MS } from "./staleChunk.ts";

/** One tab's session storage, which outlives its reloads. */
function sessionStorageOfTab() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

/** A page load of that tab: its clock, its reloads and a Mate's setup it may be running. */
function pageLoad(storage: ReturnType<typeof sessionStorageOfTab>, at: number, setupRuns: boolean) {
  const page = { reloads: 0, setupRuns, listeners: new Set<() => void>() };
  const recovery = makeStaleChunkRecovery({
    storage: () => storage,
    now: () => at,
    reload: () => {
      page.reloads += 1;
    },
    busy: {
      read: () => page.setupRuns,
      subscribe: (listener) => {
        page.listeners.add(listener);
        return () => page.listeners.delete(listener);
      },
    },
  });
  const setupEnds = () => {
    page.setupRuns = false;
    for (const listener of [...page.listeners]) listener();
  };
  return { page, recovery, setupEnds };
}

const staleChunk = new TypeError(
  "Failed to fetch dynamically imported module: https://mate.example/assets/Settings-3f2a.js",
);

// witness: apps/web/src/lib/staleChunk.ts | now - last < STALE_CHUNK_RELOAD_GUARD_MS → now - last > STALE_CHUNK_RELOAD_GUARD_MS
it("WL+4: A lazy panel whose code a newer build replaced reloads the app once, after a Mate's setup running in this tab, and shows the error screen instead of reloading again when the chunk still fails right after", () => {
  const storage = sessionStorageOfTab();
  const deployed = Date.parse("2026-11-20T10:00:00Z");

  const first = pageLoad(storage, deployed, true);
  expect(first.recovery.recover(staleChunk)).toBe(true);
  expect(first.recovery.recover(staleChunk)).toBe(true);
  expect(first.page.reloads).toBe(0);
  first.setupEnds();
  expect(first.page.reloads).toBe(1);

  const reloaded = pageLoad(storage, deployed + 2_000, false);
  expect(reloaded.recovery.recover(staleChunk)).toBe(false);
  expect(reloaded.page.reloads).toBe(0);

  const later = pageLoad(storage, deployed + STALE_CHUNK_RELOAD_GUARD_MS + 1_000, false);
  expect(later.recovery.recover(staleChunk)).toBe(true);
  expect(later.page.reloads).toBe(1);
});
