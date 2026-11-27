import { expect, it } from "vite-plus/test";
import { tryItTargets } from "./tryItTargets.ts";

const previewAt = "2026-11-26T20:00:00Z";
const previewRepo = "https://hq.example/git/org/app/web.git";
const previewRoutes = [
  { service: "webstage", url: "https://stage.example", host: "stage.example", port: 443 },
];
const previewLeases = [
  {
    alias: "webpool-1",
    pool: "webpool",
    state: "held",
    branch: "one",
    repo: previewRepo,
    devServers: [{ name: "web", status: "running", url: "https://one.example", readAt: previewAt }],
  },
  {
    alias: "webpool-2",
    pool: "webpool",
    state: "held",
    branch: "two",
    repo: previewRepo,
    devServers: [{ name: "web", status: "running", url: "https://two.example", readAt: previewAt }],
  },
  {
    alias: "webpool-3",
    pool: "webpool",
    state: "held",
    branch: "one",
    repo: "https://hq.example/git/org/other/web.git",
    devServers: [
      { name: "web", status: "running", url: "https://other.example", readAt: previewAt },
    ],
  },
];
const previewInput = {
  routes: previewRoutes,
  hostnames: ["webpool", "webstage"],
  pools: ["webpool"],
  controlPlane: undefined,
  tier: undefined,
  repository: "web",
  repositoryUrl: previewRepo,
  repositoryRemote: undefined,
  open: true,
  branch: "one",
  leases: previewLeases,
  classicBranch: undefined,
  classicServers: undefined,
};

// witness: packages/client-runtime/src/zerops/tryItTargets.ts | part.devService !== input.repository && !sameRepository(repositories.get(stage.service)) → part.devService !== input.repository && false
it("ZV203: A routed app stage is offered only for the change's repository, including after its build report leaves; breaks: a merged change loses its app address or opens another repository's app.", () => {
  const tier = `services:
  - hostname: webdev
    type: nodejs@22
    buildFromGit: https://hq.example/git/org/app/web.git
    zeropsSetup: web
  - hostname: webstage
    type: nodejs@22
    buildFromGit: https://hq.example/git/org/app/web.git
    zeropsSetup: web`;
  const input = {
    ...previewInput,
    open: false,
    leases: [],
    tier,
    poolPairs: [{ pool: "webpool", stages: [{ hostname: "webstage" }] }],
  };
  const cases = [
    { name: "merged", input },
    { name: "closed", input },
    { name: "open with a lease", input: { ...input, open: true, leases: previewLeases } },
    { name: "open without a lease", input: { ...input, open: true } },
  ] as const;
  for (const entry of cases)
    expect(
      tryItTargets(entry.input).builds.map((target) => target.url),
      entry.name,
    ).toEqual(["https://stage.example"]);
  expect(
    tryItTargets({
      ...input,
      repositoryUrl: "https://hq.example/git/org/app/other.git",
      repository: "other",
    }).builds,
  ).toEqual([]);
});
