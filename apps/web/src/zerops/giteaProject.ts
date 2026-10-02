/**
 * The account's Gitea project, found in the inventory once and read the same
 * way everywhere.
 *
 * Three screens need it — the projects page (every Mate's credential), the
 * consent page (which brokers are really this account's) and *Add project*
 * (where the registry lives) — and each used to find it for itself. The URL and
 * the broker's URL are derived from the project and its services rather than
 * guessed, so an account on a devel region or behind a custom domain is read.
 */

import {
  deriveGiteaState,
  readZeropsToolKind,
  type ZeropsGiteaState,
  type ZeropsService,
} from "@t3tools/client-runtime/zerops";
import { useContext, useMemo } from "react";

import { useHeldThroughBlink } from "./heldThroughBlink";
import { HeldInventoryContext, InventoryContext, type Inventory } from "./inventoryContext";

export interface AccountGitea {
  readonly state: ZeropsGiteaState;
  /** Where the registry lives — the Gitea project's own id. */
  readonly projectId: string;
  readonly clientId: string | undefined;
}

/**
 * The account's Gitea, or `undefined` while there is none this session can see
 * — no Gitea project, or its services not read yet.
 *
 * Scoped to one org when asked: an account with two memberships has two
 * Gitea projects, and the registry a group goes into is the active org's.
 */
function findAccountGitea(
  inventory: Pick<Inventory, "projects" | "services"> | null | undefined,
  clientId?: string | undefined,
): AccountGitea | undefined {
  for (const project of inventory?.projects ?? []) {
    if (readZeropsToolKind(project.tagList) !== "gitea") continue;
    if (clientId !== undefined && project.clientId !== clientId) continue;
    const outcome = inventory?.services.get(project.id);
    if (outcome?.status !== "resolved") continue;
    return {
      state: deriveGiteaState(project, outcome.services),
      projectId: project.id,
      clientId: project.clientId,
    };
  }
  return undefined;
}

/**
 * The services of the account's Gitea project in the org, as the inventory holds them — no read of
 * their own: an ACTIVE project's first, a project whose services are unread skipped; `undefined`
 * while it holds no such project with its services read.
 */
export function accountGiteaServices(
  inventory: Pick<Inventory, "projects" | "services"> | null | undefined,
  clientId: string | undefined,
): ReadonlyArray<ZeropsService> | undefined {
  const projects = (inventory?.projects ?? []).filter(
    (project) =>
      readZeropsToolKind(project.tagList) === "gitea" &&
      (clientId === undefined || project.clientId === clientId),
  );
  const ordered = [
    ...projects.filter(({ status }) => status === "ACTIVE"),
    ...projects.filter(({ status }) => status !== "ACTIVE"),
  ];
  for (const project of ordered) {
    const outcome = inventory?.services.get(project.id);
    if (outcome?.status === "resolved") return outcome.services;
  }
  return undefined;
}

/**
 * The services of the account's Gitea project in the org, as the grant shows them — words are
 * drawn from them, so never from what it withholds (DESIGN law 5) — held through a blink of its
 * socket, as `useAccountGitea` holds the project: each group's runner rests on it.
 */
export function useAccountGiteaServices(
  clientId: string | undefined,
): ReadonlyArray<ZeropsService> | undefined {
  const shown = useContext(InventoryContext);
  const found = useMemo(() => accountGiteaServices(shown, clientId), [clientId, shown]);
  return useHeldThroughBlink(found, shown === null ? undefined : (clientId ?? ""));
}

/**
 * The account's Gitea in the org, from the inventory as held: a grant that withholds the Gitea
 * project must not end the wiring that rests on it — its session, the registry, registration
 * (DESIGN law 5, M7). What it finds drives wiring; nothing renders its project from it.
 */
export function useAccountGitea(clientId: string | undefined): AccountGitea | undefined {
  const held = useContext(HeldInventoryContext);
  const found = useMemo(() => findAccountGitea(held, clientId), [clientId, held]);
  // The inventory loses the Gitea project for a moment when its socket is replaced: the registry,
  // the Gitea session and every project's reads rest on this, so a blink must not end them
  // (`heldThroughBlink.ts`). No inventory at all is no scope — signed out — and holds nothing.
  return useHeldThroughBlink(found, held === null ? undefined : (clientId ?? ""));
}

/**
 * Whether the account holds a Gitea project in the org, its services read or not, withheld or
 * not: *Add Gitea* is offered only while it holds none.
 */
export function useAccountHoldsGitea(clientId: string | undefined): boolean {
  const held = useContext(HeldInventoryContext);
  return (
    held !== null &&
    held.projects.some(
      (project) =>
        readZeropsToolKind(project.tagList) === "gitea" &&
        (clientId === undefined || project.clientId === clientId),
    )
  );
}
