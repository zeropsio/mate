/**
 * What a person is offered of an application's changes, as `useChangeOffers` asks HQ's rule over
 * the facts the client holds: the session's membership, the projects the inventory lists, and the
 * projects HQ places in the application — and nothing said while either is not known.
 */
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { hqStructureAtom, zeropsSessionAtom } from "../state/zerops";
import { InventoryContext, type Inventory } from "./inventoryContext";
import { ZeropsSessionContext } from "./sessionContext";
import {
  useChangeOffers,
  useReleasePermission,
  type ZeropsChangeOffersOf,
} from "./useChangeOffers";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";

const MEMBERSHIP = "member-ada";

const mounted: ReactTestRenderer[] = [];
/** What the hook handed back, render by render. */
const seen: unknown[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  seen.length = 0;
});

function Probe({ use }: { readonly use: () => unknown }) {
  seen.push(use());
  return null;
}

interface Facts {
  readonly roleCode: string;
  readonly grants: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>;
  readonly placed: boolean;
  readonly listed?: boolean;
}

/** The hook's answer, with the session's role, the grants listed, and HQ's structure where `placed`. */
function offersOf(input: Facts): ZeropsChangeOffersOf {
  return answerOf(input, useChangeOffers);
}

/** `use`'s answer over the same facts: HQ places a Mate, a stage and a production in the application. */
function answerOf<T>(input: Facts, use: () => T): T {
  const registry = AtomRegistry.make();
  registry.set(zeropsSessionAtom, {
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: { organizationId: "org-acme" },
  } as never);
  if (input.placed) {
    registry.set(hqStructureAtom, {
      organizationId: "org-acme",
      structure: {
        ungrouped: [],
        apps: [
          {
            id: "app-shop",
            name: "Shop",
            projects: [
              { projectId: "p-mate", kind: "mate", mate: null },
              { projectId: "p-stage", kind: "stage", mate: null },
              { projectId: "p-prod", kind: "production", mate: null },
            ],
          },
        ],
      },
      changes: null,
      releaseRevisions: null,
      readAt: 1_000,
      current: true,
      unavailableSince: null,
    } as never);
  }
  const session = {
    user: { id: "user-ada" },
    activeOrganization: { membershipId: MEMBERSHIP, roleCode: input.roleCode },
  } as unknown as ZeropsSessionValue;
  const inventory = {
    isLoading: input.listed === false,
    projects: input.grants.map(({ projectId, roleCode }) => ({
      id: projectId,
      userRoles: [{ clientUserId: MEMBERSHIP, roleCode }],
    })),
  } as unknown as Inventory;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(
      create(
        <RegistryContext.Provider value={registry}>
          <ZeropsSessionContext.Provider value={session}>
            <InventoryContext.Provider value={inventory}>
              <Probe use={use} />
            </InventoryContext.Provider>
          </ZeropsSessionContext.Provider>
        </RegistryContext.Provider>,
      ),
    );
  });
  if (seen.length === 0) throw new Error("the probe never rendered");
  return seen.at(-1) as T;
}

describe("useChangeOffers", () => {
  it.each([
    {
      who: "a Read only member of the organization",
      roleCode: "READ_ONLY",
      grants: [],
      want: { read: true, comment: true, merge: false, close: false, redeploy: false },
    },
    {
      who: "a No access member with Basic user on the application's stage",
      roleCode: "NO_ACCESS",
      grants: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
      want: { read: true, comment: true, merge: true, close: true, redeploy: true },
    },
    {
      who: "a No access member with only Read only on its projects",
      roleCode: "NO_ACCESS",
      grants: [
        { projectId: "p-mate", roleCode: "READ_ONLY" },
        { projectId: "p-stage", roleCode: "READ_ONLY" },
      ],
      want: { read: false, comment: false, merge: false, close: false, redeploy: false },
    },
  ])("offers $who what HQ's rule allows", ({ roleCode, grants, want }) => {
    expect(offersOf({ roleCode, grants, placed: true })("app-shop")).toEqual(want);
  });

  it("says nothing while HQ has not placed the projects", () => {
    expect(offersOf({ roleCode: "READ_ONLY", grants: [], placed: false })("app-shop")).toBe(
      undefined,
    );
  });

  // An inventory still read lists no grant yet: a No access member's Basic user on the stage is
  // not known to be missing.
  it("says nothing while the projects are still being listed", () => {
    expect(
      offersOf({ roleCode: "NO_ACCESS", grants: [], placed: true, listed: false })("app-shop"),
    ).toBe(undefined);
  });
});

describe("useReleasePermission", () => {
  it.each([
    {
      who: "a No access member with Basic user on its production",
      roleCode: "NO_ACCESS",
      grants: [{ projectId: "p-prod", roleCode: "BASIC_USER" }],
      want: { allowed: true },
    },
    {
      who: "a Read only member of the organization, in HQ's words",
      roleCode: "READ_ONLY",
      grants: [],
      want: {
        allowed: false,
        reason: "You need at least Basic user access to this project's production to release it.",
      },
    },
  ])("decides for $who by HQ's rule", ({ roleCode, grants, want }) => {
    const permission = answerOf({ roleCode, grants, placed: true }, useReleasePermission);
    expect(permission("app-shop")).toEqual(want);
  });

  it("says nothing while HQ has not placed the projects", () => {
    const permission = answerOf(
      { roleCode: "READ_ONLY", grants: [], placed: false },
      useReleasePermission,
    );
    expect(permission("app-shop")).toBe(undefined);
  });
});
