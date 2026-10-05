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
  type RuntimeInterestDescriptor,
} from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
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
  /** Each lease held now, as `kind project`. */
  held: [] as Array<string>,
  /** Every lease taken, in order. */
  taken: [] as Array<string>,
}));
vi.mock("../zeropsDataContext", () => {
  // The account's runtime: one object for the account's life, as the real one is.
  const data = {
    runtime: {
      acquire: (descriptor: RuntimeInterestDescriptor) => {
        const name = `${descriptor.kind} ${"project" in descriptor ? descriptor.project.projectId : ""}`;
        return Effect.acquireRelease(
          Effect.sync(() => {
            leases.held.push(name);
            leases.taken.push(name);
          }),
          () =>
            Effect.sync(() => {
              leases.held.splice(leases.held.indexOf(name), 1);
            }),
        );
      },
      reads: { activity: () => null },
    },
  };
  return {
    useZeropsData: () => data,
    useZeropsAtomSelections: () => new Map(),
  };
});
vi.mock("../inventoryContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsInventory: () =>
    ({
      projectRefs: new Map(["p-ada", "p-cy"].map((id) => [projectKeyOf(ref(id)), ref(id)])),
      authority: new Map(),
      account: { kind: "authorized" },
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
    expect(leases.taken).toEqual([
      "project-activity p-ada",
      "project-process-history p-ada",
      "project-activity p-cy",
      "project-process-history p-cy",
    ]);
    expect(leases.held).toEqual(["project-activity p-cy", "project-process-history p-cy"]);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(leases.held).toEqual([]);
  });
});
