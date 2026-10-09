import { describe, expect, it } from "vite-plus/test";

import { makeStaleChunkRecovery, STALE_CHUNK_RELOAD_GUARD_MS } from "./staleChunk";

/** A page whose session storage and reloads the test reads. */
function page(options: { readonly storage?: "available" | "blocked"; readonly at?: number } = {}) {
  const stored = new Map<string, string>();
  let now = options.at ?? 1_000_000;
  const state = { reloads: 0 };
  const storage =
    options.storage === "blocked"
      ? {
          getItem: () => {
            throw new Error("SecurityError");
          },
          setItem: () => {
            throw new Error("SecurityError");
          },
        }
      : {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => void stored.set(key, value),
        };
  /** The same tab after a reload: its storage stays, the page's own memory is new. */
  const load = () =>
    makeStaleChunkRecovery({
      storage: () => storage,
      now: () => now,
      reload: () => {
        state.reloads += 1;
      },
    });
  return {
    state,
    load,
    later: (ms: number) => {
      now += ms;
    },
  };
}

const staleChunkErrors = [
  [
    "Chrome",
    new TypeError(
      "Failed to fetch dynamically imported module: https://mate.zerops.io/assets/McpPanel-DAa7hO9r.js",
    ),
  ],
  [
    "Firefox",
    new TypeError(
      "error loading dynamically imported module: https://mate.zerops.io/assets/McpPanel-DAa7hO9r.js",
    ),
  ],
  ["Safari", new TypeError("Importing a module script failed.")],
  [
    "a chunk served as the page",
    new TypeError(
      "'text/html' is not a valid JavaScript MIME type. https://mate.zerops.io/assets/McpPanel-DAa7hO9r.js",
    ),
  ],
  [
    "a stylesheet the new build removed",
    new Error("Unable to preload CSS for /assets/McpPanel-Bx1.css"),
  ],
] as const;

describe("a lazy panel whose code a new build replaced", () => {
  it.each(staleChunkErrors)(
    "reloads the app once to the new build (%s), never showing the error screen",
    (_, error) => {
      const tab = page();
      const recovery = tab.load();
      expect(recovery.recover(error)).toBe(true);
      expect(tab.state.reloads).toBe(1);
      // The same error met again before the reload lands (React renders twice) asks no second one.
      expect(recovery.recover(error)).toBe(true);
      expect(tab.state.reloads).toBe(1);
    },
  );

  it("shows the error screen when the chunk still fails right after that reload, never a loop", () => {
    const tab = page();
    const [, error] = staleChunkErrors[0];
    tab.load().recover(error);
    tab.later(2_000);
    expect(tab.load().recover(error)).toBe(false);
    expect(tab.state.reloads).toBe(1);
  });

  it("reloads again for a later deploy, long after the last reload", () => {
    const tab = page();
    const [, error] = staleChunkErrors[0];
    tab.load().recover(error);
    tab.later(STALE_CHUNK_RELOAD_GUARD_MS + 1);
    expect(tab.load().recover(error)).toBe(true);
    expect(tab.state.reloads).toBe(2);
  });

  it("shows the error screen without reloading where the tab cannot remember a reload", () => {
    const tab = page({ storage: "blocked" });
    expect(tab.load().recover(staleChunkErrors[0][1])).toBe(false);
    expect(tab.state.reloads).toBe(0);
  });
});

describe("any other error", () => {
  it.each([
    ["a render error", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["a failed request", new Error("Failed to fetch")],
    ["a thrown string", "boom"],
    ["nothing", undefined],
  ] as const)("still shows the error screen (%s)", (_, error) => {
    const tab = page();
    expect(tab.load().recover(error)).toBe(false);
    expect(tab.state.reloads).toBe(0);
  });
});
