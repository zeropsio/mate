import { expect, it } from "vite-plus/test";
import { draftLook } from "./draftLook.ts";

const repo = "https://hq.example/git/org/app/web.git";
const lease = {
  alias: "webpool-1",
  pool: "webpool",
  state: "held",
  branch: "feature",
  acquiredAt: "2026-11-26T12:00:00Z",
  repo,
} as const;
const base = {
  state: "open" as const,
  branch: "feature",
  repositoryUrl: repo,
  repositoryRemote: undefined,
  leases: [lease],
  classic: null,
};
const held = {
  kind: "openable",
  copy: {
    kind: "lease",
    alias: "webpool-1",
    acquiredAt: "2026-11-26T12:00:00Z",
    branch: "feature",
  },
};

// witness: packages/client-runtime/src/zerops/draftLook.ts | lease.branch !== input.branch → false
it("ZV200: A change offers Open draft only for a held copy of its branch and repository, regardless of its last server observation; breaks: a review opens another change's copy.", () => {
  const cases = [
    { input: base, answer: held },
    { input: { ...base, classic: undefined }, answer: held },
    {
      input: { ...base, leases: [{ ...lease, branch: "other" }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, leases: [{ ...lease, repo: "https://hq.example/git/org/other/web.git" }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, leases: [{ ...lease, repo: undefined }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, repositoryUrl: undefined, repositoryRemote: repo },
      answer: held,
    },
    {
      input: { ...base, leases: [{ ...lease, state: "lost" }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, leases: [{ ...lease, acquiredAt: undefined }] },
      answer: { kind: "unavailable" },
    },
    { input: { ...base, leases: [] }, answer: { kind: "unavailable" } },
    {
      input: {
        ...base,
        leases: [
          {
            ...lease,
            devServers: [{ name: "web", status: "stopped", readAt: "2026-11-26T12:00:00Z" }],
          },
        ],
      },
      answer: held,
    },
    {
      input: { ...base, leases: undefined, classic: { hostname: "webdev", branch: "feature" } },
      answer: {
        kind: "openable",
        copy: { kind: "service", hostname: "webdev", branch: "feature" },
      },
    },
    {
      input: { ...base, leases: [], classic: { hostname: "webdev", branch: "other" } },
      answer: { kind: "unavailable" },
    },
  ] as const;
  for (const { input, answer } of cases) {
    for (const state of ["open", "adding", "merging"] as const)
      expect(draftLook({ ...input, state })).toEqual(answer);
    expect(draftLook({ ...input, state: "merged" })).toEqual({ kind: "added" });
    expect(draftLook({ ...input, state: "closed" })).toEqual({ kind: "discarded" });
  }
});

// witness: packages/client-runtime/src/zerops/draftLook.ts | if (input.state === "merged") return { kind: "added" }; → if (false) return { kind: "added" };
it("ZV202: Only an open or adding change offers its draft; merged and discarded changes say where it ended even while a copy remains visible; breaks: a person opens a draft after its change ended.", () => {
  for (const state of ["open", "adding", "merging"] as const)
    expect(draftLook({ ...base, state })).toEqual(held);
  for (const leases of [undefined, [], [lease]] as const) {
    expect(draftLook({ ...base, state: "merged", leases })).toEqual({ kind: "added" });
    expect(draftLook({ ...base, state: "closed", leases })).toEqual({ kind: "discarded" });
  }
});

// witness: packages/client-runtime/src/zerops/draftLook.ts | lease.branch !== input.branch || → lease.unverified === true || lease.branch !== input.branch ||
it("ZV212: A held copy remains openable when parked, unmounted or unverified; breaks: a person cannot ask zcp to open a held copy that needs its answer.", () => {
  for (const state of ["held", "parked", "unmounted"] as const) {
    for (const unverified of [false, true]) {
      expect(draftLook({ ...base, leases: [{ ...lease, state, unverified }] })).toEqual(held);
    }
  }
});
