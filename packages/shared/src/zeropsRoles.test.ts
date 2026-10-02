import { describe, expect, it } from "vite-plus/test";

import fixtures from "./zeropsRoles.fixtures.json" with { type: "json" };
import { type RoleRegistry, zeropsRoleAnswer } from "./zeropsRoles.ts";

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
        slug: "solo",
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
