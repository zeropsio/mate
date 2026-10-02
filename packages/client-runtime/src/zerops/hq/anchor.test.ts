import { describe, expect, it } from "@effect/vitest";

import type { ZeropsOrganizationMember } from "../api.ts";
import { findOfficialHq, hqAnchorName, ownersAndAdmins } from "./anchor.ts";

const token = (
  name: string,
  overrides: { readonly roleCode?: string; readonly status?: string } = {},
): ZeropsOrganizationMember => ({
  id: `member-${name}`,
  userId: `user-${name}`,
  roleCode: overrides.roleCode ?? "ADMIN",
  status: overrides.status ?? "ACTIVE",
  user: { fullName: name, email: `token-${name.length}@zerops.io` },
});
const person = (name: string, roleCode = "OWNER"): ZeropsOrganizationMember => ({
  id: `member-${name}`,
  userId: `user-${name}`,
  roleCode,
  status: "ACTIVE",
  user: { fullName: name, email: "ada@example.com" },
});

const ANCHOR = hqAnchorName("hq1", "https://hq-30db-8080.prg1.zerops.app");

describe("findOfficialHq", () => {
  it.each<[string, ReadonlyArray<ZeropsOrganizationMember>, ReturnType<typeof findOfficialHq>]>([
    ["no anchor at all", [person("Ada")], { kind: "none" }],
    [
      "one active Admin token anchor",
      [person("Ada"), token(ANCHOR)],
      { kind: "official", projectId: "hq1", address: "https://hq-30db-8080.prg1.zerops.app" },
    ],
    [
      "an anchor's trailing slash is not part of the address",
      [token(`${ANCHOR}/`)],
      { kind: "official", projectId: "hq1", address: "https://hq-30db-8080.prg1.zerops.app" },
    ],
    [
      "a mate-hq name below Admin is no anchor",
      [token(ANCHOR, { roleCode: "READ_ONLY" })],
      { kind: "none" },
    ],
    ["the working token is no anchor", [token("mate-hq-org:hq1")], { kind: "none" }],
    [
      "anchors naming two projects: no HQ is official",
      [token(ANCHOR), token("mate-hq:hq2:https://hq-9-8080.prg1.zerops.app")],
      { kind: "unclear", projectIds: ["hq1", "hq2"] },
    ],
    [
      "a person named like an anchor still names a project, and is no anchor itself",
      [person("mate-hq:hq1:https://hq-30db-8080.prg1.zerops.app", "ADMIN")],
      { kind: "unclear", projectIds: ["hq1"] },
    ],
    [
      "an anchor that is not active yet",
      [token(ANCHOR, { status: "PENDING" })],
      { kind: "unclear", projectIds: ["hq1"] },
    ],
  ])("%s", (_name, members, expected) => {
    expect(findOfficialHq(members)).toEqual(expected);
  });
});

describe("ownersAndAdmins", () => {
  it("is the org's active owners and admins who are people: the ones who set an HQ up", () => {
    const pending = { ...person("Petr", "ADMIN"), status: "PENDING" };
    expect(
      ownersAndAdmins([
        person("Ada"),
        person("Eva", "ADMIN"),
        person("Jan", "BASIC_USER"),
        pending,
        token(ANCHOR),
      ]).map((member) => member.user?.fullName),
    ).toEqual(["Ada", "Eva"]);
  });
});
