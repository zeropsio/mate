/**
 * crewSeams — the two services that join the crew engine to the crew's
 * thread policy and tools.
 *
 * The engine (`CrewEngine`) owns the crew's state; the thread policy
 * (`CrewThreadPolicy`) answers the provider SPI for crew threads and runs the
 * crew tools a crewmate calls. Neither imports the other: the engine provides
 * both services below, the policy consumes them.
 *
 * - `CrewThreadDirectory` answers "who is this thread": the crewmate behind a
 *   crew-origin thread, with everything its session needs — the gate context,
 *   the prompt input and its Runs-on overrides. `none` for a person's thread;
 *   a crew thread whose stint is not live answers with `live: false`, and the
 *   policy gives it the deny-all profile (ARCHITECTURE §2 *Activation*).
 * - `CrewToolHost` is what a crew tool does once the policy has decoded its
 *   input: every call names the calling crewmate, and every answer is the text
 *   the model reads back.
 *
 * @module crewSeams
 */
import type { CrewMemberKind, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { GateContext } from "./CrewPolicy.ts";
import type { CrewPromptInput } from "./crewPrompt.ts";

/** A crew tool's answer, as the SPI's `ThreadTool.run` returns it. */
export interface CrewToolText {
  readonly text: string;
  readonly isError: boolean;
}

export interface CrewThreadMember {
  readonly crew: string;
  readonly handle: string;
  readonly kind: CrewMemberKind;
  readonly stint: number;
  /** The thread is its crewmate's current stint and the crew is applied. */
  readonly live: boolean;
  readonly gate: GateContext;
  readonly prompt: CrewPromptInput;
  readonly contextWindow: number;
  /** Absent without a run, or on a run with no budget limit (PRD Δ16). */
  readonly maxBudgetUsd?: number;
  /** Runs on (PRD §2.3): a catalog slug and an effort value, absent for the login's default. */
  readonly model?: string;
  readonly effort?: string;
}

export class CrewThreadDirectory extends Context.Service<
  CrewThreadDirectory,
  {
    readonly memberFor: (threadId: ThreadId) => Effect.Effect<Option.Option<CrewThreadMember>>;
  }
>()("t3/zerops/crew/crewSeams/CrewThreadDirectory") {}

/** `crew_report` (CONCEPT §5): done, a question for the lead or the person, or progress. */
export interface CrewReportInput {
  readonly status: "done" | "blocked" | "progress";
  readonly summary: string;
  readonly question?: string;
  /** Lessons for memory (phase C); ignored without memory. */
  readonly lessons?: ReadonlyArray<string>;
}

/** One task of the lead's plan (`crew_propose`, PRD §5.4). */
export interface CrewProposedTask {
  readonly owner: string;
  readonly title: string;
  readonly brief: string;
  readonly doneWhen?: string;
  /** Titles or `#N` numbers of tasks in the same plan or on the board. */
  readonly dependsOn?: ReadonlyArray<string>;
}

export interface CrewReviewInput {
  readonly task: number;
  readonly verdict: "accept" | "reject";
  readonly note: string;
}

/** `crew_memory` operations (phase C, CONCEPT §3A). */
export type CrewMemoryOp =
  | {
      readonly op: "add";
      readonly kind: "decision" | "lesson" | "fact" | "open" | "note" | "handoff";
      readonly topic: string;
      readonly text: string;
      readonly paths?: ReadonlyArray<string>;
    }
  | { readonly op: "update"; readonly id: string; readonly text: string }
  | { readonly op: "remove"; readonly id: string }
  | { readonly op: "list"; readonly topic?: string };

export class CrewToolHost extends Context.Service<
  CrewToolHost,
  {
    readonly report: (
      member: CrewThreadMember,
      input: CrewReportInput,
    ) => Effect.Effect<CrewToolText>;
    /** The roster and the tasks (PRD Δ7: the roster is read here, never from the prompt). */
    readonly board: (member: CrewThreadMember) => Effect.Effect<CrewToolText>;
    /** A crewmate's changes against the integration HEAD; `handle` absent = the caller's own. */
    readonly diff: (
      member: CrewThreadMember,
      input: { readonly handle?: string; readonly path?: string },
    ) => Effect.Effect<CrewToolText>;
    readonly showOnDev: (
      member: CrewThreadMember,
      input: { readonly reason: string },
    ) => Effect.Effect<CrewToolText>;
    /** Phase C, the lead only. */
    readonly propose: (
      member: CrewThreadMember,
      tasks: ReadonlyArray<CrewProposedTask>,
    ) => Effect.Effect<CrewToolText>;
    /** Phase C, the lead or a reader. */
    readonly review: (
      member: CrewThreadMember,
      input: CrewReviewInput,
    ) => Effect.Effect<CrewToolText>;
    /** Phase C, the lead only: every Done-when line is met. */
    readonly finish: (
      member: CrewThreadMember,
      input: { readonly summary: string },
    ) => Effect.Effect<CrewToolText>;
    /** Phase C. */
    readonly memory: (member: CrewThreadMember, op: CrewMemoryOp) => Effect.Effect<CrewToolText>;
    /**
     * `SessionStart`'s additional context: the rotation seed on a new stint's
     * first session (B), the state packet after a compaction and the resume
     * delta (C). `undefined` adds nothing.
     */
    readonly sessionStart: (
      member: CrewThreadMember,
      source: "startup" | "resume" | "compact" | "clear",
    ) => Effect.Effect<string | undefined>;
    readonly postCompact: (member: CrewThreadMember, summary: string) => Effect.Effect<void>;
  }
>()("t3/zerops/crew/crewSeams/CrewToolHost") {}
