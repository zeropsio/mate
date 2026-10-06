/**
 * What the home (`/`) shows while it works out where to land (unknown is not empty): it lands on
 * the most recently active Mate once the Mates' connections have said so, seconds on a cold load —
 * and meanwhile it shows the boot's one wait line, never a blank page and never a guess of where
 * it will land. Nowhere to land is an answer only once the read is whole, and
 * it is the projects page, where New project works; once painted, it stays until somebody here
 * sends the home elsewhere. Pure.
 */
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsOrganizationStatus } from "./ZeropsSessionProvider";

export type HomeView =
  | { readonly kind: "wait" }
  /** The account's projects page: its organization, or none chosen. */
  | { readonly kind: "projects"; readonly organizationId: string | null }
  | { readonly kind: "start-failed" };

export function homeView(input: {
  /** Not known yet, known and on its way there, or nowhere to land. */
  readonly landing: "unknown" | "going" | "none";
  /** The draft it would land on could not be started. */
  readonly startFailed: boolean;
  /** A connect named the environment to land in. */
  readonly targeted: boolean;
  /** The account's projects and its Mates are read whole. */
  readonly projectsRead: boolean;
  /** HQ has answered for this organization, or its absence/failure is known. */
  readonly hqMatesRead: boolean;
  /** The organization in view; null while none is chosen. */
  readonly organizationId: string | null;
  readonly organization: ZeropsOrganizationStatus;
  /** The account's access failed to verify (`useZeropsInventory().error`). */
  readonly accountTrouble: boolean;
  readonly catalogFailed: boolean;
  /** The projects page this home painted, and the organization it painted it for. */
  readonly projectsShown: { readonly organizationId: string | null } | null;
}): HomeView {
  if (input.startFailed) return { kind: "start-failed" };
  // Nothing lists the Mates until something happens — an organization chosen, the account's
  // access verified, the catalog read — so the read never ends whole: the projects page says what.
  const blocked =
    input.organization === "needs-selection" || input.accountTrouble || input.catalogFailed;
  if (
    input.landing === "none" &&
    (input.projectsRead || blocked) &&
    (input.targeted || input.hqMatesRead)
  ) {
    return { kind: "projects", organizationId: input.organizationId };
  }
  // Once painted, the projects page goes only where somebody here sends it: a connect's
  // environment, or the Mate of the organization they switched to. A read unsettled again or a
  // Mate nobody here opened never takes it back.
  const shown = input.projectsShown;
  if (shown !== null && !input.targeted) {
    return shown.organizationId !== input.organizationId && input.landing === "going"
      ? { kind: "wait" }
      : { kind: "projects", organizationId: shown.organizationId };
  }
  return { kind: "wait" };
}

/** Where the home lands, before it is resolved to a conversation or a draft there. */
export type HomeTarget =
  /** The Mate HQ names: opening it holds just its route lease (A9). */
  | { readonly kind: "mate"; readonly projectId: string }
  /** The environment a connect handed over. */
  | { readonly kind: "environment"; readonly environmentId: EnvironmentId }
  /** The most recently active project among these environments, every one of them live. */
  | { readonly kind: "among"; readonly environmentIds: ReadonlyArray<EnvironmentId> }
  | { readonly kind: "none" };

/**
 * Where the home lands (null: not known yet). A connect's environment first, once its shell is
 * here; else the Mate HQ names; else, once HQ has answered, the projects of the environments whose
 * socket is up. Only the organization in view lands anything: HQ's Mates are another
 * organization's for a render after a switch, and the registrations are the account's, every
 * organization's — a server outside Zerops is nobody's, and lands. A registration that does not
 * answer keeps its cached projects, and those never claim the landing: with HQ naming none, its
 * old conversation may be a Mate that is gone. A socket on its first attempt, or a live one whose
 * shell has not arrived, is worth a moment. Pure.
 */
export function homeTarget(input: {
  /** The organization in view; null while none is chosen. */
  readonly organizationId: string | null;
  readonly target: { readonly environmentId: EnvironmentId; readonly bootstrapped: boolean } | null;
  /** The Mate HQ names (`hqHomeMate`), and the organization whose HQ named it. */
  readonly hqMate: { readonly organizationId: string; readonly projectId: string } | null;
  /** HQ has answered for the organization in view, or its absence/failure is known. */
  readonly hqMatesRead: boolean;
  /** The Zerops projects the organization in view lists. */
  readonly organizationProjects: ReadonlySet<string>;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly phase: EnvironmentConnectionPhase;
    /** Its shell has arrived. */
    readonly snapshot: boolean;
    /** The Zerops project its server states: null outside Zerops, undefined until it says. */
    readonly zeropsProjectId: string | null | undefined;
  }>;
}): HomeTarget | null {
  if (input.target !== null) {
    return input.target.bootstrapped
      ? { kind: "environment", environmentId: input.target.environmentId }
      : null;
  }
  if (input.hqMate !== null && input.hqMate.organizationId === input.organizationId) {
    return { kind: "mate", projectId: input.hqMate.projectId };
  }
  if (!input.hqMatesRead) return null;
  const ours = input.environments.filter(
    ({ zeropsProjectId }) =>
      zeropsProjectId === null ||
      (zeropsProjectId !== undefined && input.organizationProjects.has(zeropsProjectId)),
  );
  if (ours.some((environment) => environment.phase === "connecting")) return null;
  const live = ours.filter((environment) => environment.phase === "connected");
  if (live.some((environment) => !environment.snapshot)) return null;
  return live.length === 0
    ? { kind: "none" }
    : { kind: "among", environmentIds: live.map((environment) => environment.environmentId) };
}

/** The home opens the most recently active Mate HQ names, preferring an online one. */
export function hqHomeMate(
  mates: HqMates | null,
  deleting: ReadonlySet<string> = new Set(),
): string | undefined {
  const rows = [...(mates ?? new Map())]
    .filter(([projectId]) => !deleting.has(projectId))
    .map(([projectId, mate]) => ({
      projectId,
      online: mate.presence.online,
      at:
        Date.parse(mate.main?.latestUserMessageAt ?? mate.main?.updatedAt ?? mate.presence.since) ||
        0,
    }));
  const online = rows.filter((row) => row.online);
  return (online.length > 0 ? online : rows).toSorted(
    (a, b) => b.at - a.at || a.projectId.localeCompare(b.projectId),
  )[0]?.projectId;
}
