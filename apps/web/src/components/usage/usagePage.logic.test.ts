import { describe, expect, it } from "vite-plus/test";
import { usagePageState } from "./usagePage.logic";

const complete = {
  baseline: "resolved",
  owners: "resolved",
  scope: {},
  projects: new Map([
    ["a", "Shop"],
    ["b", "Shop"],
  ]),
  scopeKnown: true,
  listed: true,
  answered: 0,
  records: 0,
  pending: 0,
  unavailable: 0,
} as const;

describe("Usage claims require scope and source evidence", () => {
  it.each([
    ["cold discovery", { baseline: "resolving", listed: false }, "reading"],
    ["partial answers", { answered: 1, records: 1, pending: 1 }, "partial"],
    ["settled zero", {}, "ready"],
    ["invalid scope", { scope: { project: "deleted" }, scopeKnown: false }, "invalid"],
    ["refused baseline", { baseline: "unavailable" }, "unavailable"],
    ["warm reconnect with retained answer", { answered: 1, records: 1, pending: 1 }, "partial"],
    ["duplicate old names", { scope: { legacyProject: "Shop" } }, "invalid"],
    [
      "stable ID after rename",
      { scope: { project: "a" }, projects: new Map([["a", "Renamed"]]) },
      "ready",
    ],
    ["empty answer with a pending neighbor", { answered: 1, pending: 1 }, "reading"],
    ["empty answer with a terminal failure", { answered: 1, unavailable: 1 }, "unavailable"],
    ["all reads unavailable", { unavailable: 1 }, "unavailable"],
    ["owner unread", { owners: "resolving", scope: { person: "u" } }, "reading"],
  ] as const)("%s", (_, change, kind) => {
    expect(usagePageState({ ...complete, ...change }).kind).toBe(kind);
  });
  it("explains ambiguous bookmarks", () => {
    expect(usagePageState({ ...complete, scope: { legacyProject: "Shop" } }).message).toContain(
      "ambiguous",
    );
  });
});
