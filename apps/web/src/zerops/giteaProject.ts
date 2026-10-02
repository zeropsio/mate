/**
 * The account's Gitea project, found in the inventory once and read the same
 * way everywhere.
 *
 * What an organization made before its HQ still holds there — its groups' Git,
 * the broker, the deploy keys — is read from it until those move into HQ
 * (T7–T11); an organization whose HQ was born with its first project has none.
 * The URL and the broker's URL are derived from the project and its services
 * rather than guessed, so an account on a devel region or behind a custom
 * domain is read.
 */

import {
  deriveGiteaState,
  readZeropsToolKind,
  type ZeropsGiteaState,
} from "@t3tools/client-runtime/zerops";
import { useContext, useMemo } from "react";

import { useHeldThroughBlink } from "./heldThroughBlink";
import { HeldInventoryContext, type Inventory } from "./inventoryContext";

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
 * The account's Gitea in the org, from the inventory as held: a grant that withholds the Gitea
 * project must not end the wiring that rests on it — its session and its reads (DESIGN law 5,
 * M7). What it finds drives wiring; nothing renders its project from it.
 */
export function useAccountGitea(clientId: string | undefined): AccountGitea | undefined {
  const held = useContext(HeldInventoryContext);
  const found = useMemo(() => findAccountGitea(held, clientId), [clientId, held]);
  // The inventory loses the Gitea project for a moment when its socket is replaced: the Gitea
  // session and every project's reads rest on this, so a blink must not end them
  // (`heldThroughBlink.ts`). No inventory at all is no scope — signed out — and holds nothing.
  return useHeldThroughBlink(found, held === null ? undefined : (clientId ?? ""));
}
