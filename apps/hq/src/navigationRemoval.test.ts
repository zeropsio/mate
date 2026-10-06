import { expect, it } from "@effect/vitest";
import { navigationRemoval } from "./navigationRemoval.ts";
const source = {
  appIds: new Set(["a"]),
  projectIds: new Set(["p"]),
  forPerson: () => ({
    apps: [{ id: "a", projects: [{ projectId: "p" }] }],
    ungrouped: [],
    presses: {},
  }),
};
it("omitted visible entities may be corrupt and are never removed", () => {
  expect(navigationRemoval(source, "user", "app:a")).toBeUndefined();
  expect(navigationRemoval(source, "user", "project:p")).toBeUndefined();
});
it("distinguishes deletion from access loss even across a Core restart", () => {
  expect(navigationRemoval(source, "user", "app:gone")).toEqual({
    key: "app:gone",
    reason: "deleted",
  });
  expect(
    navigationRemoval(
      { ...source, forPerson: () => ({ apps: [], ungrouped: [], presses: {} }) },
      "user",
      "project:p",
    ),
  ).toEqual({ key: "project:p", reason: "no-access" });
});
