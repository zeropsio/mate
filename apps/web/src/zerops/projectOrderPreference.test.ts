import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import {
  DEFAULT_PROJECT_ORDER,
  PROJECT_ORDER_STORAGE_KEY,
  ProjectsPageOrderSchema,
  projectTreeOrder,
} from "./projectOrderPreference";

describe("project order preference — the pure read/parse", () => {
  beforeEach(() => {
    removeLocalStorageItem(PROJECT_ORDER_STORAGE_KEY);
  });

  it("reads nothing when the viewer never chose — the hook then falls back to its default", () => {
    expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectsPageOrderSchema)).toBeNull();
  });

  it("puts the next step first unless the viewer chose otherwise", () => {
    expect(DEFAULT_PROJECT_ORDER).toBe("next-step");
  });

  it.each([{ order: "next-step" }, { order: "newest" }, { order: "name" }] as const)(
    "round-trips $order",
    ({ order }) => {
      setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ProjectsPageOrderSchema);
      expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectsPageOrderSchema)).toBe(order);
    },
  );

  it("rejects a value outside the known orders, rather than silently accepting it", () => {
    // Written through the generic string codec, bypassing this module's own
    // schema — standing in for a value from an older or foreign write.
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "oldest", Schema.String);
    expect(() => getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ProjectsPageOrderSchema)).toThrow();
  });
});

describe("projectTreeOrder", () => {
  // The group tree — the sidebar's, a move dialog's choices — has no next
  // step to sort by: it reads the next step's own tie-break, newest first.
  it.each([
    ["next-step", "newest"],
    ["newest", "newest"],
    ["name", "name"],
  ] as const)("orders the tree for %s by %s", (order, tree) => {
    expect(projectTreeOrder(order)).toBe(tree);
  });
});
