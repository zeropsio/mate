/**
 * A surface following several projects' processes holds each one's reads while it follows it: a
 * project joining or leaving takes or lets go of its own leases only, never the others'.
 */
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  projectKeyOf,
  type ProjectRef,
} from "@t3tools/client-runtime/zerops/data";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Inventory } from "../inventoryContext";
import { useProjectsProcesses } from "./useProjectsProcesses";

const organization = {
  kind: "organization" as const,
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make("org-1"),
};
const ref = (projectId: string): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(projectId),
});

const leases = vi.hoisted(() => ({
  /** Each hold held now, as `listing project`. */
  held: [] as Array<string>,
  /** Every hold taken, in order. */
  taken: [] as Array<string>,
}));
vi.mock("../ZeropsAccountData", () => {
  // The account's data layer: one object for the account's life, as the real one is.
  const data = {
    orgId: "org-1",
    demandDetail: (demand: { readonly listing?: string; readonly ownerId: string }) => {
      const name = `${demand.listing} ${demand.ownerId}`;
      leases.held.push(name);
      leases.taken.push(name);
      return () => void leases.held.splice(leases.held.indexOf(name), 1);
    },
  };
  return {
    useAccountDataOptional: () => data,
    useAccountOrgId: () => data.orgId,
    useProjection: () => ({}),
  };
});
vi.mock("../inventoryContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsInventory: () =>
    ({
      projectRefs: new Map(["p-ada", "p-cy"].map((id) => [projectKeyOf(ref(id)), ref(id)])),
      authority: new Map(),
    }) as unknown as Inventory,
}));

function Probe({ projectIds }: { readonly projectIds: ReadonlyArray<string> }) {
  useProjectsProcesses(projectIds);
  return null;
}

let tree: ReactTestRenderer | undefined;
const render = async (projectIds: ReadonlyArray<string>) => {
  await act(async () => {
    if (tree === undefined) tree = create(createElement(Probe, { projectIds }));
    else tree.update(createElement(Probe, { projectIds }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  leases.held = [];
  leases.taken = [];
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("useProjectsProcesses", () => {
  it("takes only a newly followed project's reads and lets go only those of one no longer followed", async () => {
    await render(["p-ada"]);
    await render(["p-ada", "p-cy"]);
    await render(["p-cy"]);
    expect(leases.taken).toEqual(["history p-ada", "history p-cy"]);
    expect(leases.held).toEqual(["history p-cy"]);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(leases.held).toEqual([]);
  });
});
