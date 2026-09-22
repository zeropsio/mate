import * as Schema from "effect/Schema";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import { PROJECT_ORDER_STORAGE_KEY, ZeropsProjectOrderSchema } from "./projectOrderPreference";

describe("project order preference — the pure read/parse", () => {
  beforeEach(() => {
    removeLocalStorageItem(PROJECT_ORDER_STORAGE_KEY);
  });

  it("reads nothing when the viewer never chose — the hook then falls back to its default", () => {
    expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ZeropsProjectOrderSchema)).toBeNull();
  });

  it.each([{ order: "newest" }, { order: "name" }] as const)("round-trips $order", ({ order }) => {
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, order, ZeropsProjectOrderSchema);
    expect(getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ZeropsProjectOrderSchema)).toBe(order);
  });

  it("rejects a value outside the two known orders, rather than silently accepting it", () => {
    // Written through the generic string codec, bypassing this module's own
    // schema — standing in for a value from an older or foreign write.
    setLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, "oldest", Schema.String);
    expect(() =>
      getLocalStorageItem(PROJECT_ORDER_STORAGE_KEY, ZeropsProjectOrderSchema),
    ).toThrow();
  });
});
