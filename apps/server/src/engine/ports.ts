/**
 * What the Mate engine needs from the product around it, as ports: who may
 * start a run (`RunAdmission`), what the platform says about the last
 * restart (`RestartEvidence`), where a conversation's agent works
 * (`AgentWorkspace`), how a call's pictures are claimed (`MessagePictures`) and what
 * another instance of a driver left on a thread (`HandedOverResume`). The engine imports these,
 * never `zerops/` and no provider file but `ProviderService`;
 * `zerops/engineAdapters.ts` implements them, and outside Zerops they allow
 * and read nothing.
 *
 * @module engine/ports
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type { MateRestart } from "@t3tools/contracts";
import type {
  ChatAttachment,
  ConversationId,
  Principal,
  RunTrigger,
  RuntimeMode,
} from "@t3tools/contracts";

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
 * The restart's evidence, or `null` where there is none to read, and the structured cause of a run the
 * restart cut: what happened to the Mate between the run's last sign of life and the boot.
 */
export class RestartEvidence extends Context.Service<
  RestartEvidence,
  {
    readonly read: Effect.Effect<RestartFacts | null>;
    readonly explain: (
      facts: RestartFacts | null,
      window: { readonly lastActivityAt: number; readonly bootAt: number },
    ) => MateRestart;
  }
>()("t3/engine/ports/RestartEvidence") {}

/** Where a conversation's agent works, and how freely: what a session opens with. */
export interface WorkspaceSetup {
  readonly cwd: string;
  readonly runtimeMode: RuntimeMode;
}

/**
 * A conversation's workspace that cannot be told now (a crewmate's copy unread): its session opens
 * nowhere else, and tries again.
 */
export class WorkspaceUnavailable extends Data.TaggedError("WorkspaceUnavailable")<{
  readonly message: string;
}> {}

export class AgentWorkspace extends Context.Service<
  AgentWorkspace,
  {
    readonly of: (
      conversation: ConversationId,
    ) => Effect.Effect<WorkspaceSetup, WorkspaceUnavailable>;
  }
>()("t3/engine/ports/AgentWorkspace") {}

/** A picture a call carries that could not be claimed, in the words V1 refuses it with. */
export class PicturesRefused extends Data.TaggedError("PicturesRefused")<{
  readonly message: string;
}> {}

/**
 * The pictures a person's call carries, claimed for a conversation before the step that records
 * them, as V1 claims a message's: a pending upload copied under the conversation's own id (the
 * client lets the upload go once the call is answered), within V1's limits; nothing claimed
 * stays when one fails. `release` lets go of a claim whose call was not taken.
 */
export class MessagePictures extends Context.Service<
  MessagePictures,
  {
    readonly claim: (
      conversation: ConversationId,
      attachments: ReadonlyArray<ChatAttachment>,
    ) => Effect.Effect<ReadonlyArray<ChatAttachment>, PicturesRefused>;
    readonly release: (claimed: ReadonlyArray<ChatAttachment>) => Effect.Effect<void>;
  }
>()("t3/engine/ports/MessagePictures") {}

/**
 * The resume state another instance of the same driver left on a thread, read when a person's
 * agent pick keeps the thread: `undefined` when it left none (the session starts fresh), and for
 * the thread's own instance, whose binding `ProviderService` resumes itself.
 */
export class HandedOverResume extends Context.Service<
  HandedOverResume,
  {
    readonly of: (input: {
      readonly thread: string;
      readonly instanceId: string;
    }) => Effect.Effect<unknown>;
  }
>()("t3/engine/ports/HandedOverResume") {}
