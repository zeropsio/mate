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
it("ZV200: A change offers Open draft only for a verified copy of its branch and repository, regardless of its last server observation; breaks: a review opens another change's copy.", () => {
  const cases = [
    { input: base, answer: held },
    { input: { ...base, branch: undefined }, answer: { kind: "reading" } },
    { input: { ...base, leases: undefined }, answer: { kind: "reading" } },
    { input: { ...base, repositoryUrl: undefined, leases: [] }, answer: { kind: "reading" } },
    {
      input: { ...base, leases: [{ ...lease, branch: "other" }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, leases: [{ ...lease, repo: "https://hq.example/git/org/other/web.git" }] },
      answer: { kind: "unavailable" },
    },
    { input: { ...base, leases: [{ ...lease, repo: undefined }] }, answer: { kind: "reading" } },
    {
      input: { ...base, leases: [{ ...lease, unverified: true }] },
      answer: { kind: "unavailable" },
    },
    {
      input: { ...base, leases: [{ ...lease, state: "parked" }] },
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
      input: { ...base, leases: [], classic: { hostname: "webdev", branch: "feature" } },
      answer: {
        kind: "openable",
        copy: { kind: "service", hostname: "webdev", branch: "feature" },
      },
    },
    {
      input: { ...base, leases: [], classic: { hostname: "webdev", branch: undefined } },
      answer: { kind: "reading" },
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

// witness: packages/client-runtime/src/zerops/draftLook.ts | (input.repositoryUrl === undefined && input.repositoryRemote === undefined) → false
it("ZV+1: A draft's availability is unknown until its branch, copies and repository have been read; breaks: a draft whose repository is still unread is reported unavailable.", () => {
  for (const input of [
    { ...base, branch: undefined },
    { ...base, leases: undefined },
    { ...base, classic: undefined },
    { ...base, repositoryUrl: undefined, repositoryRemote: undefined, leases: [] },
  ]) {
    expect(draftLook(input)).toEqual({ kind: "reading" });
  }
  expect(draftLook({ ...base, leases: [] })).toEqual({ kind: "unavailable" });
});
