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

  it("lists each project withheld alone once", () => {
    expect(
      withheldProjectNotices(
        inventory({ kind: "withheld", reason: "access-unverified", cause: null }),
      ),
    ).toEqual([{ projectId: "p1", notice: "Checking your access to this project…" }]);
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
