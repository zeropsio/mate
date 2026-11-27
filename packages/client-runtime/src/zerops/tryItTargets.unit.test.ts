import { expect, it } from "vite-plus/test";
import { ZeropsStateEnvelope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import recordedLeases from "./fixtures/zcp/envelope.lease-status.json" with { type: "json" };
import recordedClassic from "./fixtures/zcp/envelope.single-pair.json" with { type: "json" };
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

// witness: packages/client-runtime/src/zerops/tryItTargets.ts | lease.branch !== input.branch → false
it("ZV200: A change's Preview opens only a running workspace on its branch and repository, and an unread workspace is not claimed stopped; breaks: a review opens another change's workspace.", () => {
  const cases = [
    {
      input: { ...previewInput, branch: "one" },
      state: "available",
      urls: ["https://one.example"],
    },
    {
      input: { ...previewInput, branch: "two" },
      state: "available",
      urls: ["https://two.example"],
    },
    { input: { ...previewInput, branch: "three" }, state: "not-running", urls: [] },
    { input: { ...previewInput, branch: undefined }, state: "reading", urls: [] },
    { input: { ...previewInput, leases: undefined }, state: "reading", urls: [] },
    {
      input: { ...previewInput, leases: [{ ...previewLeases[0]!, repo: undefined }] },
      state: "reading",
      urls: [],
    },
    {
      input: {
        ...previewInput,
        leases: [{ ...previewLeases[0]!, repo: "https://github.com/example/web" }],
      },
      state: "reading",
      urls: [],
    },
    {
      input: {
        ...previewInput,
        repositoryRemote: "https://github.com/example/web.git",
        leases: [{ ...previewLeases[0]!, repo: "git@github.com:example/web.git" }],
      },
      state: "available",
      urls: ["https://one.example"],
    },
    {
      input: {
        ...previewInput,
        repositoryRemote: "https://github.com/example/other",
        leases: [{ ...previewLeases[0]!, repo: "https://github.com/example/web" }],
      },
      state: "reading",
      urls: [],
    },
    {
      input: { ...previewInput, leases: [{ ...previewLeases[0]!, state: "parked" }] },
      state: "not-running",
      urls: [],
    },
  ] as const;
  for (const { input, state, urls } of cases) {
    const result = tryItTargets(input);
    expect(result.previewState).toBe(state);
    expect(result.previews.map((entry) => entry.url)).toEqual(urls);
  }
  const classic = {
    ...previewInput,
    routes: [
      { service: "webdev", url: "https://classic.example", host: "classic.example", port: 443 },
    ],
    hostnames: ["webdev"],
    pools: [],
    repository: "webdev",
    leases: undefined,
    classicBranch: "one",
    classicServers: [
      { name: "web", status: "running", url: "https://classic.example", readAt: previewAt },
    ],
  };
  const classicCases = [
    { input: classic, state: "available", urls: ["https://classic.example"] },
    { input: { ...classic, branch: "two" }, state: "not-running", urls: [] },
    { input: { ...classic, classicServers: undefined }, state: "reading", urls: [] },
    {
      input: {
        ...classic,
        classicServers: [{ ...classic.classicServers[0]!, status: "stopped" }],
      },
      state: "not-running",
      urls: [],
    },
  ] as const;
  for (const { input, state, urls } of classicCases) {
    const result = tryItTargets(input);
    expect(result.previewState).toBe(state);
    expect(result.previews.map((entry) => entry.url)).toEqual(urls);
  }
  const recorded = Schema.decodeUnknownSync(ZeropsStateEnvelope)(recordedLeases);
  const withoutRunningServer = tryItTargets({
    ...previewInput,
    branch: "feat-a",
    repositoryUrl: "https://github.com/example/weather",
    leases: recorded.leases,
  });
  expect(withoutRunningServer.previewState).toBe("not-running");
  expect(withoutRunningServer.previews).toEqual([]);
  const recordedService = Schema.decodeUnknownSync(ZeropsStateEnvelope)(recordedClassic);
  const fromRecordedService = tryItTargets({
    ...classic,
    repository: "appdev",
    hostnames: ["appdev", "appstage"],
    routes: [
      {
        service: "appdev",
        url: "https://appdev-1df2-3000.prg1.zerops.app",
        host: "appdev-1df2-3000.prg1.zerops.app",
        port: 3000,
      },
    ],
    classicServers: recordedService.services.find((entry) => entry.hostname === "appdev")
      ?.devServers,
  });
  expect(fromRecordedService.previews.map((entry) => entry.url)).toEqual([
    "https://appdev-1df2-3000.prg1.zerops.app",
  ]);
});

// witness: packages/client-runtime/src/zerops/tryItTargets.ts | if (!input.open || input.branch === undefined || lease.branch !== input.branch) return []; → if (input.branch === undefined || lease.branch !== input.branch) return [];
it("ZV202: Only an open change offers its own live workspace; a merged or closed change never does, even while a lease remains visible; breaks: a person opens a workspace after its change ended.", () => {
  const cases = [
    {
      name: "open with a lease",
      input: previewInput,
      urls: ["https://one.example"],
      state: "available",
    },
    {
      name: "open without a lease",
      input: { ...previewInput, leases: [] },
      urls: [],
      state: "not-running",
    },
    {
      name: "merged with a lease",
      input: { ...previewInput, open: false },
      urls: [],
      state: "ended",
    },
    {
      name: "closed with a lease",
      input: { ...previewInput, open: false },
      urls: [],
      state: "ended",
    },
  ] as const;
  for (const { name, input, urls, state } of cases) {
    const result = tryItTargets(input);
    expect(
      result.previews.map((entry) => entry.url),
      name,
    ).toEqual(urls);
    expect(result.previewState, name).toBe(state);
  }
});

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
