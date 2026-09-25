import { releaseInFlightReason } from "@t3tools/client-runtime/zerops";
import { CHECKING_RELEASE } from "@t3tools/client-runtime/zerops/flow";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsGroupDeployState } from "./useZeropsGroupDeploys";
import type { ZeropsGroupForgeState } from "./useZeropsGroupForge";
import { joinProjectFlows } from "./ZeropsProjectFlowProvider";

const GROUPS = [
  { groupId: "g1", slug: "harbor" },
  { groupId: "g2", slug: "links" },
];

const deployState = (): ZeropsGroupDeployState => ({
  declarations: [],
  environments: [],
  pullRequests: [],
  missing: [],
  mainHeadRepositories: new Map([["app", "appdev"]]),
  mainHeads: new Map([["app", "3f9c1b2000000000000000000000000000000000"]]),
  groupHead: undefined,
  releaseContents: [],
});

const NOW = Date.parse("2026-09-24T10:05:00Z");
const NOTHING_WITHHELD: ReadonlyMap<string, string> = new Map();
const NO_FAILURES = { deploys: new Map<string, string>(), forge: new Map<string, string>() };

const forgeState = (): ZeropsGroupForgeState => ({
  repositories: [],
  pullRequests: [],
  merged: [],
  released: { releases: [], tags: ["v0.1.0"] },
});

