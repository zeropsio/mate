import * as Schema from "effect/Schema";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import {
  DEFAULT_PROJECT_ORDER,
  movedBefore,
  movedInOrder,
  PROJECT_CUSTOM_ORDER_STORAGE_KEY,
  PROJECT_ORDER_STORAGE_KEY,
  ProjectCustomOrderSchema,
  ProjectOrderSchema,
  projectOrderOptionsOf,
} from "./projectOrderPreference";

describe("project order preference — the pure read/parse", () => {
  beforeEach(() => {
    removeLocalStorageItem(PROJECT_ORDER_STORAGE_KEY);
  });

  it("reads nothing when the viewer never chose — the hook then falls back to its default", () => {
    expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema)).toBeNull();
  });

  it("puts the newest first unless the viewer chose otherwise", () => {
    expect(DEFAULT_PROJECT_ORDER).toBe("newest");
  });

  it.each([{ order: "newest" }, { order: "name" }, { order: "custom" }] as const)(
    "round-trips $order",
    ({ order }) => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ProjectOrderSchema);
      expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema)).toBe(order);
    },
  );

  it("round-trips the viewer's own arrangement", () => {
    setLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, ["b", "a"], ProjectCustomOrderSchema);
    expect(getLocalStorageItem(PROJECT_CUSTOM_ORDER_STORAGE_KEY, ProjectCustomOrderSchema)).toEqual(
      ["b", "a"],
    );
  });

  // `next-step` is the order removed on 2026-09-24; `oldest` was never one.
  it.each([{ stored: "next-step" }, { stored: "oldest" }])(
    "rejects $stored, outside the known orders, rather than silently accepting it",
    ({ stored }) => {
      // Written through the generic string codec, bypassing this module's own
      // schema — standing in for a value from an older or foreign write.
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, stored, Schema.String);
      expect(() => getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema)).toThrow();
    },
  );
});

describe("useProjectOrderPreference — a browser that stored the removed order", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("reads the default for a stored next-step, and takes a new choice over it", async () => {
    const store = new Map<string, string>();
    const events = new EventTarget();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    });
    const { openAccountLifetime, accountStorageKey } = await import("./accountLifetime");
    openAccountLifetime("order-test");
    store.set(accountStorageKey(PROJECT_ORDER_STORAGE_KEY)!, JSON.stringify("next-step"));
    const preference = await import("./projectOrderPreference");

    let seen: ReturnType<typeof preference.useProjectOrderPreference> | undefined;
    function Probe() {
      seen = preference.useProjectOrderPreference();
      return null;
    }
    act(() => {
      create(h(Probe));
    });
    expect(seen?.[0]).toBe("newest");

    act(() => {
      seen?.[1]("name");
    });
    expect(seen?.[0]).toBe("name");
  });
});

describe("projectOrderOptionsOf — what a tree is built in", () => {
  it.each([
    { order: "newest", custom: ["a"], expected: { order: "newest" } },
    { order: "name", custom: ["a"], expected: { order: "name" } },
    { order: "custom", custom: ["b", "a"], expected: { order: "custom", customOrder: ["b", "a"] } },
    { order: "custom", custom: [], expected: { order: "custom", customOrder: [] } },
  ] as const)(
    "reads $order with the arrangement only where it counts",
    ({ order, custom, expected }) => {
      expect(projectOrderOptionsOf(order, custom)).toEqual(expected);
    },
  );
});

describe("movedInOrder — one project taken to a new place", () => {
  it.each([
    { case: "up one", order: ["a", "b", "c"], id: "b", to: 0, expected: ["b", "a", "c"] },
    { case: "down one", order: ["a", "b", "c"], id: "b", to: 2, expected: ["a", "c", "b"] },
    { case: "to the top", order: ["a", "b", "c"], id: "c", to: 0, expected: ["c", "a", "b"] },
    { case: "to the end", order: ["a", "b", "c"], id: "a", to: 2, expected: ["b", "c", "a"] },
    {
      case: "where it already is",
      order: ["a", "b", "c"],
      id: "b",
      to: 1,
      expected: ["a", "b", "c"],
    },
    {
      case: "past the end, clamped",
      order: ["a", "b", "c"],
      id: "a",
      to: 9,
      expected: ["b", "c", "a"],
    },
    {
      case: "before the start, clamped",
      order: ["a", "b", "c"],
      id: "c",
      to: -3,
      expected: ["c", "a", "b"],
    },
    {
      case: "an id the order does not hold",
      order: ["a", "b"],
      id: "x",
      to: 0,
      expected: ["a", "b"],
    },
  ])("moves it $case", ({ order, id, to, expected }) => {
    expect(movedInOrder(order, id, to)).toEqual(expected);
  });
});

