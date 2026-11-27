import { expect, it } from "vite-plus/test";
import { partLook } from "./partLook.ts";

const webRepo = "https://hq.example/git/org/app/web.git";
const tinyRepo = "https://hq.example/git/org/app/tiny.git";
const at = "2026-11-27T12:00:00Z";
const routes = [
  { service: "webstage", url: "https://web.example", host: "web.example", port: 443 },
  { service: "tinystage", url: "https://tiny.example", host: "tiny.example", port: 443 },
];
const tier = `services:
  - hostname: webstage
    type: nodejs@22
    buildFromGit: ${webRepo}
    zeropsSetup: web
  - hostname: tinystage
    type: nodejs@22
    buildFromGit: ${tinyRepo}
    zeropsSetup: tiny`;
const pooled = {
  project: {
    routes,
    hostnames: ["webpool", "webstage", "tinypool", "tinystage"],
    pools: ["webpool", "tinypool"],
    controlPlane: undefined,
  },
  tier,
  repository: "tiny",
  repositoryUrl: tinyRepo,
  repositoryRemote: undefined,
  poolPairs: [
    { pool: "webpool", stages: [{ hostname: "webstage" }] },
    { pool: "tinypool", stages: [{ hostname: "tinystage" }] },
  ],
  state: "open" as const,
  mateGone: false,
  branch: "c1",
  leases: [
    {
      alias: "webpool-1",
      pool: "webpool",
      state: "held",
      branch: "c1",
      acquiredAt: at,
      repo: webRepo,
    },
    {
      alias: "tinypool-1",
      pool: "tinypool",
      state: "held",
      branch: "c1",
      acquiredAt: at,
      repo: tinyRepo,
    },
  ],
  classic: { branch: undefined },
};
const classic = {
  ...pooled,
  project: {
    routes,
    hostnames: ["webdev", "webstage", "tinydev", "tinystage"],
    pools: [],
    controlPlane: undefined,
  },
  tier: undefined,
  repository: "webdev",
  repositoryUrl: "https://hq.example/git/org/app/webdev.git",
  poolPairs: [],
  leases: [],
  classic: { branch: "c1" },
};

// witness: packages/client-runtime/src/zerops/partLook.ts | part.devService === input.repository && !part.pooled → !part.pooled
it("ZV214: Try it for a change offers only its own repository's part: Your app is that part's stage and the Draft that part's working copy, never another part's stage or dev; breaks: a change in a two-part project opens the other part's app or dev", () => {
  expect(partLook(pooled)).toEqual({
    app: [{ service: "tinystage", url: "https://tiny.example" }],
    draft: {
      kind: "openable",
      copy: { kind: "lease", alias: "tinypool-1", acquiredAt: at, branch: "c1" },
    },
  });
  expect(partLook(classic)).toEqual({
    app: [{ service: "webstage", url: "https://web.example" }],
    draft: { kind: "openable", copy: { kind: "service", hostname: "webdev", branch: "c1" } },
  });
});

// witness: packages/client-runtime/src/zerops/draftLook.ts | ...withState(lease.copyState), → ...withState(undefined),
it("ZV215: A change's Draft carries the state zcp last wrote for its copy, and a state this build does not know draws as none; breaks: a person sees a stopped, failed or lost Draft as if it ran", () => {
  const cases = [
    ["parked", "parked"],
    ["starting", "starting"],
    ["running", "running"],
    ["stopped", "stopped"],
    ["failed", "failed"],
    ["unknown", "unknown"],
    ["sleeping", undefined],
    [undefined, undefined],
  ] as const;
  for (const [copyState, state] of cases) {
    const leases = pooled.leases.map((lease) => ({ ...lease, copyState }));
    const draft = partLook({ ...pooled, leases }).draft;
    expect(draft.kind === "openable" ? draft.state : "none", String(copyState)).toBe(state);
  }
  const draft = partLook({ ...classic, classic: { branch: "c1", copyState: "failed" } }).draft;
  expect(draft.kind === "openable" ? draft.state : "none").toBe("failed");
});
