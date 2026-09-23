import {
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  type ProjectRef,
  type ScopeAuthority,
} from "@t3tools/client-runtime/zerops/data";
import { describe, expect, it } from "vite-plus/test";

import { inventoryProjectRefKey, withheldProjectNotice, type Inventory } from "./inventoryContext";

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

const inventory = (authority: ScopeAuthority | null): Inventory => ({
  projects: [],
  services: new Map(),
  isLoading: false,
  error: null,
  projectRefs: new Map([[inventoryProjectRefKey(ref), ref]]),
  authority: authority === null ? new Map() : new Map([[inventoryProjectRefKey(ref), authority]]),
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
});
