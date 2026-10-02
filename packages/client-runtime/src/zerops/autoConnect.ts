/**
 * Which containers the client should register on its own.
 *
 * The roster wants to say what every agent is doing, and the only source that
 * knows is the environment's own mate server: the client already keeps a live
 * connection to every environment it has registered and reads thread status
 * from all of them. What stops a row from lighting up is only that nobody has
 * clicked Connect on it yet. So the client connects for them — once the
 * container has answered the health probe, so a sleeping or half-installed
 * container is never woken or hammered on the user's behalf.
 *
 * Pure: the decision is testable without a network. What it selects is demand
 * on the exchange driver (`environments/exchangeDriver.ts`): each target's own
 * machine decides when an exchange runs, retries it with backoff, and waits
 * for an input change after a refusal — nothing here remembers an attempt.
 *
 * @module autoConnect
 */

import type { Shown } from "./knowledge/known.ts";
import type { EnvironmentConnectionPresentation } from "../connection/presentation.ts";
import type { ZeropsCandidate } from "./candidates.ts";
import type { ZeropsContainerHealth } from "./containerHealth.ts";

/**
 * A bound, not a budget: every ready Mate the roster lists connects on its own, so each row says
 * what its Mate is doing without a click (the owner, 2026-10-02). A connect costs a throwaway only
 * the first time in a day — a kept session (`keptSessions.ts`) reconnects with none — and the door's
 * mint pace spreads those, so what is left to bound is a live socket per Mate. The largest account
 * measured holds 27 Mates; one past this connects the rest by hand.
 */
export const ZEROPS_AUTO_CONNECT_LIMIT = 48;

export interface AutoConnectCandidate extends ZeropsCandidate {
  /** Present once the environment is registered, whatever its socket is doing. */
  readonly connection?: EnvironmentConnectionPresentation;
}

/** The candidate keys auto-connect wants, in the roster's order. */
export function selectAutoConnectTargets(input: {
  readonly candidates: ReadonlyArray<AutoConnectCandidate>;
  /** What each container answered, by candidate key; absent = still asking. */
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  /**
   * Projects whose press stopped before its close-off: the container carries the press's marker
   * (`MATE_SETUP_RUNTIMES`) and HQ does not know the project closed off. Skipped, on screen or
   * not: nobody is let into a Mate before its project is closed off, and *Finish setup* does that.
   */
  readonly closeOffPendingProjectIds?: ReadonlySet<string>;
  readonly limit?: number;
  /**
   * The project whose Mate is on screen: wanted first, and past the ceiling, which is for Mates
   * not on screen — a page never waits on a connect the ceiling holds back.
   */
  readonly onScreenProjectId?: string | null;
}): ReadonlyArray<string> {
  const limit = input.limit ?? ZEROPS_AUTO_CONNECT_LIMIT;
  const closeOffPending = input.closeOffPendingProjectIds ?? new Set<string>();

  // Registered environments count against the ceiling whether or not their
  // socket is up right now; a reconnecting one is still one of ours.
  const registered = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidate.environmentId !== undefined || candidate.connection !== undefined) {
      registered.add(candidate.project.id);
    }
  }

  const targets: Array<string> = [];
  const seen = new Set<string>();
  const wanted = (candidate: AutoConnectCandidate): string | null => {
    const origin = candidate.containerOrigin;
    if (origin === undefined) return null;
    if (candidate.group !== "ready") return null;
    if (candidate.connection !== undefined || candidate.environmentId !== undefined) return null;
    if (input.health.get(candidate.key) !== "ready") return null;
    if (seen.has(origin)) return null;
    if (closeOffPending.has(candidate.project.id)) return null;
    return origin;
  };
  const onScreen = input.onScreenProjectId ?? null;
  for (const candidate of input.candidates) {
    if (onScreen === null || candidate.project.id !== onScreen) continue;
    const origin = wanted(candidate);
    if (origin === null) continue;
    seen.add(origin);
    targets.push(candidate.key);
  }
  // The ceiling counts the Mate on screen too: it is one of ours like any other.
  for (const candidate of input.candidates) {
    if (registered.size + targets.length >= limit) break;
    const origin = wanted(candidate);
    if (origin === null) continue;
    seen.add(origin);
    targets.push(candidate.key);
  }
  return targets;
}

/** What a Mate's service's own variables said of the press's marker, read once, directly. */
export type DirectMarkerRead = "reading" | boolean | "failed";

/**
 * Whether a listed Mate whose project HQ holds no word on (no record, or HQ not known yet) may be
 * connected, from the press's marker (`MATE_SETUP_RUNTIMES`) as the organization's streamed
 * variables say it. Present — hold. Absent — connect. Not known: a young container (`zcpYoung`) a
 * press may still be setting up is held, an unknown one read from the service's own variables once
 * (`read-env`); an older Mate is never held for its marker, whatever the stream says — a slow or
 * stalled stream must not stall it.
 */
export function closeOffGate(
  marker: boolean | "unknown" | "unread",
  direct: DirectMarkerRead | undefined,
  young: boolean,
): "hold" | "read-env" | "connect" {
  if (marker === true) return "hold";
  if (marker === false || !young) return "connect";
  if (marker === "unread") return "hold";
  if (direct === undefined) return "read-env";
  return direct === false ? "connect" : "hold";
}

/** How long after its container is made a Mate may still be in its press's hands. */
export const ZCP_YOUNG_MS = 2 * 60 * 60_000;

/** A container made within {@link ZCP_YOUNG_MS}; one of no known age is not young. */
export function zcpYoung(created: string | undefined, nowMs: number): boolean {
  const at = created === undefined ? Number.NaN : Date.parse(created);
  return !Number.isNaN(at) && nowMs - at < ZCP_YOUNG_MS;
}

/**
 * What the service's own variable names say of the press's marker: there, or not — and not for a
 * viewer the platform will not show them to (a 403), which never holds an older Mate for good. Any
 * other failure is `failed`, asked again later (`markerRetryDelay`).
 */
export function directMarkerOf(shown: Shown<ReadonlyArray<string>>): DirectMarkerRead {
  if (shown.state === "known") return shown.value.includes("MATE_SETUP_RUNTIMES");
  if (
    shown.state === "failed" &&
    shown.failure.kind === "refused" &&
    shown.failure.code === "permission"
  ) {
    return false;
  }
  return "failed";
}

/** A failed check's waits: 30 s, then 2 min, then 10 min, and 10 min from then on. */
export const MARKER_RETRY_MS: ReadonlyArray<number> = [30_000, 120_000, 600_000];

/** How long a check that failed for the `attempt`th time waits before it is asked again. */
export function markerRetryDelay(attempt: number): number {
  return MARKER_RETRY_MS[Math.min(attempt, MARKER_RETRY_MS.length) - 1] ?? 600_000;
}