describe("joinProjectFlows", () => {
  it("G2 resolving leaves G1's flow", () => {
    const g1Deploys = deployState();
    const g1Forge = forgeState();
    const before = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([["g1", g1Deploys]]),
      forges: new Map([["g1", g1Forge]]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    const after = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([
        ["g1", g1Deploys],
        ["g2", deployState()],
      ]),
      forges: new Map([["g1", g1Forge]]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    expect(after.get("g2")).toBeDefined();
    expect(after.get("g1")).toBe(before.get("g1"));
  });

  it("offers a release only once both halves are read", () => {
    const deploys = new Map([["g1", deployState()]]);
    const halfJoined = joinProjectFlows({
      groups: GROUPS,
      deploys,
      forges: new Map(),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    expect(halfJoined.get("g1")?.release.gate).toEqual({
      allowed: false,
      reason: CHECKING_RELEASE,
    });
    const joined = joinProjectFlows({
      groups: GROUPS,
      deploys,
      forges: new Map([["g1", forgeState()]]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    expect(joined.get("g1")?.release.gate).toEqual({ allowed: true });
  });

  it("says why a release cannot be checked when a half keeps failing, rather than checking for ever", () => {
    const failing = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map(),
      forges: new Map([["g1", forgeState()]]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: { ...NO_FAILURES, deploys: new Map([["g1", "Gitea did not answer"]]) },
    });
    expect(failing.get("g1")?.release.gate).toEqual({
      allowed: false,
      reason: "Can't check what can be released: Gitea did not answer.",
    });
    const tagsNeverRead = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([["g1", deployState()]]),
      forges: new Map([["g1", { ...forgeState(), released: { failure: "Gitea did not answer" } }]]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    expect(tagsNeverRead.get("g1")?.release.gate).toEqual({
      allowed: false,
      reason: "Can't check what can be released: Gitea did not answer.",
    });
    // Tags kept from an earlier read are stale while the read fails: the
    // suggestion they would give is not offered, and the releases still show.
    const tagsStale = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([["g1", deployState()]]),
      forges: new Map([
        [
          "g1",
          {
            ...forgeState(),
            released: {
              releases: [
                {
                  tag: "v0.1.0",
                  verdict: "approved",
                  detail: undefined,
                  line: "",
                  entries: [],
                  taggedAt: undefined,
                },
              ],
              tags: ["v0.1.0"],
              failure: "Gitea did not answer",
            },
          },
        ],
      ]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    });
    expect(tagsStale.get("g1")?.release.gate).toEqual({
      allowed: false,
      reason: "Can't check what can be released: Gitea did not answer.",
    });
    expect(tagsStale.get("g1")?.releases.map((release) => release.tag)).toEqual(["v0.1.0"]);
  });

  // DESIGN §3.4: a production the grant withholds shows nothing it runs, so nothing measured
  // against what it runs either — neither what a release would carry nor the offer to make one.
  const RUNNING = "1".repeat(40);
  const MERGED = "2".repeat(40);
  const CHECKING = "Checking your access to this project…";
  it.each([
    ["a production shown", NOTHING_WITHHELD, { allowed: true }, ["Fix the cart"]],
    [
      "a production the grant withholds",
      new Map([["prod-1", CHECKING]]),
      { allowed: false, reason: CHECKING },
      [],
    ],
    [
      "a stage the grant withholds",
      new Map([["stage-1", CHECKING]]),
      { allowed: true },
      ["Fix the cart"],
    ],
  ] as const)("releases against %s", (_case, withheld, gate, carried) => {
    const stop = (projectId: string, tier: "production" | "stage") => ({
      projectId,
      name: `harbor ${tier}`,
      tier,
      sources: "release" as const,
      environment: tier,
      services: [{ hostname: "app", appVersionName: RUNNING }],
    });
    const flows = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([
        [
          "g1",
          {
            ...deployState(),
            environments: [stop("stage-1", "stage"), stop("prod-1", "production")],
            mainHeads: new Map([["app", MERGED]]),
            releaseContents: [
              { service: "app", commits: [{ sha: MERGED, subject: "Fix the cart" }] },
            ],
          },
        ],
      ]),
      forges: new Map([["g1", forgeState()]]),
      mayRelease: true,
      nowMs: NOW,
      withheld,
      failures: NO_FAILURES,
    });
    const release = flows.get("g1")?.release;
    expect(release?.gate).toEqual(gate);
    expect(
      release?.contents.flatMap(({ commits }) => commits.map(({ subject }) => subject)),
    ).toEqual(carried);
  });

  it("Release is not offered while the newest release tag is pending and production does not run it yet", () => {
    const production = (sha: string) => ({
      projectId: "prod-1",
      name: "harbor production",
      tier: "production" as const,
      sources: "release" as const,
      environment: "production",
      services: [{ hostname: "app", appVersionName: sha }],
    });
    const MERGED = "2".repeat(40);
    const RUNNING = "1".repeat(40);
    const join = (runs: string) =>
      joinProjectFlows({
        groups: GROUPS,
        deploys: new Map([
          [
            "g1",
            {
              ...deployState(),
              environments: [production(runs)],
              mainHeads: new Map([["app", MERGED]]),
            },
          ],
        ]),
        forges: new Map([
          [
            "g1",
            {
              ...forgeState(),
              released: {
                releases: [
                  {
                    tag: "v0.1.1",
                    verdict: "pending",
                    detail: undefined,
                    line: "",
                    entries: [{ service: "app", commit: MERGED }],
                    taggedAt: "2026-09-24T10:00:00Z",
                  },
                ],
                tags: ["v0.1.0", "v0.1.1"],
                newest: {
                  tag: "v0.1.1",
                  verdict: "pending",
                  entries: [{ service: "app", commit: MERGED }],
                  taggedAt: "2026-09-24T10:00:00Z",
                },
              },
            },
          ],
        ]),
        mayRelease: true,
        nowMs: NOW,
        withheld: NOTHING_WITHHELD,
        failures: NO_FAILURES,
      }).get("g1")?.release;
    expect(join(RUNNING)?.gate).toEqual({
      allowed: false,
      reason: releaseInFlightReason("v0.1.1"),
    });
    expect(join(RUNNING)?.inFlight).toBe("v0.1.1");
    expect(join(MERGED)?.inFlight).toBeUndefined();
  });

  it("after a failed production build with an unread version name, Release is offered again", () => {
    const MERGED = "2".repeat(40);
    // The platform names no version after a failed build: what production runs is not read.
    const release = joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([
        [
          "g1",
          {
            ...deployState(),
            environments: [
              {
                projectId: "prod-1",
                name: "harbor production",
                tier: "production" as const,
                sources: "release" as const,
                environment: "production",
                services: [{ hostname: "app" }],
              },
            ],
            mainHeads: new Map([["app", MERGED]]),
          },
        ],
      ]),
      forges: new Map([
        [
          "g1",
          {
            ...forgeState(),
            released: {
              releases: [
                {
                  tag: "v0.1.1",
                  verdict: "refused",
                  detail: undefined,
                  line: "",
                  entries: [{ service: "app", commit: MERGED }],
                  taggedAt: "2026-09-24T10:00:00Z",
                },
              ],
              tags: ["v0.1.0", "v0.1.1"],
              newest: {
                tag: "v0.1.1",
                verdict: "refused",
                entries: [{ service: "app", commit: MERGED }],
                taggedAt: "2026-09-24T10:00:00Z",
              },
            },
          },
        ],
      ]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    }).get("g1")?.release;
    expect(release?.inFlight).toBeUndefined();
    expect(release?.gate).toEqual({ allowed: true });
    expect(release?.suggestion).toBe("v0.1.2");
  });

  // The broker's production deploy of the commit v0.1.1 lists, read through the
  // stage that runs it; production still runs the old commit. Newest first, as
  // Gitea sends a commit's statuses.
  function flowWithProductionStatuses(
    production: ReadonlyArray<{
      readonly state: "pending" | "success" | "failure";
      readonly created_at?: string;
    }>,
    productionRuns: string = RUNNING,
  ) {
    return joinProjectFlows({
      groups: GROUPS,
      deploys: new Map([
        [
          "g1",
          {
            ...deployState(),
            environments: [
              {
                projectId: "stage-1",
                name: "harbor stage",
                tier: "stage" as const,
                sources: ["main"],
                environment: "stage",
                services: [
                  {
                    hostname: "app",
                    appVersionName: MERGED,
                    statuses: [
                      { context: "mate/deploy/stage/app", state: "success" as const },
                      ...production.map((status) => ({
                        ...status,
                        context: "mate/deploy/production/app",
                      })),
                    ],
                  },
                ],
              },
              {
                projectId: "prod-1",
                name: "harbor production",
                tier: "production" as const,
                sources: "release" as const,
                environment: "production",
                services: [{ hostname: "app", appVersionName: productionRuns }],
              },
            ],
            mainHeads: new Map([["app", MERGED]]),
          },
        ],
      ]),
      forges: new Map([
        [
          "g1",
          {
            ...forgeState(),
            released: {
              releases: [
                {
                  tag: "v0.1.1",
                  verdict: "approved",
                  detail: undefined,
                  line: "",
                  entries: [{ service: "app", commit: MERGED }],
                  taggedAt: "2026-09-24T10:00:00Z",
                },
                {
                  tag: "v0.1.0",
                  verdict: "approved",
                  detail: undefined,
                  line: "",
                  entries: [{ service: "app", commit: RUNNING }],
                  taggedAt: undefined,
                },
              ],
              tags: ["v0.1.0", "v0.1.1"],
              newest: {
                tag: "v0.1.1",
                verdict: "approved",
                entries: [{ service: "app", commit: MERGED }],
                taggedAt: "2026-09-24T10:00:00Z",
              },
            },
          },
        ],
      ]),
      mayRelease: true,
      nowMs: NOW,
      withheld: NOTHING_WITHHELD,
      failures: NO_FAILURES,
    }).get("g1");
  }
  const releaseWithProductionStatuses = (
    production: Parameters<typeof flowWithProductionStatuses>[0],
  ) => flowWithProductionStatuses(production)?.release;

  const rowsOf = (flow: ReturnType<typeof flowWithProductionStatuses>) =>
    flow?.releases.map(({ tag, standing, word, rollBack }) => ({ tag, standing, word, rollBack }));

  it.each([
    {
      name: "the release production runs reads Live; the newer one is not a state it was in yet",
      statuses: [{ state: "pending" as const, created_at: "2026-09-24T10:01:00Z" }],
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "the newest's production deploy failed after its tag: it reads Deploy failed",
      statuses: [{ state: "failure" as const, created_at: "2026-09-24T10:01:00Z" }],
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "production moved to the newest: it reads Live, the earlier one offers a roll-back",
      statuses: [{ state: "success" as const, created_at: "2026-09-24T10:01:00Z" }],
      runs: MERGED,
      rows: [
        { tag: "v0.1.1", standing: "live", word: "Live", rollBack: false },
        { tag: "v0.1.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
  ])("$name", ({ statuses, runs, rows }) => {
    expect(rowsOf(flowWithProductionStatuses(statuses, runs))).toEqual(rows);
  });

  it("an approved tag whose production deploy failed is not in flight; Release is offered again", () => {
    const release = releaseWithProductionStatuses([
      { state: "failure", created_at: "2026-09-24T10:01:00Z" },
    ]);
    expect(release?.inFlight).toBeUndefined();
    expect(release?.gate).toEqual({ allowed: true });
  });

  it("an old production failure does not end the hold of a retry release of the same commit", () => {
    const release = releaseWithProductionStatuses([
      { state: "pending", created_at: "2026-09-24T10:01:00Z" },
      { state: "failure", created_at: "2026-09-24T09:00:00Z" },
    ]);
    expect(release?.inFlight).toBe("v0.1.1");
  });
  it.each([
    {
      name: "a failure newer than the tag ends the hold",
      created_at: "2026-09-24T10:01:00Z",
      inFlight: undefined,
    },
    {
      name: "a failure older than the tag does not end the hold",
      created_at: "2026-09-24T09:59:00Z",
      inFlight: "v0.1.1",
    },
    {
      name: "a failure whose time is not read does not end the hold",
      created_at: undefined,
      inFlight: "v0.1.1",
    },
  ])("$name", ({ created_at, inFlight }) => {
    const release = releaseWithProductionStatuses([
      { state: "failure", ...(created_at === undefined ? {} : { created_at }) },
    ]);
    expect(release?.inFlight).toBe(inFlight);
  });
});
