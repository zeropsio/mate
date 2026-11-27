import type { HqOperation } from "@t3tools/client-runtime/zerops/hq";
import { expect, it } from "vite-plus/test";
import { applicationSetupOf, mateLinks, projectSitesStatus } from "./SidebarProjectSites.logic.ts";

const AT = "2026-11-23T10:00:00.000Z";
const operation = (kind: string, more: Partial<HqOperation> = {}): HqOperation => ({
  id: "op-1",
  kind,
  phase: "accepted",
  at: AT,
  acceptedAt: AT,
  ...more,
});
const lapsed = { step: "grants", code: "token_expired", at: AT, origin: "zerops" };

// witness: apps/web/src/components/zerops/SidebarProjectSites.logic.ts | return standing === "going" || standing === "waiting"; → return standing === "going";
it("MN26: A project's menu row says Setting up while HQ's frame shows its application adding a stage or a production or setting up a deploy key, open or waiting on its maker, and says nothing of it once it failed, of Put it live, or of none; breaks: a second device's menu shows no stage being added", () => {
  const cases: ReadonlyArray<readonly [HqOperation | undefined, string | undefined]> = [
    [operation("environment"), "An environment is being set up"],
    [
      operation("environment", { failure: lapsed, continueBy: "u-1" }),
      "An environment is being set up",
    ],
    [operation("deploy_key", { phase: "key_requested" }), "Its deploy key is being set up"],
    [operation("environment", { failure: { ...lapsed, code: "projectLimitReached" } }), undefined],
    [operation("put_live"), undefined],
    [operation("app_deletion"), undefined],
    [undefined, undefined],
  ];
  for (const [shown, sentence] of cases) {
    const status = projectSitesStatus({
      prodChip: undefined,
      stageChip: undefined,
      line: undefined,
      landing: undefined,
      setup: applicationSetupOf(shown),
    });
    expect(status?.sentence, JSON.stringify(shown)).toBe(sentence);
    if (sentence !== undefined) expect(status?.word).toBe("Setting up");
  }
});

// witness: apps/web/src/components/zerops/SidebarProjectSites.logic.ts | part.pooled ? [] : part.dev.length === 0 → part.pooled ? part.dev : part.dev.length === 0
it("MN114: Sites lists a pool part's stage address but never its leased workspaces; breaks: a person keeps a pool address that ends when the lease does.", () => {
  const mate = {
    projectId: "mate",
    name: "Mate",
    owner: undefined,
    routes: [
      { service: "webstage", url: "https://stage.example", host: "stage.example", port: 443 },
    ],
    hostnames: ["webpool", "webstage"],
    controlPlane: undefined,
    pools: ["webpool"],
    poolPairs: [{ pool: "webpool", stages: [{ hostname: "webstage" }] }],
    leases: [
      {
        alias: "webpool-1",
        pool: "webpool",
        state: "held",
        devServers: [{ name: "web", status: "running", url: "https://slot.example", readAt: AT }],
      },
    ],
  };
  expect(mateLinks(mate)?.services.map((row) => [row.service, row.url])).toEqual([
    ["webstage", "https://stage.example"],
  ]);
});
