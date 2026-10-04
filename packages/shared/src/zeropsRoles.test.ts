import { describe, expect, it } from "vite-plus/test";

import fixtures from "./zeropsRoles.fixtures.json" with { type: "json" };
import {
  type RoleRegistry,
  mayBearHq,
  mayCreateProjects,
  zeropsRoleAnswer,
} from "./zeropsRoles.ts";

/**
 * The fixture file is the contract. Every case is replayed whole — the answer is compared in full,
 * not field by field, so a rule that silently gains or loses an entry fails here.
 */
interface FixtureCase {
  readonly name: string;
  readonly registry?: RoleRegistry;
  readonly person: {
    readonly id: string;
    readonly orgRole: string;
    readonly status: string;
    readonly canCreateProjects: boolean;
  };
  readonly overrides: Readonly<Record<string, string>>;
  readonly expect: unknown;
}

const file = fixtures as unknown as {
  readonly version: number;
  readonly registry: RoleRegistry;
  readonly cases: ReadonlyArray<FixtureCase>;
};

describe("zeropsRoleAnswer — the fixtures", () => {
  it("is the version the implementation was written against", () => {
    expect(file.version).toBe(2);
  });

  it.each(file.cases.map((entry) => [entry.name, entry] as const))("%s", (_name, entry) => {
    expect(
      zeropsRoleAnswer({
        person: entry.person,
        overrides: entry.overrides,
        registry: entry.registry ?? file.registry,
      }),
    ).toEqual(entry.expect);
  });
});

describe("zeropsRoleAnswer — shapes the fixtures do not reach", () => {
  const registry: RoleRegistry = {
    groups: [
      {
        id: "g-solo",
        projects: [
          { id: "p-mate", kind: "mate" },
          { id: "p-dev", kind: "devstage" },
          { id: "p-prod", kind: "production" },
        ],
      },
    ],
  };

  it.each([
    {
      name: "an override on a project outside the registry changes nothing",
      orgRole: "READ_ONLY",
      status: "ACTIVE",
      overrides: { "p-elsewhere": "OWNER" },
      mate: "listed",
    },
    {
      name: "a status the platform spells some other way is not a member",
      orgRole: "OWNER",
      status: "DEACTIVATED",
      overrides: {},
      mate: "hidden",
    },
  ] as const)("$name", (row) => {
    const answer = zeropsRoleAnswer({
      person: { id: "u-probe", orgRole: row.orgRole, status: row.status, canCreateProjects: false },
      overrides: row.overrides,
      registry,
    });
    expect(answer.mates["p-mate"]).toBe(row.mate);
  });

  it("names every Mate-kind project, a devstage one included, and no environment", () => {
    const answer = zeropsRoleAnswer({
      person: { id: "u-probe", orgRole: "READ_ONLY", status: "ACTIVE", canCreateProjects: false },
      overrides: {},
      registry,
    });
    expect(Object.keys(answer.mates)).toEqual(["p-mate", "p-dev"]);
  });
});

// The two things the client still reads off Zerops' own facts, before or beside any HQ answer.
describe("mayBearHq — who bears the organization's HQ, before HQ exists", () => {
  it.each([
    ["an active owner", { roleCode: "OWNER" }, true],
    ["an active admin", { roleCode: "ADMIN" }, true],
    ["a basic user who can create projects", { roleCode: "BASIC_USER" }, false],
    ["an owner Zerops no longer counts active", { roleCode: "OWNER", status: "SUSPENDED" }, false],
    ["a role this build does not know", { roleCode: "SUPREME" }, false],
    ["nobody the session names", undefined, false],
  ] as const)("%s: %s", (_, member, bears) => {
    expect(mayBearHq(member)).toBe(bears);
  });
});

describe("mayCreateProjects — Zerops' own flag, an owner's and an admin's by their role", () => {
  it.each([
    ["an admin", { roleCode: "ADMIN" }, true],
    [
      "a read-only member Zerops lets create",
      { roleCode: "READ_ONLY", canCreateProjects: true },
      true,
    ],
    ["a basic user without the flag", { roleCode: "BASIC_USER", canCreateProjects: false }, false],
    [
      "a flagged member Zerops no longer counts active",
      { roleCode: "NO_ACCESS", canCreateProjects: true, status: "INVITED" },
      false,
    ],
  ] as const)("%s: %s", (_, member, creates) => {
    expect(mayCreateProjects(member)).toBe(creates);
  });
});
