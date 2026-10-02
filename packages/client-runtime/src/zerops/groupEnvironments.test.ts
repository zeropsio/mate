import type { ZeropsRegistry } from "./hq/registry.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  halfMadeGroupEnvironments,
  missingEnvironmentRows,
  MISSING_ENVIRONMENT_LINE,
} from "./groupEnvironments.ts";

/** HQ's registry of group `g-1`, with these members. */
const registryOf = (
  members: ReadonlyArray<readonly [string, "mate" | "stage" | "production"]>,
): ZeropsRegistry => ({
  groups: [
    {
      groupId: "g-1",
      name: "Acme",
      slug: "g-1",
      projects: members.map(([projectId, kind]) => ({ projectId, kind })),
    },
  ],
});

describe("halfMadeGroupEnvironments", () => {
  const registry = registryOf([
    ["p-mate", "mate"],
    ["p-stage", "stage"],
  ]);
  /** Where HQ places a project in `g-1`, as `kind`. */
  const inAcme = (kind: "mate" | "stage" | "production") => ({
    appId: "g-1",
    appName: "Acme",
    kind,
    mate: null,
  });
  const projects = [
    { id: "p-mate", name: "Acme - dev", tagList: ["mate"], hq: inAcme("mate") },
    { id: "p-stage", name: "Acme - stage", tagList: [], hq: inAcme("stage") },
    { id: "p-prod", name: "Acme - production", tagList: [], hq: inAcme("production") },
    // A stage by its tags alone: HQ places it nowhere, so it is in no group's count.
    { id: "p-loose", name: "Loose", tagList: ["mate:role:stage"] },
  ];
  /** HQ's environment record of a project, keyed or not. */
  const environment = (projectId: string, keyHeld = true, keyInvalid = false) => ({
    projectId,
    keyHeld,
    keyInvalid,
  });
  const anybody = (): boolean => true;
  const nobody = (): boolean => false;

  it("names a production HQ neither places nor holds as an environment, and nothing else", () => {
    // The reload of 2026-09-17: the production ran, the page kept asking for it.
    const environments = new Map([["g-1", [environment("p-stage")]]]);
    expect(
      halfMadeGroupEnvironments({ projects, registry, environments, mayKey: anybody }),
    ).toEqual([{ groupId: "g-1", projectId: "p-prod", tier: "production" }]);
  });

  it("names a stage placed but held as no environment", () => {
    expect(
      halfMadeGroupEnvironments({
        projects,
        registry,
        environments: new Map([["g-1", []]]),
        mayKey: anybody,
      }),
    ).toEqual([
      { groupId: "g-1", projectId: "p-stage", tier: "stage" },
      { groupId: "g-1", projectId: "p-prod", tier: "production" },
    ]);
  });

  it("names nothing in a group whose environments HQ has not said yet", () => {
    // A cold load: every environment read as missing until HQ answered, and the page repaired each
    // one, no write needed (measured 2026-10-01: six repairs, 36 reads).
    expect(
      halfMadeGroupEnvironments({ projects, registry, environments: new Map(), mayKey: anybody }),
    ).toEqual([]);
  });

  it("leaves a group the registry does not know alone", () => {
    const registered = registryOf([
      ["p-stage", "stage"],
      ["p-prod", "production"],
    ]);
    expect(
      halfMadeGroupEnvironments({
        projects,
        registry: { groups: registered.groups.map((group) => ({ ...group, groupId: "g-2" })) },
        environments: new Map([["g-1", [environment("p-stage"), environment("p-prod")]]]),
        mayKey: anybody,
      }),
    ).toEqual([]);
  });

  // Main E07: a key HQ does not hold, or holds broken, is minted when somebody who may keep it
  // opens the page; for anybody else the environment is not theirs to finish.
  it.each([
    ["no key held", environment("p-prod", false), anybody, true],
    ["a key HQ found broken", environment("p-prod", true, true), anybody, true],
    ["no key held, for a person who may not keep one", environment("p-prod", false), nobody, false],
    ["a key that works", environment("p-prod"), anybody, false],
  ] as const)(
    "names a production known in full with %s only where it is theirs",
    (_case, prod, mayKey, named) => {
      const registered = registryOf([
        ["p-stage", "stage"],
        ["p-prod", "production"],
      ]);
      expect(
        halfMadeGroupEnvironments({
          projects,
          registry: registered,
          environments: new Map([["g-1", [environment("p-stage"), prod]]]),
          mayKey,
        }),
      ).toEqual(named ? [{ groupId: "g-1", projectId: "p-prod", tier: "production" }] : []);
    },
  );
});

describe("missingEnvironmentRows", () => {
  // The owner, twice on 2026-09-17: "it never asked me to setup production".
  const cases = [
    {
      name: "asks for both once the recipe offers both and the group has neither",
      tiersOnMain: ["stage", "production"],
      declared: [],
      want: ["Stage", "Production"],
    },
    {
      name: "asks only for what is missing",
      tiersOnMain: ["stage", "production"],
      declared: ["stage"],
      want: ["Production"],
    },
    {
      name: "asks for nothing before the recipe is on main",
      tiersOnMain: [],
      declared: [],
      want: [],
    },
    {
      name: "asks for nothing the recipe does not offer",
      tiersOnMain: ["stage"],
      declared: [],
      want: ["Stage"],
    },
    {
      name: "stage before production, whatever the order on main",
      tiersOnMain: ["production", "stage"],
      declared: [],
      want: ["Stage", "Production"],
    },
    {
      // A tier whose environment is being created has no declaration on the
      // group repo yet — the recipe change lands minutes later. Asking for it
      // meanwhile put "Stage — not set up yet — Add stage" directly under the
      // stage it was watching come up (measured on the test account,
      // 2026-09-20: the row stood for 75 seconds).
      name: "does not ask for a tier the account already holds a project for",
      tiersOnMain: ["stage", "production"],
      declared: [],
      filled: ["stage"],
      want: ["Production"],
    },
    {
      name: "asks for nothing once both tiers are held, declared or not",
      tiersOnMain: ["stage", "production"],
      declared: ["production"],
      filled: ["stage"],
      want: [],
    },
  ] as const;

  for (const tc of cases) {
    it(tc.name, () => {
      const rows = missingEnvironmentRows({
        tiersOnMain: tc.tiersOnMain,
        declarations: tc.declared.map((tier) => ({ tier })),
        ...("filled" in tc ? { filledTiers: tc.filled } : {}),
      });
      expect(rows.map((row) => row.name)).toEqual(tc.want);
      for (const row of rows) {
        expect(row.kind).toBe("missing-environment");
        expect(row.line).toBe(MISSING_ENVIRONMENT_LINE);
      }
    });
  }
});
