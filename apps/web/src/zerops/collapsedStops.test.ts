import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type * as CollapsedStopsModule from "./collapsedStops";
import type * as AccountLifetimeModule from "./accountLifetime";

/** The key a build before account scoping wrote, shared by every account in the browser. */
const UNSCOPED_KEY = "zerops.sidebar.collapsedStops";

let values: Map<string, string>;
let lifetime: typeof AccountLifetimeModule;
let stops: typeof CollapsedStopsModule;

beforeEach(async () => {
  values = new Map();
  const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  lifetime = await import("./accountLifetime");
  stops = await import("./collapsedStops");
});

afterEach(() => {
  lifetime.closeAccountLifetime();
  vi.unstubAllGlobals();
});

describe("collapsed stops, per account", () => {
  it("a UI key written by account A is not read by account B in the same browser", () => {
    lifetime.openAccountLifetime("user-a");
    stops.writeCollapsedStops(new Set(["project-a"]));

    lifetime.openAccountLifetime("user-b");
    expect(stops.readCollapsedStops()).toEqual(new Set());
    stops.writeCollapsedStops(new Set(["project-b"]));

    lifetime.openAccountLifetime("user-a");
    expect(stops.readCollapsedStops()).toEqual(new Set(["project-a"]));
    expect(values.has(UNSCOPED_KEY)).toBe(false);
  });

  it("a value under the unscoped key moves once to the account key", () => {
    values.set(UNSCOPED_KEY, JSON.stringify(["project-a"]));

    lifetime.openAccountLifetime("user-a");
    expect(stops.readCollapsedStops()).toEqual(new Set(["project-a"]));
    expect(values.has(UNSCOPED_KEY)).toBe(false);
    expect(values.get(lifetime.accountStorageKey(UNSCOPED_KEY)!)).toBe(
      JSON.stringify(["project-a"]),
    );

    lifetime.openAccountLifetime("user-b");
    expect(stops.readCollapsedStops()).toEqual(new Set());
  });

  it("an account that already has its own value keeps it and still drops the unscoped one", () => {
    lifetime.openAccountLifetime("user-a");
    stops.writeCollapsedStops(new Set(["project-a"]));
    values.set(UNSCOPED_KEY, JSON.stringify(["project-old"]));

    expect(stops.readCollapsedStops()).toEqual(new Set(["project-a"]));
    expect(values.has(UNSCOPED_KEY)).toBe(false);
  });

  it("no account reads or writes nothing", () => {
    values.set(UNSCOPED_KEY, JSON.stringify(["project-a"]));

    expect(stops.readCollapsedStops()).toEqual(new Set());
    stops.writeCollapsedStops(new Set(["project-b"]));

    expect([...values.keys()]).toEqual([UNSCOPED_KEY]);
  });
});
