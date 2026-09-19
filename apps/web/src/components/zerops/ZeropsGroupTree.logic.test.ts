import { describe, expect, it } from "vite-plus/test";

import { environmentRoleTagIsRedundant } from "./ZeropsGroupTree.logic";
describe("environmentRoleTagIsRedundant", () => {
  const cases: ReadonlyArray<[string | null, string, boolean]> = [
    // The shortened name already says the role: the pill would be the same
    // word twice on one line.
    ["stage", "stage", true],
    ["prod", "production", true],
    ["prod", "Production", true],
    ["dev", "dev", true],
    ["dev/stage", "dev/stage", true],
    // A name somebody chose says nothing about the role, so the tag does.
    ["prod", "eu-west", false],
    ["stage", "Links - stage", false],
    ["stage", "canary", false],
    // No role, nothing to repeat.
    [null, "stage", false],
  ];

  for (const [tag, name, expected] of cases) {
    it(`${expected ? "drops" : "keeps"} ${JSON.stringify(tag)} beside ${JSON.stringify(name)}`, () => {
      expect(environmentRoleTagIsRedundant(tag, name)).toBe(expected);
    });
  }
});
