import { expect, it } from "@effect/vitest";
import { pruneIdleScopes } from "./scopeRetention.ts";

it("evicts the least recently used idle entry, preserving active reads", () => {
  const entries = new Map([
    ["old-created", { lastUsed: 5, active: false }],
    ["new-created", { lastUsed: 2, active: false }],
    ["reading", { lastUsed: 1, active: true }],
  ]);
  pruneIdleScopes(entries, (entry) => !entry.active, 1);
  expect([...entries.keys()]).toEqual(["old-created", "reading"]);
});
