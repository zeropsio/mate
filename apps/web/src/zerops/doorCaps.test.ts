import { describe, expect, it } from "vite-plus/test";

import type { KeptSessionStorage } from "@t3tools/client-runtime/zerops/keptSessions";

import { DOOR_CAPS_KEY, makeDoorCaps } from "./doorCaps";

const NOW = 1_800_000_000_000;

function memoryStorage(initial: Record<string, string> = {}): KeptSessionStorage & {
  readonly items: Map<string, string>;
} {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

// E2E 2026-10-03: a Mate whose door kept failing cost five exchanges in every load's first minute.
describe("a Mate's backoff cap, kept across loads", () => {
  it("reads back the cap another load kept, until it ends", () => {
    const storage = memoryStorage();
    makeDoorCaps(storage, () => NOW).remember("p:zcp", NOW + 60_000);

    const later = (now: number) => makeDoorCaps(storage, () => now).until("p:zcp");
    expect(later(NOW + 59_999)).toBe(NOW + 60_000);
    expect(later(NOW + 60_000)).toBeNull();
  });

  it("forgets a cap, and drops the ended ones whenever it writes", () => {
    const storage = memoryStorage({
      [DOOR_CAPS_KEY]: JSON.stringify({ "old:zcp": NOW - 1, "p:zcp": NOW + 1_000 }),
    });
    const caps = makeDoorCaps(storage, () => NOW);
    caps.remember("q:zcp", NOW + 2_000);
    expect(JSON.parse(storage.items.get(DOOR_CAPS_KEY)!)).toEqual({
      "p:zcp": NOW + 1_000,
      "q:zcp": NOW + 2_000,
    });

    caps.remember("p:zcp", null);
    caps.remember("q:zcp", null);
    expect(storage.items.has(DOOR_CAPS_KEY)).toBe(false);
  });

  it.each([
    { case: "text that is not its shape", storage: memoryStorage({ [DOOR_CAPS_KEY]: "[1,2]" }) },
    {
      case: "a storage that refuses",
      storage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      } satisfies KeptSessionStorage,
    },
  ])("holds no cap over $case, and never throws", ({ storage }) => {
    const caps = makeDoorCaps(storage, () => NOW);
    expect(caps.until("p:zcp")).toBeNull();
    expect(() => caps.remember("p:zcp", NOW + 1_000)).not.toThrow();
  });
});
