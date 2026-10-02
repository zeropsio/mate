import type { GroupEnvironmentRowInput, GroupStops } from "@t3tools/client-runtime/zerops";
import type { HqDeploy } from "@t3tools/client-runtime/zerops/hq";
import type { Release } from "@t3tools/shared/hqRelease";
import { describe, expect, it } from "vite-plus/test";

import { joinProjectFlows, RELEASE_MOVES_TO_HQ } from "./ZeropsProjectFlowProvider";

const GROUPS = [
  { groupId: "g1", slug: "harbor" },
  { groupId: "g2", slug: "links" },
];

const stopsOf = (environments: ReadonlyArray<GroupEnvironmentRowInput> = []): GroupStops => ({
  declarations: environments.map((entry) => ({
    name: entry.environment,
    tier: entry.tier,
    project: entry.projectId,
    sources: entry.sources,
  })),
  environments,
  missing: [],
});

const NOW = Date.parse("2026-09-24T10:05:00Z");
const NOTHING_WITHHELD: ReadonlyMap<string, string> = new Map();

/** A release HQ approved of `entries` (`{service: sha}`), made at `at`. */
const approved = (tag: string, entries: Record<string, string>, at: string): Release => ({
  tag,
  sha: "9".repeat(40),
  entries: Object.entries(entries).map(([service, sha]) => ({ service, sha })),
  by: "u1",
  at,
  state: "approved",
  reason: null,
  rollbackOf: null,
});
const FIRST = approved("v0.1.0", { app: "1".repeat(40) }, "2026-09-24T09:00:00Z");

/** HQ's record of a production deploy of `sha`. */
const record = (sha: string, state: HqDeploy["state"], at: string): HqDeploy => ({
  sha,
  state,
  failure: state === "failed" ? "job" : null,
  message: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at,
});

function join(input: {
  readonly stops?: ReadonlyMap<string, GroupStops>;
  readonly releases?: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly withheld?: ReadonlyMap<string, string>;
}) {
  return joinProjectFlows({
    groups: GROUPS,
    stops: input.stops ?? new Map(),
    releases: input.releases ?? new Map(),
    changes: null,
    changesFailure: undefined,
    nowMs: NOW,
    withheld: input.withheld ?? NOTHING_WITHHELD,
  });
}

