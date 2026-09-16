import { describe, expect, it } from "vite-plus/test";

import fixtures from "./zeropsRoles.fixtures.json" with { type: "json" };
import {
  zeropsRoleAnswer,
  type RoleRegistry,
  type ZeropsOrgRole,
  type ZeropsProjectRoleOverrides,
} from "./zeropsRoles.ts";

/**
 * The fixture file is the contract, byte-identical with
 * `internal/roles/fixtures.json` in `zeropsio/gitea-mate`. Every case is
 * replayed whole — the answer is compared in full, not field by field, so a
 * rule that silently gains or loses an entry fails here.
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

describe("zeropsRoleAnswer — the shared fixtures", () => {
  it("is the version both implementations were written against", () => {
    expect(file.version).toBe(1);
  });

  it("carries every case the Go twin replays", () => {
    expect(file.cases.length).toBeGreaterThan(0);
  });

  it.each(file.cases.map((entry) => [entry.name, entry] as const))("%s", (_name, entry) => {
    expect(
      zeropsRoleAnswer({
        person: {
          id: entry.person.id,
          orgRole: entry.person.orgRole as ZeropsOrgRole,
          status: entry.person.status,
          canCreateProjects: entry.person.canCreateProjects,
        },
        overrides: entry.overrides as ZeropsProjectRoleOverrides,
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
          { id: "p-prod", kind: "production" },
        ],
      },
    ],
  };

  const table: ReadonlyArray<{
    readonly name: string;
    readonly orgRole: ZeropsOrgRole;
    readonly status: string;
    readonly canCreateProjects: boolean;
    readonly overrides: ZeropsProjectRoleOverrides;
    readonly claims: ReadonlyArray<string>;
    readonly mate: "open" | "listed" | "hidden";
  }> = [
    {
      name: "an override on a project outside the registry changes nothing",
      orgRole: "READ_ONLY",
      status: "ACTIVE",
      canCreateProjects: false,
      overrides: { "p-elsewhere": "OWNER" },
      claims: ["g:solo:read"],
      mate: "listed",
    },
    {
      name: "a status the platform spells some other way is not a member",
      orgRole: "OWNER",
      status: "DEACTIVATED",
      canCreateProjects: true,
      overrides: {},
      claims: [],
      mate: "hidden",
    },
    {
      name: "a production override is what releases, not the org role",
      orgRole: "NO_ACCESS",
      status: "ACTIVE",
      canCreateProjects: false,
      overrides: { "p-prod": "BASIC_USER" },
      claims: ["g:solo:read", "g:solo:release", "g:solo:write"],
      mate: "hidden",
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const answer = zeropsRoleAnswer({
      person: {
        id: "u-probe",
        orgRole: row.orgRole,
        status: row.status,
        canCreateProjects: row.canCreateProjects,
      },
      overrides: row.overrides,
      registry,
    });
    expect(answer.claims).toEqual(row.claims);
    expect(answer.mates["p-mate"]).toBe(row.mate);
  });

  it("names every Mate and every group, so a consumer never has to know which exist", () => {
    const answer = zeropsRoleAnswer({
      person: { id: "u-probe", orgRole: "READ_ONLY", status: "ACTIVE", canCreateProjects: false },
      overrides: {},
      registry,
    });
    expect(Object.keys(answer.mates)).toEqual(["p-mate"]);
    expect(Object.keys(answer.groups)).toEqual(["solo"]);
  });

  it("sorts the claims, whatever order the registry lists its groups in", () => {
    const reversed: RoleRegistry = {
      groups: [
        { id: "g-z", slug: "zulu", projects: [{ id: "p-z", kind: "mate" }] },
        { id: "g-a", slug: "alpha", projects: [{ id: "p-a", kind: "mate" }] },
      ],
    };
    expect(
      zeropsRoleAnswer({
        person: { id: "u-probe", orgRole: "OWNER", status: "ACTIVE", canCreateProjects: false },
        overrides: {},
        registry: reversed,
      }).claims,
    ).toEqual([
      "g:alpha:read",
      "g:alpha:release",
      "g:alpha:write",
      "g:zulu:read",
      "g:zulu:release",
      "g:zulu:write",
      "org:owner",
    ]);
  });
});
