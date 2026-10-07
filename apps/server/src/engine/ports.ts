/**
 * What the Mate engine needs from the product around it, as ports: who may
 * start a run (`RunAdmission`) and what the platform says about the last
 * restart (`RestartEvidence`). The engine imports these, never `zerops/`;
 * `zerops/engineAdapters.ts` implements them, and outside Zerops they allow
 * and read nothing.
 *
 * @module engine/ports
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

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

/**
 * Whom a run is for. A person sends from their session (`subject` as the auth
 * layer holds it); a wake runs for the person who started what it continues
 * (`startedBy`, their Zerops user id).
 */
export type RunPrincipal =
  | { readonly kind: "person"; readonly subject: string }
  | { readonly kind: "wake"; readonly owner: WakeKind; readonly startedBy: string };

/** A run its principal may not start, in the sentence the person reads. */
export class RunRefused extends Data.TaggedError("RunRefused")<{
  readonly message: string;
}> {}

/** The engine's D6 door: asked at every run's admitted transition, for every trigger. */
export class RunAdmission extends Context.Service<
  RunAdmission,
  {
    readonly admit: (input: {
      readonly instanceId: string;
      readonly principal: RunPrincipal;
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

/** The restart's evidence, or `null` where there is none to read. */
export class RestartEvidence extends Context.Service<
  RestartEvidence,
  { readonly read: Effect.Effect<RestartFacts | null> }
>()("t3/engine/ports/RestartEvidence") {}
