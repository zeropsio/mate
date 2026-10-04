/**
 * What the home (`/`) shows while it works out where to land (unknown is not empty): it lands on
 * the most recently active Mate once the Mates' connections have said so, seconds on a cold load —
 * and meanwhile it shows what it waits for, never a blank page. Where this browser remembers the
 * Mate it will land on (`homeGuess`), it guesses by it: that Mate's face, name and opening line,
 * with nothing that takes input; else the boot's one wait line. Nowhere to land is an answer only
 * once the read is whole, and it is the projects page, where New project works. Pure.
 */
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { HqMates } from "@t3tools/client-runtime/zerops/hq";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export type HomeView =
  | { readonly kind: "opening"; readonly ref: ScopedThreadRef }
  | { readonly kind: "wait" }
  /** The account's projects page: its organization, or none chosen. */
  | { readonly kind: "projects"; readonly organizationId: string | null }
  | { readonly kind: "start-failed" };

export function homeView(input: {
  /** Not known yet, known and on its way there, or nowhere to land. */
  readonly landing: "unknown" | "going" | "none";
  /** The draft it would land on could not be started. */
  readonly startFailed: boolean;
  /** A connect named the environment to land in: the remembered Mate is not where it goes. */
  readonly targeted: boolean;
  /** The landing as remembered (`homeGuess`): the guess. */
  readonly remembered: ScopedThreadRef | null;
  /** The account's projects and its Mates are read whole. */
  readonly projectsRead: boolean;
  /** HQ has answered for this organization, or its absence/failure is known. */
  readonly hqMatesRead: boolean;
  /** The organization in view; null while none is chosen. */
  readonly organizationId: string | null;
}): HomeView {
  if (input.startFailed) return { kind: "start-failed" };
  if (input.landing === "none" && input.projectsRead && (input.targeted || input.hqMatesRead)) {
    return { kind: "projects", organizationId: input.organizationId };
  }
  if (input.remembered !== null && !input.targeted) {
    return { kind: "opening", ref: input.remembered };
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
 * socket is up. A registration that does not answer keeps its cached projects, and those never
 * claim the landing: with HQ naming none, its old conversation may be a Mate that is gone. A
 * socket on its first attempt, or a live one whose shell has not arrived, is worth a moment. Pure.
 */
export function homeTarget(input: {
  readonly target: { readonly environmentId: EnvironmentId; readonly bootstrapped: boolean } | null;
  /** The Mate HQ names (`hqHomeMate`). */
  readonly hqMate: string | undefined;
  /** HQ has answered for this organization, or its absence/failure is known. */
  readonly hqMatesRead: boolean;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly phase: EnvironmentConnectionPhase;
    /** Its shell has arrived. */
    readonly snapshot: boolean;
  }>;
}): HomeTarget | null {
  if (input.target !== null) {
    return input.target.bootstrapped
      ? { kind: "environment", environmentId: input.target.environmentId }
      : null;
  }
  if (input.hqMate !== undefined) return { kind: "mate", projectId: input.hqMate };
  if (!input.hqMatesRead) return null;
  if (input.environments.some((environment) => environment.phase === "connecting")) return null;
  const live = input.environments.filter((environment) => environment.phase === "connected");
  if (live.some((environment) => !environment.snapshot)) return null;
  return live.length === 0
    ? { kind: "none" }
    : { kind: "among", environmentIds: live.map((environment) => environment.environmentId) };
}

/**
 * The Mate the home will land on, as this browser remembers it: the landing's own rule — the most
 * recently active Mate among those whose container is up, else among all — over the menu's
 * remembered rows, so a Mate working in the background is guessed, not the conversation open last
 * and then taken back. That conversation where its Mate is the one guessed, or where nothing
 * better is remembered; a Mate this browser no longer knows is never offered.
 */
export function homeGuess(input: {
  /** Environment → the Mate this browser last knew there (`mateIdentityMemory`). */
  readonly mates: Readonly<
    Record<
      string,
      { readonly projectId?: string | undefined; readonly running?: boolean | undefined }
    >
  >;
  /** Project → its Mate's row as the menu last drew it (`menuMemory`). */
  readonly rows: Readonly<Record<string, { readonly at: string; readonly threadId: string }>>;
  /** The conversation open last. */
  readonly lastOpen: ScopedThreadRef | null;
}): ScopedThreadRef | null {
  const active = Object.entries(input.mates).flatMap(([environmentId, mate]) => {
    const row = mate.projectId === undefined ? undefined : input.rows[mate.projectId];
    const at = row === undefined ? Number.NaN : Date.parse(row.at);
    return row === undefined || Number.isNaN(at)
      ? []
      : [{ environmentId, threadId: row.threadId, at, up: mate.running !== false }];
  });
  const up = active.filter((mate) => mate.up);
  let latest: (typeof active)[number] | undefined;
  for (const mate of up.length > 0 ? up : active) {
    if (latest === undefined || mate.at > latest.at) latest = mate;
  }
  const lastOpen =
    input.lastOpen !== null && input.mates[input.lastOpen.environmentId] !== undefined
      ? input.lastOpen
      : null;
  if (latest === undefined || lastOpen?.environmentId === latest.environmentId) return lastOpen;
  return scopeThreadRef(EnvironmentId.make(latest.environmentId), ThreadId.make(latest.threadId));
}

export function writeHomeLanding(ref: ScopedThreadRef): string {
  return JSON.stringify({ environmentId: ref.environmentId, threadId: ref.threadId });
}

export function readHomeLanding(text: string | null): ScopedThreadRef | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { environmentId, threadId } = parsed as Record<string, unknown>;
    if (typeof environmentId !== "string" || typeof threadId !== "string") return null;
    if (environmentId.length === 0 || threadId.length === 0) return null;
    return scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
  } catch {
    return null;
  }
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
