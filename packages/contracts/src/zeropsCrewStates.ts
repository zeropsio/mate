/**
 * Crew mode — the closed vocabularies every crew slice shares.
 *
 * Server (`apps/server/src/zerops/crew/**`), the pure client projection
 * (`packages/client-runtime/src/zerops/crew/**`) and the wire contract
 * (`zeropsCrew.ts`) all read these, so a state added here reaches the store,
 * the machines and the board at once. Unlike the zcp envelope mirror in
 * `zerops.ts`, both ends of these values ship from this repo, so they are
 * closed `Schema.Literals` unions.
 */
import * as Schema from "effect/Schema";

/** `off`: not a Zerops Mate or the switch is off · `none`: no crew applied · `applied`. */
export const CrewStatus = Schema.Literals(["off", "none", "applied"]);
export type CrewStatus = typeof CrewStatus.Type;

/** `writer` changes files and has a lane; `reader` and `lead` are read-only and have none. */
export const CrewMemberKind = Schema.Literals(["writer", "reader", "lead"]);
export type CrewMemberKind = typeof CrewMemberKind.Type;

/** A task's state (ARCHITECTURE §4 *Assignment*, plus PRD §6.3 `proposed`). */
export const CrewTaskState = Schema.Literals([
  "proposed",
  "queued",
  "working",
  "rework",
  "blocked",
  "merging",
  "checking",
  "review",
  "ready",
  "landing",
  "waiting-on-you",
  "landed",
  "parked",
  "discarded",
]);
export type CrewTaskState = typeof CrewTaskState.Type;

/** Where a task came from (PRD §6.1); `issue` is phase D. */
export const CrewTaskSource = Schema.Literals(["you", "lead", "message", "issue"]);
export type CrewTaskSource = typeof CrewTaskSource.Type;

export const CrewRunState = Schema.Literals([
  "running",
  "paused",
  "finishing",
  "finished",
  "stopped",
]);
export type CrewRunState = typeof CrewRunState.Type;

export const CrewStintState = Schema.Literals(["open", "active", "rotate-pending", "retired"]);
export type CrewStintState = typeof CrewStintState.Type;

/**
 * Why a crewmate's conversation opened a new session between turns, on the engine:
 * - `context`: it outgrew its context, was compacted `rotateAfter` times, or its transcript is gone;
 * - `cleared`: *Clear its conversation* or *Start fresh*;
 * - `job`: a saved brief or job applied fresh or at once;
 * - `login`: it runs on another login;
 * - `budget`: a run's cap changed (the session resumes);
 * - `task`: its next task starts clean (unrelated work, someone else's, a second rework).
 *
 * Open on both ends: a reason from a newer build decodes as `unknown`.
 */
export const CREW_SESSION_REASONS = [
  "context",
  "cleared",
  "job",
  "login",
  "budget",
  "task",
] as const;

/** The Show-on-dev claim per dev host (ARCHITECTURE §4). */
export const CrewClaimState = Schema.Literals([
  "none",
  "requested",
  "starting",
  "held",
  "releasing",
  "release-failed",
]);
export type CrewClaimState = typeof CrewClaimState.Type;

/**
 * How a brief or job save reaches the crewmates (PRD §5.6). Probe 22 failed on
 * CLI 2.1.283 — a resumed session keeps the append it started with — so
 * `nextTurn` rotates to a fresh stint at the crewmate's next turn, `now`
 * interrupts and rotates at once, `fresh` rotates at once between turns.
 */
export const CrewApplyChoice = Schema.Literals(["nextTurn", "now", "fresh"]);
export type CrewApplyChoice = typeof CrewApplyChoice.Type;

/** A crewmate's own app on its crew port (PRD §5.7). */
export const CrewAppState = Schema.Literals(["running", "stopped", "none"]);
export type CrewAppState = typeof CrewAppState.Type;

/** Run option *Landing* (PRD §4.8): the person lands · the lead lands after its review · land when the check passes. */
export const CrewLandingMode = Schema.Literals(["person", "lead", "check"]);
export type CrewLandingMode = typeof CrewLandingMode.Type;

/** *Waiting on you* rows (PRD §4.3 item 4, §5.5). */
export const CrewAttentionKind = Schema.Literals([
  "question",
  "landing-wait",
  "ready-to-land",
  "plan",
  "show-on-dev",
  "parked",
  "cant-start",
  "conflict",
  "check-failed",
  "stalled",
  "review-wait",
  "sent-back",
  "dependency-gone",
  "copy-missing",
  "conversation-copy",
  "interrupted",
  /** A redeploy a restart cut off that could not be read for long: its host may be thawed by hand. */
  "deploy-unreadable",
]);
export type CrewAttentionKind = typeof CrewAttentionKind.Type;

/** A crewmate's fixed handle: mentions, branch `crew/<handle>`, directory `.crew/<handle>` (PRD Δ11). */
export const CREW_HANDLE_PATTERN = /^[a-z0-9-]{1,20}$/;
export const CrewHandle = Schema.String.check(Schema.isPattern(CREW_HANDLE_PATTERN));
export type CrewHandle = typeof CrewHandle.Type;
