import type {
  AccessState,
  CollectionRead,
  Evidence,
  ProjectRecord,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { listingWholeForPerson, projectsNeverSeen } from "./listingWhole";

type Read = Pick<CollectionRead<ProjectRecord>, "query" | "value">;
type Member = Read["value"][number];

const observed = (projectId: string, facets: "read" | "unreadable" = "read"): Member =>
  ({
    knowledge: "observed",
    record: {
      ref: { projectId },
      identity: { knowledge: facets === "read" ? "observed" : "unavailable" },
      lifecycle: { knowledge: "observed" },
    },
  }) as unknown as Member;

const read = (
  members: ReadonlyArray<Member>,
  query: Partial<{ status: string; coverage: unknown; unresolvedMemberKeys: string[] }> = {},
): Read =>
  ({
    query: {
      status: "observed",
      coverage: { kind: "exhausted-traversal", traversedPages: 1, observedTotal: null },
      unresolvedMemberKeys: [],
      ...query,
    },
    value: members,
  }) as unknown as Read;

const NOBODY_WITHHELD = () => false;
const SEES_ALL = projectsNeverSeen({
  evidence: null,
  access: undefined,
  withheld: NOBODY_WITHHELD,
});

describe("listingWholeForPerson — a listing that lacks nothing on its way", () => {
  it.each([
    {
      name: "every project shown",
      read: read([observed("nova"), observed("kai")]),
      shown: ["nova", "kai"],
      whole: true,
    },
    {
      name: "a project this person can never see (NO_ACCESS) left out",
      read: read([observed("nova"), observed("vault")]),
      shown: ["nova"],
      neverSeen: (id: string) => id === "vault",
      whole: true,
    },
    {
      name: "a project only named so far, not admitted yet",
      read: read([observed("nova"), observed("fresh")]),
      shown: ["nova"],
      whole: false,
    },
    {
      name: "a project whose identity can never be read",
      read: read([observed("nova"), observed("broken", "unreadable")]),
      shown: ["nova"],
      whole: true,
    },
    {
      name: "a member unresolved",
      read: read([observed("nova"), { knowledge: "unresolved", ref: {} } as unknown as Member]),
      shown: ["nova"],
      whole: false,
    },
    {
      name: "a member forbidden",
      read: read([
        observed("nova"),
        { knowledge: "unavailable", reason: "forbidden", ref: {} } as unknown as Member,
      ]),
      shown: ["nova"],
      whole: true,
    },
    {
      name: "members still to resolve",
      read: read([observed("nova")], { unresolvedMemberKeys: ["x"] }),
      shown: ["nova"],
      whole: false,
    },
    {
      name: "the list not read yet",
      read: read([], { status: "unresolved" }),
      shown: [],
      whole: false,
    },
    {
      name: "the list's read failed and will run again",
      read: read([observed("nova")], { coverage: { kind: "partial", reason: "read-failed" } }),
      shown: ["nova"],
      whole: false,
    },
    {
      name: "the list read malformed past reading",
      read: read([observed("nova")], { coverage: { kind: "partial", reason: "malformed" } }),
      shown: ["nova"],
      whole: true,
    },
  ])("$name: $whole", ({ read: listRead, shown, neverSeen, whole }) => {
    expect(
      listingWholeForPerson({
        read: listRead,
        shown: new Set(shown),
        neverSeen: neverSeen ?? SEES_ALL,
      }),
    ).toBe(whole);
  });
});

describe("projectsNeverSeen — the projects this person can never see", () => {
  const evidence = {
    projects: new Map([
      ["vault", { access: { role: "NO_ACCESS" } }],
      ["nova", { access: { role: "DEVELOPER" } }],
    ]),
    unverified: new Map([["fresh", { failure: null }]]),
    closedProjects: new Map([
      ["gone", { confirmation: { status: "confirmed" } }],
      ["leaving", { confirmation: { status: "due" } }],
    ]),
  } as unknown as Evidence;
  const access = {
    status: "verified",
    projects: [{ project: { projectId: "made" }, role: "NO_ACCESS" }],
  } as unknown as AccessState;
  const never = projectsNeverSeen({
    evidence,
    access,
    withheld: (id) => id === "leaving",
  });

  it.each([
    { projectId: "vault", never: true },
    { projectId: "gone", never: true },
    { projectId: "made", never: true },
    { projectId: "leaving", never: true },
    { projectId: "nova", never: false },
    { projectId: "fresh", never: false },
    { projectId: "unknown", never: false },
  ])("$projectId: $never", ({ projectId, never: expected }) => {
    expect(never(projectId)).toBe(expected);
  });
});
