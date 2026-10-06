import { createContext, useContext, useMemo, useState } from "react";

import type { InventoryTroubleVoice } from "./inventoryTrouble.logic";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import {
  deriveZeropsCandidates,
  type ZeropsCandidate,
} from "@t3tools/client-runtime/zerops/candidates";
import {
  projectKeyOf,
  type ProjectRef,
  type ScopeAuthority,
} from "@t3tools/client-runtime/zerops/data";
import type { ConversationAccess } from "@t3tools/client-runtime/zerops/environments";
import { knownPresentation, type KnownSurface } from "@t3tools/client-runtime/zerops/knowledge";

import { useProjectsServices } from "./ZeropsAccountData";

export interface Inventory {
  /**
   * The projects whose content may be shown: a project the grant withholds (DESIGN §4.2 G12) is
   * left out of `projects` at this read, and every project is while the account's
   * access lapses. Its identity stays in `projectRefs`.
   */
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Operable, account-scoped identities used to filter every shared projection. */
  readonly projectRefs: ReadonlyMap<string, ProjectRef>;
  /**
   * Each project's authority as the access grant last published it, by
   * `inventoryProjectRefKey` (DESIGN G12).
   */
  readonly authority: ReadonlyMap<string, ScopeAuthority>;
  /** The account's authority: withheld while its access lapses, every project with it. */
  readonly account: ScopeAuthority;
  /** The projects a confirming read proved lost (G6), by project id. */
  readonly lost: ReadonlySet<string>;
}

/**
 * What the account's product publishes of its inventory for the derived atoms (`state/zerops.ts`):
 * the projection without the round's loading and error words.
 */
export type InventoryProjection = Pick<
  Inventory,
  "projects" | "projectRefs" | "authority" | "account"
>;

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
 * A project's authority at the read (DESIGN §4.2 G12): the account's while its access lapses,
 * otherwise the project's own. A project the grant never named — a command established it since —
 * rests on the account's.
 */
export function projectAuthority(
  inventory: Pick<Inventory, "account" | "authority" | "projectRefs">,
  projectId: string,
): ScopeAuthority {
  if (inventory.account.kind === "withheld") return inventory.account;
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
 * What a project's region says instead of its content while the grant withholds that project,
 * e.g. "Checking your access to this project…"; `null` while its content may be shown, and while a
 * lapse withholds every project: the app's one banner says that (DESIGN §3.4).
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
 * Why the projects the grant withholds alone are not shown, in place of the rows their content
 * would draw (DESIGN §3.4): each cause once, however many projects it withholds, and none while
 * a lapse withholds them all.
 */
export function withheldProjectNotices(inventory: Inventory): ReadonlyArray<string> {
  const notices = new Set<string>();
  for (const { projectId } of inventory.projectRefs.values()) {
    const notice = withheldProjectNotice(inventory, projectId);
    if (notice !== null) notices.add(notice);
  }
  return [...notices];
}

/**
 * Folds every inventory project against its services, as the organization's services listing
 * holds them, into the flat candidate list every consumer needs to find or classify an
 * environment. Group membership is never known here, so it is always the account-wide fold (an
 * empty group map) — a caller that also needs group tags derives them from the same candidates
 * afterward.
 */
export function useInventoryCandidates(): ReadonlyArray<ZeropsCandidate> {
  const { projects } = useZeropsInventory();
  const projectIds = useMemo(() => projects.map(({ id }) => id), [projects]);
  const services = useProjectsServices(projectIds);
  return useMemo(
    () =>
      projects.flatMap((project) =>
        deriveZeropsCandidates(project, services[project.id]?.services ?? null, new Map()),
      ),
    [projects, services],
  );
}

export const InventoryContext = createContext<Inventory | null>(null);

/**
 * The inventory's projects as held, before withholding: only for the wiring that a
 * withholding must not end — the projects each group's deploy read covers (DESIGN law 5, M7).
 * Nothing renders from it; every surface reads `InventoryContext`.
 */
export const HeldInventoryContext = createContext<Pick<Inventory, "projects"> | null>(null);

export function useZeropsInventory(): Inventory {
  const inventory = useContext(InventoryContext);
  if (!inventory) throw new Error("Zerops inventory requires a verified account.");
  return inventory;
}

/**
 * A dialog's state that holds one project's content — what it captured when it opened — closed the
 * moment that project stops being shown: the grant withholds it, the account's lapse included, or
 * it is lost (DESIGN §4.2 G6, G12). A captured copy outlives the read that withheld it.
 */
export function useProjectDialog<T>(
  projectOf: (dialog: T) => string,
): readonly [T | null, (dialog: T | null) => void] {
  const inventory = useZeropsInventory();
  const [dialog, setDialog] = useState<T | null>(null);
  if (dialog === null) return [null, setDialog];
  const projectId = projectOf(dialog);
  if (inventory.lost.has(projectId) || projectAuthority(inventory, projectId).kind === "withheld") {
    setDialog(null);
    return [null, setDialog];
  }
  return [dialog, setDialog];
}

/**
 * What the account has to say at the menu's foot, as facts: its lapse, or its inventory's lasting
 * trouble, whether the organization in view has answered again, what isn't answering, and the
 * actions. The line (`useAccountVoice`) owns how Try now reads while it runs. Null outside the
 * account's product.
 */
export interface AccountTrouble {
  readonly lapse: { readonly sentence: string; readonly retry: boolean } | null;
  readonly trouble: InventoryTroubleVoice | null;
  /** The grant is lapsed, a trouble is spoken, or a read of the organization in view is pending. */
  readonly unanswered: boolean;
  /** What isn't answering (`troubleSubject`); null when nothing is named. */
  readonly subject: string | null;
  readonly retry: () => void;
  readonly signOut: () => void;
}

export const AccountTroubleContext = createContext<AccountTrouble | null>(null);

export function useAccountTrouble(): AccountTrouble | null {
  return useContext(AccountTroubleContext);
}
