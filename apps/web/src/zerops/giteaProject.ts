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
} from "@t3tools/client-runtime/zerops";

import type { Inventory } from "./inventoryContext";

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
export function findAccountGitea(
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