describe("joinProjectFlows", () => {
  it("G2 resolving leaves G1's flow", () => {
    const g1Stops = stopsOf();
    const g1Releases = [FIRST];
    const before = join({
      stops: new Map([["g1", g1Stops]]),
      releases: new Map([["g1", g1Releases]]),
    });
    const after = join({
      stops: new Map([
        ["g1", g1Stops],
        ["g2", stopsOf()],
      ]),
      releases: new Map([["g1", g1Releases]]),
    });
    expect(after.get("g2")).toBeDefined();
    expect(after.get("g1")).toBe(before.get("g1"));
  });

  it("knows a group's environments once HQ has told them", () => {
    const stage: GroupEnvironmentRowInput = {
      projectId: "stage-1",
      name: "harbor stage",
      tier: "stage",
      sources: ["main"],
      environment: "stage",
      keyHeld: true,
      keyInvalid: false,
      services: [],
    };
    expect(join({ releases: new Map([["g1", [FIRST]]]) }).get("g1")?.declarationsRead).toBe(false);
    const flow = join({ stops: new Map([["g1", stopsOf([stage])]]) }).get("g1");
    expect(flow?.declarationsRead).toBe(true);
    expect(flow?.declarations.map(({ project }) => project)).toEqual(["stage-1"]);
    expect(flow?.environments.map(({ name }) => name)).toEqual(["harbor stage"]);
  });

  it.each([
    ["a production shown", NOTHING_WITHHELD, RELEASE_MOVES_TO_HQ],
    [
      "a production the grant withholds",
      new Map([["prod-1", "Checking your access to this project…"]]),
      "Checking your access to this project…",
    ],
  ] as const)("offers no release against %s, and says why", (_case, withheld, reason) => {
    const production: GroupEnvironmentRowInput = {
      projectId: "prod-1",
      name: "harbor production",
      tier: "production",
      sources: "release",
      environment: "production",
      keyHeld: true,
      keyInvalid: false,
      services: [{ hostname: "app", appVersionName: "1".repeat(40) }],
    };
    const release = join({
      stops: new Map([["g1", stopsOf([production])]]),
      releases: new Map([["g1", [FIRST]]]),
      withheld,
    }).get("g1")?.release;
    expect(release?.gate).toEqual({ allowed: false, reason });
    expect(release?.entries).toEqual([]);
    expect(release?.contents).toEqual([]);
    expect(release?.suggestion).toBe("v0.1.1");
  });

  // A production runs several releases at once when its services were released at different
  // times: a release lists only the services whose `main` moved, so a service keeps running a
  // release that is older than the newest. The stop is the newest release all its services run.
  it.each([
    {
      name: "a production running several releases is named by the newest one all its services run",
      tier: "production" as const,
      nextstore: "5".repeat(40),
      label: "v0.1.13",
    },
    {
      name: "a production no release matches keeps its first labelled service's name",
      tier: "production" as const,
      nextstore: "f".repeat(40),
      label: "v0.1.9",
    },
    {
      name: "a stage keeps its first labelled service's name",
      tier: "stage" as const,
      nextstore: "5".repeat(40),
      label: "v0.1.9",
    },
  ])("$name", ({ tier, nextstore, label }) => {
    const MEDUSA = "a".repeat(40);
    const release = (patch: number) =>
      approved(
        `v0.1.${String(patch)}`,
        { medusa: MEDUSA, nextstore: String(patch - 8).repeat(40) },
        `2026-09-2${String(patch - 9)}T09:00:00Z`,
      );
    const flow = join({
      stops: new Map([
        [
          "g1",
          stopsOf([
            {
              projectId: "env-1",
              name: `beviro ${tier}`,
              tier,
              sources: tier === "production" ? "release" : ["main"],
              environment: tier,
              keyHeld: true,
              keyInvalid: false,
              services: [
                { hostname: "medusa", appVersionName: `${MEDUSA} v0.1.9 broker` },
                { hostname: "nextstore", appVersionName: `${nextstore} v0.1.13 broker` },
              ],
            },
          ]),
        ],
      ]),
      releases: new Map([["g1", [13, 12, 11, 10, 9].map(release)]]),
    }).get("g1");
    expect(flow?.environments.map(({ version }) => version.label)).toEqual([label]);
    expect(flow?.environments[0]?.version.sha).toBe(MEDUSA);
  });

  // The release v0.1.1 lists MERGED; production still runs RUNNING, and HQ records how its newest
  // deploy of the app went.
  const RUNNING = "1".repeat(40);
  const MERGED = "2".repeat(40);
  const TAGGED_AT = "2026-09-24T10:00:00Z";
  function flowWithProductionDeploy(latest: HqDeploy | undefined, productionRuns = RUNNING) {
    return join({
      stops: new Map([
        [
          "g1",
          stopsOf([
            {
              projectId: "prod-1",
              name: "harbor production",
              tier: "production",
              sources: "release",
              environment: "production",
              keyHeld: true,
              keyInvalid: false,
              services: [
                {
                  hostname: "app",
                  appVersionName: productionRuns,
                  ...(latest === undefined ? {} : { deploy: { latest, live: null } }),
                },
              ],
            },
          ]),
        ],
      ]),
      releases: new Map([["g1", [approved("v0.1.1", { app: MERGED }, TAGGED_AT), FIRST]]]),
    }).get("g1");
  }

  const rowsOf = (flow: ReturnType<typeof flowWithProductionDeploy>) =>
    flow?.releases.map(({ tag, standing, word, rollBack }) => ({ tag, standing, word, rollBack }));

  it.each([
    {
      name: "the release production runs reads Live; the newer one is not a state it was in yet",
      latest: record(MERGED, "deploying", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "the newest's production deploy failed after its tag: it reads Deploy failed",
      latest: record(MERGED, "failed", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "production moved to the newest: it reads Live, the earlier one offers a roll-back",
      latest: record(MERGED, "live", "2026-09-24T10:01:00Z"),
      runs: MERGED,
      rows: [
        { tag: "v0.1.1", standing: "live", word: "Live", rollBack: false },
        { tag: "v0.1.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
  ])("$name", ({ latest, runs, rows }) => {
    expect(rowsOf(flowWithProductionDeploy(latest, runs))).toEqual(rows);
  });

  it("holds the newest release in flight until production runs it", () => {
    expect(flowWithProductionDeploy(undefined, RUNNING)?.release.inFlight).toBe("v0.1.1");
    expect(flowWithProductionDeploy(undefined, MERGED)?.release.inFlight).toBe(undefined);
  });

  it.each([
    {
      name: "a failure newer than the tag ends the hold",
      latest: record(MERGED, "failed", "2026-09-24T10:01:00Z"),
      inFlight: undefined,
    },
    {
      name: "a failure older than the tag does not end the hold",
      latest: record(MERGED, "failed", "2026-09-24T09:59:00Z"),
      inFlight: "v0.1.1",
    },
    {
      name: "a retry HQ is deploying again holds it",
      latest: record(MERGED, "deploying", "2026-09-24T10:01:00Z"),
      inFlight: "v0.1.1",
    },
  ])("$name", ({ latest, inFlight }) => {
    expect(flowWithProductionDeploy(latest)?.release.inFlight).toBe(inFlight);
  });
});