describe("movedBefore — one project put in front of another, or last", () => {
  // `h` is drawn nowhere (a project with no Mate): a move among the drawn
  // ones must never lose it or leap it for no reason.
  it.each([
    { case: "up past its drawn neighbour", before: "a", id: "b", expected: ["b", "a", "h", "c"] },
    { case: "down past its drawn neighbour", before: "c", id: "a", expected: ["h", "b", "a", "c"] },
    { case: "to the end", before: null, id: "a", expected: ["h", "b", "c", "a"] },
    { case: "in front of itself — nowhere", before: "b", id: "b", expected: ["a", "h", "b", "c"] },
    {
      case: "in front of one the order lacks — last",
      before: "x",
      id: "a",
      expected: ["h", "b", "c", "a"],
    },
  ])("puts it $case", ({ before, id, expected }) => {
    expect(movedBefore(["a", "h", "b", "c"], id, before)).toEqual(expected);
  });
});

describe("automatic sections keep account preferences", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("Custom ordering survives regrouping, and another account cannot inherit it.", async () => {
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const lifetime = await import("./accountLifetime");
    const prefs = await import("./projectOrderPreference");
    const saved = await import("../hooks/useLocalStorage");
    const { menuProjectOpening } = await import("@t3tools/client-runtime/data");
    lifetime.openAccountLifetime("first");
    saved.setLocalStorageItem(prefs.PROJECT_ORDER_STORAGE_KEY, "custom", prefs.ProjectOrderSchema);
    saved.setLocalStorageItem(
      prefs.PROJECT_CUSTOM_ORDER_STORAGE_KEY,
      ["b", "a", "c"],
      prefs.ProjectCustomOrderSchema,
    );
    const projects = ["b", "a", "c"].map((id) => ({
      id,
      mates: [{ projectId: id, face: "idle" }],
    }));
    const input = {
      ready: true,
      scope: "first/org",
      open: true,
      order: "custom",
      projects,
      now: 0,
      openProjectId: "a",
    };
    const first = menuProjectOpening(null, input);
    expect([...first.active, ...first.other]).toEqual(["a", "b", "c"]);
    const second = menuProjectOpening({ ...first, open: false }, { ...input, openProjectId: "c" });
    expect([...second.active, ...second.other]).toEqual(["c", "b", "a"]);
    expect(
      saved.getLocalStorageItem(
        prefs.PROJECT_CUSTOM_ORDER_STORAGE_KEY,
        prefs.ProjectCustomOrderSchema,
      ),
    ).toEqual(["b", "a", "c"]);
    prefs.rememberProjectsOnScreen(["c", "b", "a"]);
    lifetime.openAccountLifetime("second");
    expect(
      saved.getLocalStorageItem(
        prefs.PROJECT_CUSTOM_ORDER_STORAGE_KEY,
        prefs.ProjectCustomOrderSchema,
      ),
    ).toBeNull();
    expect(
      saved.getLocalStorageItem(prefs.PROJECT_ORDER_STORAGE_KEY, prefs.ProjectOrderSchema),
    ).toBeNull();
    expect(
      prefs.readProjectsOnScreen(),
      "ASSERTION: closing an account clears its last menu order",
    ).toEqual([]);
    lifetime.openAccountLifetime("first");
    expect(
      saved.getLocalStorageItem(
        prefs.PROJECT_CUSTOM_ORDER_STORAGE_KEY,
        prefs.ProjectCustomOrderSchema,
      ),
    ).toEqual(["b", "a", "c"]);
    await lifetime.closeAccountLifetime();
  });
});
