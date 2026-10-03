/**
 * What the home (`/`) shows while it works out where to land (unknown is not empty): it lands on
 * the most recently active Mate once the Mates' connections have said so, seconds on a cold load —
 * and meanwhile it shows what it waits for, never a blank page. Where this browser remembers the
 * conversation open last, it guesses by it: that Mate's face, name and opening line, with nothing
 * that takes input; else the boot's one wait line. "No projects" is an answer: only once the read is whole. Pure.
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
  /** The conversation open last, when this browser still knows its Mate: the guess. */
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
