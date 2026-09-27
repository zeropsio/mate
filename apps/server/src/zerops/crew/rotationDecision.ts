/**
 * rotationDecision — whether a crewmate's conversation (its stint) carries on,
 * waits to rotate, rotates now, or gives up on the task (CONCEPT §3A.4, PRD
 * §5.6 on the probe-22 fallback).
 *
 * | Trigger                                                   | Due                        | Counted |
 * |-----------------------------------------------------------|----------------------------|---------|
 * | the recorded transcript is missing before a resume        | at once                    | yes     |
 * | the first turn after a resume ended in a provider error   | at once                    | yes     |
 * | `rapid_refill_breaker` or `prompt_too_long`               | at once                    | yes     |
 * | the second rework of a task                               | before the rework starts   | yes     |
 * | a task marked unrelated (`fresh`)                         | at its dispatch            | yes     |
 * | `rotateAfter` compactions (0 = never)                     | at the next task           | yes     |
 * | a different principal                                     | at the next task           | yes     |
 * | a newer brief or job (*nextTurn*)                         | at the next turn           | no      |
 * | a newer brief or job (*now*, *fresh*); a new login        | at once                    | no      |
 * | *Start fresh*                                             | at once (between turns)    | no      |
 *
 * Probe 22 failed: a resumed session keeps the append it started with, so a
 * newer brief or job can only reach a crewmate through a new stint, and every
 * apply choice rotates. Model and effort reach the next turn without one and
 * are not an input here.
 *
 * At most two counted rotations per attempt; a third parks the task ("the
 * context can't hold it"). Only the engine's own triggers count: a rotation
 * the person asked for is never a symptom of a task too large for the window.
 *
 * @module rotationDecision
 */
import type { CrewApplyChoice } from "@t3tools/contracts";

import type { PromptVersions } from "./crewVersions.ts";
import { isPromptPending } from "./crewVersions.ts";

export const CREW_ROTATIONS_PER_ATTEMPT = 2;
export const CREW_ROTATE_AFTER_DEFAULT = 3;

export type RotationReason =
  | "transcript-missing"
  | "resume-failed"
  | "context-overflow"
  | "second-rework"
  | "fresh-task"
  | "compactions"
  | "principal-changed"
  | "prompt-changed"
  | "login-changed"
  | "start-fresh";

/**
 * When the engine asks: `idle` between turns (after a save or a press),
 * `turn-start` before a turn of the open task, `task-start` before the first
 * turn of a task — the task boundary.
 */
export type RotationMoment = "idle" | "turn-start" | "task-start";

export interface RotationFacts {
  readonly moment: RotationMoment;
  /** Before a resume: the stint's recorded transcript path is gone. */
  readonly transcriptMissing: boolean;
  /** The first turn after a resume ended with a provider error. */
  readonly resumeFailed: boolean;
  /** The last turn's `terminalReason` (SPI 2.5), when it had one. */
  readonly lastTerminalReason?: string;
  readonly compactions: number;
  readonly rotateAfter: number;
  readonly stintPrincipal: string;
  readonly principal: string;
  /** The versions the stint's session started with, and the current ones. */
  readonly running: PromptVersions;
  readonly current: PromptVersions;
  /** The apply choice of the save that made the versions pending. */
  readonly apply?: CrewApplyChoice;
  readonly stintLogin: string;
  readonly login: string;
  /** The rework about to be dispatched (1 = the first), if the next turn is one. */
  readonly reworkDispatch?: number;
  /** The task about to start is marked unrelated work. */
  readonly freshTask: boolean;
  /** The person pressed *Start fresh*. */
  readonly startFresh: boolean;
  /** Counted rotations already made in the open task's attempt. */
  readonly rotationsThisAttempt: number;
}

export type Rotation =
  | { readonly kind: "keep" }
  | { readonly kind: "pending"; readonly reason: RotationReason }
  | { readonly kind: "rotate"; readonly reason: RotationReason; readonly counted: boolean }
  | { readonly kind: "park"; readonly reason: RotationReason };

type Due = "now" | "next-turn" | "next-task";

interface Trigger {
  readonly reason: RotationReason;
  readonly due: Due;
  readonly counted: boolean;
}

const CONTEXT_OVERFLOW_REASONS = new Set(["rapid_refill_breaker", "prompt_too_long"]);

/** Every trigger present in the facts, in priority order: the person's first. */
const triggersOf = (facts: RotationFacts): ReadonlyArray<Trigger> => {
  const triggers: Array<Trigger> = [];
  const add = (present: boolean, reason: RotationReason, due: Due, counted: boolean) => {
    if (present) triggers.push({ reason, due, counted });
  };
  add(facts.startFresh, "start-fresh", "now", false);
  add(facts.stintLogin !== facts.login, "login-changed", "now", false);
  add(
    isPromptPending(facts.running, facts.current),
    "prompt-changed",
    facts.apply === "now" || facts.apply === "fresh" ? "now" : "next-turn",
    false,
  );
  add(facts.transcriptMissing, "transcript-missing", "now", true);
  add(facts.resumeFailed, "resume-failed", "now", true);
  add(
    facts.lastTerminalReason !== undefined &&
      CONTEXT_OVERFLOW_REASONS.has(facts.lastTerminalReason),
    "context-overflow",
    "now",
    true,
  );
  add((facts.reworkDispatch ?? 0) >= 2, "second-rework", "next-turn", true);
  add(facts.freshTask, "fresh-task", "next-task", true);
  add(facts.stintPrincipal !== facts.principal, "principal-changed", "next-task", true);
  add(
    facts.rotateAfter > 0 && facts.compactions >= facts.rotateAfter,
    "compactions",
    "next-task",
    true,
  );
  return triggers;
};

const isDue = (due: Due, moment: RotationMoment): boolean =>
  due === "now" ||
  (due === "next-turn" && moment !== "idle") ||
  (due === "next-task" && moment === "task-start");

export const rotationDecision = (facts: RotationFacts): Rotation => {
  const triggers = triggersOf(facts);
  const due = triggers.find((trigger) => isDue(trigger.due, facts.moment));
  if (due) {
    if (due.counted && facts.rotationsThisAttempt >= CREW_ROTATIONS_PER_ATTEMPT) {
      return { kind: "park", reason: due.reason };
    }
    return { kind: "rotate", reason: due.reason, counted: due.counted };
  }
  const pending = triggers[0];
  return pending ? { kind: "pending", reason: pending.reason } : { kind: "keep" };
};
