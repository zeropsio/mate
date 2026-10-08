/**
 * What the Mate engine needs from the product around it, as ports: who may
 * start a run (`RunAdmission`), what the platform says about the last
 * restart (`RestartEvidence`) and where a conversation's agent works
 * (`AgentWorkspace`). The engine imports these, never `zerops/`;
 * `zerops/engineAdapters.ts` implements them, and outside Zerops they allow
 * and read nothing.
 *
 * @module engine/ports
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type { ConversationId, Principal, RunTrigger, RuntimeMode } from "@t3tools/contracts";

/**
 * A wake's kind: today's triggers that start a run with no person at the keyboard. The
 * engine's own `watchdog` is never asked for; stored wakes keep any kind a newer build wrote.
 */
export type WakeKind =
  | "standup"
  | "usage-resume"
  | "restart-continuation"
  | "report"
  | "self"
  | "crew";

/** A run its principal may not start, in the sentence the person reads. */
export class RunRefused extends Data.TaggedError("RunRefused")<{
  readonly message: string;
}> {}

/**
 * The engine's D6 door: asked at every run's admitted transition, for every trigger. A run is
 * for its principal (a person, or the principal its wake names; a continuation inherits the one
 * it continues), and its trigger says whether that person is at the keyboard (`person`) or not
 * (a `wake` of some cause).
 */
export class RunAdmission extends Context.Service<
  RunAdmission,
  {
    readonly admit: (input: {
      readonly instanceId: string;
      readonly principal: Principal;
      readonly trigger: RunTrigger;
    }) => Effect.Effect<void, RunRefused>;
  }
>()("t3/engine/ports/RunAdmission") {}

/**
 * What the platform recorded about this container's restart, read once per
 * boot: the container actions (raw, as the platform lists them) and when the
 * container started. The restart reconcile words a cut-off run from it.
 */
export interface RestartFacts {
  readonly name: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly processes: ReadonlyArray<unknown>;
  readonly containerStartedAt: string | null;
}

/**
 * The restart's evidence, or `null` where there is none to read, and the sentence a run the
 * restart cut reads: what happened to the Mate between the run's last sign of life and the boot.
 */
export class RestartEvidence extends Context.Service<
  RestartEvidence,
  {
    readonly read: Effect.Effect<RestartFacts | null>;
    readonly explain: (
      facts: RestartFacts | null,
      window: { readonly lastActivityAt: number; readonly bootAt: number },
    ) => string;
  }
>()("t3/engine/ports/RestartEvidence") {}

/** Where a conversation's agent works, and how freely: what a session opens with. */
export interface WorkspaceSetup {
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
}

export class AgentWorkspace extends Context.Service<
  AgentWorkspace,
  { readonly of: (conversation: ConversationId) => Effect.Effect<WorkspaceSetup> }
>()("t3/engine/ports/AgentWorkspace") {}
