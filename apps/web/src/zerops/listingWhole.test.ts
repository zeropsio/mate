import { projectsNeverSeen } from "@t3tools/client-runtime/zerops/account/runtime";
import type { CollectionRead, ProjectRecord } from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { listingWholeForPerson } from "./listingWhole";

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
