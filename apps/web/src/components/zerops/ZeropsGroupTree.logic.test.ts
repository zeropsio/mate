import { buildZeropsGroupTree, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  creatableRoles,
  environmentRoleLabel,
  environmentRoleTag,
  environmentRoleTagIsRedundant,
  groupNameIsPlaceholder,
} from "./ZeropsGroupTree.logic";

function item(name: string, tagList: ReadonlyArray<string>): { readonly project: ZeropsProject } {
  return { project: { id: name, name, status: "ACTIVE", tagList } };
}

const CRM_DEV = item("crm-dev", ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM"]);
const CRM_STAGE = item("crm-stage", ["mate:g:aaa", "mate:role:stage"]);
const CRM_PROD = item("crm-prod", ["mate:g:aaa", "mate:role:prod", "mate:name:Beviro CRM"]);

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

describe("environmentRoleLabel", () => {
  it.each([
    ["dev", "Dev"],
    ["devstage", "Dev / Stage"],
    ["stage", "Stage"],
    ["prod", "Production"],
  ] as const)("writes %s as %s in a sentence", (role, expected) => {
    expect(environmentRoleLabel(role)).toBe(expected);
  });

  it("has no word for an environment with no role", () => {
    expect(environmentRoleLabel(undefined)).toBeNull();
  });
});

describe("environmentRoleTag", () => {
  it.each([
    ["dev", "dev"],
    ["devstage", "dev/stage"],
    ["stage", "stage"],
    ["prod", "prod"],
  ] as const)("writes %s as the tag %s", (role, expected) => {
    expect(environmentRoleTag(role)).toBe(expected);
  });

  it("has no tag for an environment with no role", () => {
    expect(environmentRoleTag(undefined)).toBeNull();
  });
});

describe("groupNameIsPlaceholder", () => {
  it("is true for a group nothing has named", () => {
    const [group] = buildZeropsGroupTree([item("x", ["mate:g:zzz"])], { order: "name" }).groups;
    expect(groupNameIsPlaceholder(group!.group)).toBe(true);
  });

  it("is false once a label tag names it", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV], { order: "name" }).groups;
    expect(groupNameIsPlaceholder(group!.group)).toBe(false);
  });
});

describe("creatableRoles", () => {
  it("offers every role to a group that has only a dev", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV], { order: "name" }).groups;
    expect(creatableRoles(group!.group)).toEqual(["dev", "stage", "prod"]);
  });

  // A Mate is a dev environment, and a project is worked on by as many Mates
  // as the people on it want. Capping dev at one is what left a full group —
  // dev, stage and production — with no way to add anything at all.
  it("keeps offering dev however many Mates a group already has", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV, CRM_STAGE, CRM_PROD], { order: "name" }).groups;
    expect(creatableRoles(group!.group)).toContain("dev");
  });

  it("keeps offering stage, which a group may have more than one of", () => {
    const [group] = buildZeropsGroupTree([CRM_DEV, CRM_STAGE, CRM_PROD], { order: "name" }).groups;
    expect(creatableRoles(group!.group)).toContain("stage");
  });

  // The one cap: production is the thing the pipeline deploys into, and a
  // group with two of them has no answer for which.
  it("offers production only while the group has none", () => {
    const [without] = buildZeropsGroupTree([CRM_DEV, CRM_STAGE], { order: "name" }).groups;
    expect(creatableRoles(without!.group)).toContain("prod");

    const [withProd] = buildZeropsGroupTree([CRM_DEV, CRM_STAGE, CRM_PROD], {
      order: "name",
    }).groups;
    expect(creatableRoles(withProd!.group)).not.toContain("prod");
  });
});
