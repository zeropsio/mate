/**
 * What the Mate engine needs from the product around it, as ports: who may
 * start a run (`RunAdmission`), what the platform says about the last
 * restart (`RestartEvidence`), where a conversation's agent works
 * (`AgentWorkspace`), how a call's pictures are claimed (`MessagePictures`), what a
 * session of a thread resumes (`ThreadResume`) and what each provider
 * reports of its signed-in account's usage (`ProviderUsageFeed`) and how an archived conversation's
 * branch goes back to its pool (`LeaseRelease`), how a taken task's change is linked to it
 * (`TaskChangeLink`), and where the work stands (`WorkWhere`). The engine imports these,
 * never `zerops/` and no provider file but `ProviderService`;
 * `zerops/engineAdapters.ts` implements them, and outside Zerops they allow
 * and read nothing.
 *
 * @module engine/ports
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { LeaseReleaseResult, MateRestart, RunAdmissionRefusal } from "@t3tools/contracts";
import type {
  ChatAttachment,
  ConversationId,
  Principal,
  RunTrigger,
  RuntimeMode,
} from "@t3tools/contracts";

import type { ProviderUsageReport } from "./domain/command.ts";

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

/** A run its principal may not start, in the sentence the person reads, and whose login it was. */
export class RunRefused extends Data.TaggedError("RunRefused")<{
  readonly message: string;
  readonly admission?: RunAdmissionRefusal;
  /**
   * The door could not say now — HQ silent on whether the person may still run here — so the run
   * is asked again over minutes, as a wait on something outside the engine, before it fails.
   */
  readonly undetermined?: boolean;
  /** A verdict that holds only for now. */
  readonly forNow?: boolean;
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

/** What a session the picked instance opens on a thread resumes (`threadResumeOf`). */
export interface ThreadResumeState {
  /** The agent's saved conversation, the picked instance's own or another's handed over. */
  readonly resumes: boolean;
  /**
   * The resume state another instance of the same driver left, which a person's agent pick that
   * keeps the thread hands over: `undefined` when none is, and for the picked instance's own
   * binding, which `ProviderService` resumes itself.
   */
  readonly handedOver: unknown;
}

/**
 * What the conversation saved on a thread's binding (whose instance saved it, and its cursor)
 * gives the picked instance's next session, as `ProviderService` starts it: its own instance's is
 * resumed, another instance's is handed over.
 */
export const threadResumeOf = (
  saved: { readonly instanceId: string | undefined; readonly cursor: unknown } | undefined,
  instanceId: string,
): ThreadResumeState => {
  const held = saved !== undefined && saved.instanceId !== undefined && saved.cursor != null;
  return {
    resumes: held,
    handedOver: held && saved.instanceId !== instanceId ? saved.cursor : undefined,
  };
};

/** What a session of a thread resumes, read from the thread's binding as it opens. */
export class ThreadResume extends Context.Service<
  ThreadResume,
  {
    readonly of: (input: {
      readonly thread: string;
      readonly instanceId: string;
    }) => Effect.Effect<ThreadResumeState>;
  }
>()("t3/engine/ports/ThreadResume") {}

/** One provider instance's word on the usage of the account it is signed in to. */
export interface InstanceUsage {
  readonly instanceId: string;
  readonly usage: ProviderUsageReport;
}

/**
 * What each provider instance reports of its signed-in account's usage: the reports it holds now,
 * then the reports again each time one changes (a probe, a sign-in). A verified credential can report even when its account has no
 * subscription windows. A send takes the current fingerprint so its refusal names that credential.
 */
export class ProviderUsageFeed extends Context.Service<
  ProviderUsageFeed,
  {
    readonly reports: Stream.Stream<ReadonlyArray<InstanceUsage>>;
    readonly credentialOf: (instanceId: string) => Effect.Effect<string | null>;
  }
>()("t3/engine/ports/ProviderUsageFeed") {}

/**
 * The pool's side of a lease: an archived conversation's branch given back through zcp
 * (`zcp lease release`), never forced, so zcp keeps a branch whose leases hold unsaved work. Its
 * answer is always a result, a release not made included. Absent outside Zerops: nothing releases.
 */
export class LeaseRelease extends Context.Service<
  LeaseRelease,
  {
    readonly release: (input: {
      readonly branch: string;
      readonly repo?: string;
    }) => Effect.Effect<LeaseReleaseResult>;
  }
>()("t3/engine/ports/LeaseRelease") {}

/**
 * How HQ answered a taken task's change link (`POST /api/mate/tasks/:taskId/change` by the Mate's
 * own key): `linked`; `refused` with its status and code (a task not taken on this Mate, a change
 * not its own or not open); `unreachable`, no answer HQ gave, so it is asked again.
 */
export type TaskChangeLinkResult =
  | { readonly outcome: "linked" }
  | { readonly outcome: "refused"; readonly status: number; readonly code: string | null }
  | { readonly outcome: "unreachable"; readonly why: string };

/**
 * A change a taken task's conversation opened, linked to that task in HQ, so the task ends when it
 * merges. Absent outside Zerops: no HQ, nothing linked.
 */
export class TaskChangeLink extends Context.Service<
  TaskChangeLink,
  {
    readonly link: (input: {
      readonly taskId: string;
      readonly repo: string;
      readonly number: number;
    }) => Effect.Effect<TaskChangeLinkResult>;
  }
>()("t3/engine/ports/TaskChangeLink") {}

/** The work's current orientation for a run, absent outside a Zerops project. */
export class WorkWhere extends Context.Service<
  WorkWhere,
  {
    readonly read: (input: { readonly lease?: string }) => Effect.Effect<string | null>;
  }
>()("t3/engine/ports/WorkWhere") {}
