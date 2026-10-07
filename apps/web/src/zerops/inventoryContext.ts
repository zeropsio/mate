import { createContext, useContext, useMemo } from "react";

import { useDialogState } from "./useDialogState";

import type { InventoryTroubleVoice } from "./inventoryTrouble.logic";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  projectKeyOf,
  type ProjectRef,
  type ScopeAuthority,
} from "@t3tools/client-runtime/zerops/data";
import type { ConversationAccess } from "@t3tools/client-runtime/zerops/environments";
import { knownPresentation, type KnownSurface } from "@t3tools/client-runtime/zerops/knowledge";

import { inventoryCandidates } from "@t3tools/client-runtime/data";
import { useAccountData } from "./ZeropsAccountData";
import { useZeropsData } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { Atom } from "effect/unstable/reactivity";
import { useAtomValue } from "@effect/atom-react";

export interface Inventory {
  /**
   * Projects whose source access projection allows them to be shown. A withheld project's
   * identity stays in `projectRefs` while its protected content stays out of this list.
   */
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Operable, account-scoped identities used to filter every shared projection. */
  readonly projectRefs: ReadonlyMap<string, ProjectRef>;
  /** Each project's source access at the read, by `inventoryProjectRefKey`. */
  readonly authority: ReadonlyMap<string, ScopeAuthority>;
  /** Projects whose source denied access, by project id. */
  readonly lost: ReadonlySet<string>;
}

/**
 * What the account's product publishes of its inventory for the derived atoms (`state/zerops.ts`):
 * the projection without the round's loading and error words.
 */
export type InventoryProjection = Pick<Inventory, "projects" | "projectRefs" | "authority">;

export function inventoryProjectRefKey(ref: ProjectRef): string {
  return projectKeyOf(ref);
}

export function findInventoryProjectRef(
  inventory: Pick<Inventory, "projectRefs">,
  projectId: string,
  organizationId?: string,
): ProjectRef | null {
  const matches = [...inventory.projectRefs.values()].filter(
    (ref) =>
      ref.projectId === projectId &&
      (organizationId === undefined || ref.organization.organizationId === organizationId),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
const PROJECT_SURFACE: KnownSurface<never> = {
  subject: "this project",
  entity: "project",
  source: "zerops",
  checking: null,
  negative: null,
};

const AUTHORIZED: ScopeAuthority = { kind: "authorized" };

/**
 * A project's source access at the read. Operations perform their own admission when pressed.
 */
export function projectAuthority(
  inventory: Pick<Inventory, "authority" | "projectRefs">,
  projectId: string,
): ScopeAuthority {
  const ref = findInventoryProjectRef(inventory, projectId);
  return (
    (ref === null ? undefined : inventory.authority.get(inventoryProjectRefKey(ref))) ?? AUTHORIZED
  );
}

/** The access the route's conversation of this project stands on (DESIGN §9 C1b). */
export function conversationAccess(inventory: Inventory, projectId: string): ConversationAccess {
  return inventory.lost.has(projectId) ? { kind: "lost" } : projectAuthority(inventory, projectId);
}

/**
 * What a project's region says while its source withholds content; null while it may be shown.
 */
export function withheldProjectNotice(inventory: Inventory, projectId: string): string | null {
  const authority = projectAuthority(inventory, projectId);
  if (authority.kind !== "withheld") return null;
  return (
    knownPresentation(
      { state: "withheld", reason: authority.reason, cause: authority.cause },
      PROJECT_SURFACE,
      { nowMs: Date.now(), updateOffered: false },
    ).message?.text ?? null
  );
}

/**
 * Why withheld projects are not shown: each source reason once, however many projects it affects.
 */
export function withheldProjectNotices(inventory: Inventory): ReadonlyArray<string> {
  const notices = new Set<string>();
  for (const { projectId } of inventory.projectRefs.values()) {
    const notice = withheldProjectNotice(inventory, projectId);
    if (notice !== null) notices.add(notice);
  }
  return [...notices];
}

const NO_CANDIDATES = Atom.make<ReadonlyArray<ZeropsCandidate>>([]);

/**
 * Folds every inventory project against its services, as the organization's services listing
 * holds them, into the flat candidate list every consumer needs to find or classify an
 * environment. Group membership is never known here, so it is always the account-wide fold (an
 * empty group map) — a caller that also needs group tags derives them from the same candidates
 * afterward.
 */
export function useInventoryCandidates(): ReadonlyArray<ZeropsCandidate> {
  const account = useAccountData();
  const { activeOrganization } = useZeropsSession();
  const { organizationRef } = useZeropsData();
  return useAtomValue(
    useMemo(
      () =>
        activeOrganization === null
          ? NO_CANDIDATES
          : account.data.project(inventoryCandidates, {
              organization: organizationRef(activeOrganization.id),
              viewer: activeOrganization,
            }),
      [account.data, activeOrganization, organizationRef],
    ),
  );
}

export const InventoryContext = createContext<Inventory | null>(null);

/**
 * The visible project roster used by demand wiring; rendered content reads `InventoryContext`.
 */
export const HeldInventoryContext = createContext<Pick<Inventory, "projects"> | null>(null);

export function useZeropsInventory(): Inventory {
  const inventory = useContext(InventoryContext);
  if (!inventory) throw new Error("Zerops inventory requires a verified account.");
  return inventory;
}

/**
 * A dialog's state that holds one project's content — what it captured when it opened — closed the
 * moment its source withholds it or proves it lost. A captured copy outlives a withheld read.
 */
export function useProjectDialog<T>(projectOf: (dialog: T) => string) {
  const inventory = useZeropsInventory();
  const state = useDialogState<T>();
  const [dialog, setDialog, captureReply] = state;
  if (dialog === null) return [null, setDialog, captureReply] as const;
  const projectId = projectOf(dialog);
  if (inventory.lost.has(projectId) || projectAuthority(inventory, projectId).kind === "withheld") {
    setDialog(null);
    return [null, setDialog, captureReply] as const;
  }
  return state;
}

/**
 * What the account has to say at the menu's foot, as facts: its lapse, or its inventory's lasting
 * trouble, whether the organization in view has answered again, what isn't answering, and the
 * actions. The line (`useAccountVoice`) owns how Try now reads while it runs. Null outside the
 * account's product.
 */
export interface AccountTrouble {
  readonly trouble: InventoryTroubleVoice | null;
  /** The organization in view has not answered or is recovering. */
  readonly unanswered: boolean;
  /** What isn't answering; null when nothing is named. */
  readonly subject: string | null;
  readonly retry: () => void;
}

export const AccountTroubleContext = createContext<AccountTrouble | null>(null);

export function useAccountTrouble(): AccountTrouble | null {
  return useContext(AccountTroubleContext);
}
