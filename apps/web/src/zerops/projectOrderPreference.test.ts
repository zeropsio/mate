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
  PROJECT_ORDER_STORAGE_KEY,
  ProjectOrderSchema,
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

  it.each([{ order: "newest" }, { order: "name" }] as const)("round-trips $order", ({ order }) => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ProjectOrderSchema);
    expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectOrderSchema)).toBe(order);
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
