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
  releaseContents: [],
});

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
              releases: [{ tag: "v0.1.0", verdict: "approved", detail: undefined, line: "" }],
              tags: ["v0.1.0"],
              failure: "Gitea did not answer",
            },
          },
        ],
      ]),
      mayRelease: true,
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
      withheld,
      failures: NO_FAILURES,
    });
    const release = flows.get("g1")?.release;
    expect(release?.gate).toEqual(gate);
    expect(
      release?.contents.flatMap(({ commits }) => commits.map(({ subject }) => subject)),
    ).toEqual(carried);
  });
});
