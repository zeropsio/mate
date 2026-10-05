import type { Deployment } from "./flow/deployment.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";
import type { Shown } from "./knowledge/known.ts";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentSlots,
  halfMadeGroupEnvironments,
  missingEnvironmentRows,
  productionRunsOf,
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

  // B5: a stage's press cut short between its import and its registration — its project placed
  // by its press's record alone — is half made once no press is at it, never while one is.
  it.each([
    { pressing: true, named: false },
    { pressing: false, named: true },
  ])(
    "names a stage its press placed, unregistered, while a press is at it: $pressing → $named",
    ({ pressing, named }) => {
      const unregistered = {
        id: "p-new-stage",
        name: "Acme - stage 2",
        tagList: [],
        hq: { ...inAcme("stage"), unregistered: true as const },
      };
      expect(
        halfMadeGroupEnvironments({
          projects: [unregistered],
          registry,
          environments: new Map([["g-1", [environment("p-stage")]]]),
          mayKey: anybody,
          pressing: (projectId) => pressing && projectId === "p-new-stage",
        }),
      ).toEqual(named ? [{ groupId: "g-1", projectId: "p-new-stage", tier: "stage" }] : []);
    },
  );

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

// The application's Environments section (MODEL §4, §9): always there; a row for what exists, a
// quiet slot for a tier that does not, and the production's own line while no release ran.
describe("environmentSlots", () => {
  const STAGE = { id: "p-stage", tier: "stage" } as const;
  const PROD = { id: "p-prod", tier: "production" } as const;
  const base: Parameters<typeof environmentSlots>[0] = {
    environments: [],
    devstages: [],
    pending: [],
    missing: ["stage", "production"],
    recipeRead: true,
    mayAdd: true,
    productionRuns: "unknown",
    waiting: { count: 0, atLeast: false },
    mainHasCode: true,
    releaseOffered: false,
    releasing: undefined,
  };
  const shape = (rows: ReturnType<typeof environmentSlots>) =>
    rows.map((row) =>
      row.kind === "slot"
        ? [row.kind, row.tier, row.line, row.add]
        : row.kind === "creating"
          ? [row.kind, row.id, row.line, row.retry]
          : row.kind === "devstage"
            ? [row.kind, row.id, row.line]
            : [row.kind, row.id, row.note?.text, row.note?.review],
    );
  const withProduction = (over: Partial<typeof base>): typeof base => ({
    ...base,
    environments: [PROD],
    missing: [],
    ...over,
  });

  it.each<{
    case: string;
    input: Parameters<typeof environmentSlots>[0];
    rows: ReadonlyArray<ReadonlyArray<unknown>>;
  }>([
    {
      case: "nothing is added: two quiet slots, each with Add",
      input: base,
      rows: [
        ["slot", "stage", "Not added", true],
        ["slot", "production", "Not added", true],
      ],
    },
    {
      case: "nothing is added and the person may not add",
      input: { ...base, mayAdd: false },
      rows: [
        ["slot", "stage", "Not added", false],
        ["slot", "production", "Not added", false],
      ],
    },
    {
      case: "production without a stage: the stage stays a slot (production needs no stage)",
      input: { ...base, environments: [PROD], missing: ["stage"] },
      rows: [
        ["slot", "stage", "Not added", true],
        ["environment", "p-prod", undefined, undefined],
      ],
    },
    {
      case: "a stage without production",
      input: { ...base, environments: [STAGE], missing: ["production"] },
      rows: [
        ["environment", "p-stage", undefined, undefined],
        ["slot", "production", "Not added", true],
      ],
    },
    {
      case: "a Mate that is also the stage counts as the stage",
      input: { ...base, devstages: [{ id: "p-dev", name: "Vera" }], missing: ["production"] },
      rows: [
        ["devstage", "p-dev", "Vera — the stage, deployed by its agent"],
        ["slot", "production", "Not added", true],
      ],
    },
    {
      case: "the recipe does not offer production yet: it waits for the Mate's recipe",
      input: { ...base, missing: ["stage"] },
      rows: [
        ["slot", "stage", "Not added", true],
        ["slot", "production", "Waiting for the Mate's recipe", false],
      ],
    },
    {
      case: "the recipe is not read: nothing is claimed or offered",
      input: { ...base, recipeRead: false, missing: [] },
      rows: [
        ["slot", "stage", "Not added", false],
        ["slot", "production", "Not added", false],
      ],
    },
    {
      case: "an empty production, main has code, the person may release: the first release",
      input: withProduction({ productionRuns: "empty", releaseOffered: true }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "Empty — waiting for its first release", true],
      ],
    },
    {
      case: "an empty production, main has code, the person may not release: only the information",
      input: withProduction({ productionRuns: "empty" }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "Empty — waiting for its first release", false],
      ],
    },
    {
      case: "an empty production while main is empty: waiting for the first merge",
      input: withProduction({ productionRuns: "empty", mainHasCode: false }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "Empty — waiting for the first merge", false],
      ],
    },
    {
      case: "production runs and changes wait: the count, with Review release for a releaser",
      input: withProduction({
        productionRuns: "running",
        waiting: { count: 3, atLeast: false },
        releaseOffered: true,
      }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "3 changes waiting for production", true],
      ],
    },
    {
      case: "production runs and one change waits, for somebody who may not release",
      input: withProduction({ productionRuns: "running", waiting: { count: 1, atLeast: false } }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "1 change waiting for production", false],
      ],
    },
    {
      case: "a release on its way is said, with nothing to press",
      input: withProduction({
        productionRuns: "running",
        waiting: { count: 3, atLeast: false },
        releaseOffered: true,
        releasing: "v0.1.2",
      }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", "Releasing v0.1.2…", false],
      ],
    },
    {
      case: "production current: no line of its own",
      input: withProduction({ productionRuns: "running" }),
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", undefined, undefined],
      ],
    },
    {
      case: "a production being created is its row, never a second Add (§9.6)",
      input: {
        ...base,
        pending: [{ id: "p-new", tier: "production", name: "Todo - production", failed: false }],
        missing: ["stage"],
      },
      rows: [
        ["slot", "stage", "Not added", true],
        ["creating", "p-new", "Setting up production…", false],
      ],
    },
    {
      case: "a production whose creation failed offers only Try again, to who may add",
      input: {
        ...base,
        pending: [{ id: "p-new", tier: "production", name: "Todo - production", failed: true }],
        missing: ["stage"],
      },
      rows: [
        ["slot", "stage", "Not added", true],
        ["creating", "p-new", "Setup failed", true],
      ],
    },
    {
      case: "a failed creation, somebody who may not add: the words only",
      input: {
        ...base,
        mayAdd: false,
        pending: [{ id: "p-new", tier: "production", name: "Todo - production", failed: true }],
        missing: ["stage"],
      },
      rows: [
        ["slot", "stage", "Not added", false],
        ["creating", "p-new", "Setup failed", false],
      ],
    },
    {
      case: "a stage being created stands in for the stage slot",
      input: {
        ...base,
        pending: [{ id: "p-st", tier: "stage", name: "Todo - stage", failed: false }],
        missing: ["production"],
      },
      rows: [
        ["creating", "p-st", "Setting up a stage…", false],
        ["slot", "production", "Not added", true],
      ],
    },
    {
      case: "a stage being created beside a stage that exists is one more row",
      input: {
        ...base,
        environments: [STAGE],
        pending: [{ id: "p-st2", tier: "stage", name: "Todo - stage 2", failed: false }],
        missing: ["production"],
      },
      rows: [
        ["environment", "p-stage", undefined, undefined],
        ["creating", "p-st2", "Setting up a stage…", false],
        ["slot", "production", "Not added", true],
      ],
    },
    {
      case: "a creation HQ already holds is the environment, not a pending one",
      input: {
        ...base,
        environments: [PROD],
        pending: [{ id: "p-prod", tier: "production", name: "Todo - production", failed: false }],
        missing: [],
      },
      rows: [
        ["slot", "stage", "Waiting for the Mate's recipe", false],
        ["environment", "p-prod", undefined, undefined],
      ],
    },
  ])("$case", ({ input, rows }) => {
    expect(shape(environmentSlots(input))).toEqual(rows);
  });
});

describe("productionRunsOf", () => {
  const known = (value: unknown, freshness: "live" | "stale" = "live") =>
    ({ state: "known", value, freshness: { kind: freshness } }) as unknown as Shown<Deployment>;
  it.each([
    ["nothing read yet", undefined, "unknown"],
    ["the read failed", { state: "failed" } as unknown as Shown<Deployment>, "unknown"],
    ["a stale answer", known({ kind: "none" }, "stale"), "unknown"],
    ["nothing runs", known({ kind: "none" }), "empty"],
    ["a build runs", known({ kind: "deploying" }), "deploying"],
    ["a version runs", known({ kind: "running" }), "running"],
  ] as const)("reads %s as %s", (_name, deployment, expected) => {
    expect(productionRunsOf(deployment)).toBe(expected);
  });
});
