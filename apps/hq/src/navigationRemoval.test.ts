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
it.each(["app", "project", "press"])("unknown %s keys cannot probe membership", (kind) => {
  const hidden = {
    ...source,
    appIds: new Set(["hidden"]),
    projectIds: new Set(["hidden"]),
    pressProjectIds: new Set(["hidden"]),
  };
  expect(navigationRemoval(hidden, "user", `${kind}:hidden`)?.reason).toEqual(
    navigationRemoval(hidden, "user", `${kind}:missing`)?.reason,
  );
});
it("distinguishes proven deletion from access loss", () => {
  expect(navigationRemoval(source, "user", "app:gone", new Set(["app:gone"]))).toEqual({
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
