/**
 * What the home (`/`) shows while it works out where to land (unknown is not empty): it lands on
 * the most recently active Mate once the Mates' connections have said so, seconds on a cold load —
 * and meanwhile it shows what it waits for, never a blank page. Where this browser remembers the
 * Mate it will land on (`homeGuess`), it guesses by it: that Mate's face, name and opening line,
 * with nothing that takes input; else the boot's one wait line. "No projects" is an answer: only once the read is whole. Pure.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export type HomeView =
  | { readonly kind: "opening"; readonly ref: ScopedThreadRef }
  | { readonly kind: "wait" }
  | { readonly kind: "hero" }
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
}): HomeView {
  if (input.startFailed) return { kind: "start-failed" };
  if (input.landing === "none" && input.projectsRead) return { kind: "hero" };
  if (input.remembered !== null && !input.targeted) {
    return { kind: "opening", ref: input.remembered };
  }
  return { kind: "wait" };
}

/**
 * Which home `/` paints: the account's projects, or the landing that moves on to a Mate. A cold
 * load counts no environment until the account's Mates register, so "nothing to land on" is an
 * answer only once the Mates are read whole (`useMatesSettled`); until then the landing waits with
 * its guess, and the projects page never paints just to be taken back. Pure.
 */
export function homeDoor(input: {
  /** The door counts no usable environment: by itself, the projects page. */
  readonly noEnvironments: boolean;
  /** Every Mate this tab will register is registered or will not be. */
  readonly matesSettled: boolean;
}): "landing" | "projects" {
  return input.noEnvironments && input.matesSettled ? "projects" : "landing";
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
