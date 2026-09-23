import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type ProjectRef,
  type ScopeAuthority,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import {
  conversationAccess,
  inventoryProjectRefKey,
  projectAuthority,
  withheldProjectNotice,
  withheldProjectNotices,
  type Inventory,
} from "./inventoryContext";

const ref: ProjectRef = {
  kind: "project",
  organization: {
    kind: "organization",
    account: {
      apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
      accountId: ZeropsAccountId.make("account"),
    },
    organizationId: ZeropsOrganizationId.make("org"),
  },
  projectId: ZeropsProjectId.make("p1"),
};

const AUTHORIZED: ScopeAuthority = { kind: "authorized" };
const LAPSED: ScopeAuthority = { kind: "withheld", reason: "access-lapsed", cause: null };

const inventory = (
  authority: ScopeAuthority | null,
  account: ScopeAuthority = AUTHORIZED,
  lost: ReadonlyArray<string> = [],
): Inventory => ({
  projects: [],
  services: new Map(),
  isLoading: false,
  error: null,
  projectRefs: new Map([[inventoryProjectRefKey(ref), ref]]),
  authority: authority === null ? new Map() : new Map([[inventoryProjectRefKey(ref), authority]]),
  account,
  lost: new Set(lost),
});

describe("withheldProjectNotice", () => {
  it.each([
    ["no authority published yet", null, "p1", null],
    ["an authorized project", { kind: "authorized" }, "p1", null],
    [
      "a project without fresh evidence",
      { kind: "withheld", reason: "access-unverified", cause: null },
      "p1",
      "Checking your access to this project…",
    ],
    [
      "a project a read was refused",
      { kind: "withheld", reason: "access-denied", cause: null },
      "p1",
      "Your access to this project changed.",
    ],
    [
      "a project the inventory does not hold",
      { kind: "withheld", reason: "access-unverified", cause: null },
      "other",
      null,
    ],
  ] as const)("%s", (_case, authority, projectId, notice) => {
    expect(withheldProjectNotice(inventory(authority), projectId)).toBe(notice);
  });

  // DESIGN §3.4: a lapse withholds every project, with one app banner and no per-row words.
  it("says nothing per project while a lapse withholds them all", () => {
    expect(withheldProjectNotice(inventory(AUTHORIZED, LAPSED), "p1")).toBeNull();
    expect(withheldProjectNotices(inventory(LAPSED, LAPSED))).toEqual([]);
  });

  // Gate F: one cause-only sentence per withheld region. Two projects withheld for the same
  // cause read as one sentence, not as the same sentence twice with nothing to tell them apart.
  it("says each cause once, however many projects it withholds", () => {
    const refOf = (projectId: string): ProjectRef => ({
      ...ref,
      projectId: ZeropsProjectId.make(projectId),
    });
    const withheld = (reason: "access-unverified" | "access-denied"): ScopeAuthority => ({
      kind: "withheld",
      reason,
      cause: null,
    });
    const refs = ["p1", "p2", "p3"].map(refOf);
    expect(
      withheldProjectNotices({
        ...inventory(null),
        projectRefs: new Map(refs.map((entry) => [inventoryProjectRefKey(entry), entry])),
        authority: new Map([
          [inventoryProjectRefKey(refs[0]!), withheld("access-unverified")],
          [inventoryProjectRefKey(refs[1]!), withheld("access-denied")],
          [inventoryProjectRefKey(refs[2]!), withheld("access-unverified")],
        ]),
      }),
    ).toEqual(["Checking your access to this project…", "Your access to this project changed."]);
  });

  it("says why a project withheld alone is not shown", () => {
    expect(
      withheldProjectNotices(
        inventory({ kind: "withheld", reason: "access-unverified", cause: null }),
      ),
    ).toEqual(["Checking your access to this project…"]);
  });
});

describe("projectAuthority and conversationAccess", () => {
  it.each([
    ["a verified project", inventory(AUTHORIZED), AUTHORIZED, AUTHORIZED],
    ["a lapse, over the project's own authority", inventory(AUTHORIZED, LAPSED), LAPSED, LAPSED],
    [
      "a denial awaiting its confirming read",
      inventory({ kind: "withheld", reason: "access-denied", cause: null }),
      { kind: "withheld", reason: "access-denied", cause: null },
      { kind: "withheld", reason: "access-denied", cause: null },
    ],
    ["a confirmed loss", inventory(null, AUTHORIZED, ["p1"]), AUTHORIZED, { kind: "lost" }],
  ] as const)("%s", (_case, held, authority, access) => {
    expect(projectAuthority(held, "p1")).toEqual(authority);
    expect(conversationAccess(held, "p1")).toEqual(access);
  });
});
