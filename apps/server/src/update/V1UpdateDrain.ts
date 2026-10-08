import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  IsoDateTime,
  type OrchestrationSession,
  type ThreadId,
} from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../orchestration/Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../orchestration/Services/ProviderRuntimeIngestion.ts";
import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
import { ThreadUsagePauseReactor } from "../orchestration/Services/ThreadUsagePauseReactor.ts";
import { ThreadBackgroundLivenessService } from "../orchestration/ThreadBackgroundLiveness.ts";
import { nativeResumeBlocker, type ResumeBinding } from "./NativeResume.ts";
import type { MateUpdateDrain, UpdateIdleFacts } from "./MateUpdateDrain.ts";

export class V1UpdateDrain extends Context.Service<V1UpdateDrain, MateUpdateDrain>()(
  "t3/update/V1UpdateDrain",
) {}

export const v1ThreadBlockers = (thread: {
  readonly session: Pick<OrchestrationSession, "status" | "activeTurnId"> | null;
  readonly latestTurn: { readonly state: string } | null;
  readonly titleRegeneration?: unknown;
}): ReadonlyArray<string> => {
  const blockers: string[] = [];
  if (thread.session?.activeTurnId != null || thread.latestTurn?.state === "running")
    blockers.push("active turn");
  if (thread.session?.status === "starting" || thread.session?.status === "running")
    blockers.push("session opening or running");
  if (thread.titleRegeneration != null) blockers.push("title generation");
  return blockers;
};

/** Legacy stop failures are recorded as activity, so the receipt alone cannot prove native exit. */
export const quiesceV1NativeSessions = (ports: {
  readonly closed: Effect.Effect<boolean>;
  readonly facts: Effect.Effect<UpdateIdleFacts>;
  readonly sessions: Effect.Effect<ReadonlyArray<{ readonly threadId: ThreadId }>>;
  readonly stop: (threadId: ThreadId) => Effect.Effect<void>;
  readonly settle: Effect.Effect<void>;
}): Effect.Effect<UpdateIdleFacts> =>
  Effect.gen(function* () {
    if (!(yield* ports.closed)) return { idle: false, blockers: ["admission is open"] };
    const before = yield* ports.facts;
    if (!before.idle) return before;
    return yield* Effect.gen(function* () {
      for (const session of yield* ports.sessions) yield* ports.stop(session.threadId);
      yield* ports.settle;
      if ((yield* ports.sessions).length > 0)
        return { idle: false, blockers: ["native session did not close"] };
      return yield* ports.facts;
    }).pipe(Effect.uninterruptible);
  });

export const makeV1UpdateDrain = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const commands = yield* ProviderCommandReactor;
  const ingestion = yield* ProviderRuntimeIngestionService;
  const checkpoints = yield* CheckpointReactor;
  const usage = yield* ThreadUsagePauseReactor;
  const background = yield* ThreadBackgroundLivenessService;
  const provider = yield* ProviderService;
  const sql = yield* SqlClient.SqlClient;
  const admission = engine.updateAdmission;
  const unavailable: UpdateIdleFacts = {
    idle: false,
    blockers: ["legacy engine admission or receipt boundary unavailable"],
  };

  const facts = Effect.gen(function* () {
    if (
      admission === undefined ||
      engine.updateReadModel === undefined ||
      provider.eventBarrier === undefined
    )
      return unavailable;
    yield* commands.drain;
    yield* ingestion.drain;
    yield* checkpoints.drain;
    yield* usage.drain;
    const before = yield* engine.latestSequence;
    const position = yield* provider.eventBarrier.position;
    const blockers: string[] = [];
    if (position.processing > 0) blockers.push("provider binding write or callback");
    for (const [name, reactor, needsDomain] of [
      ["provider commands", commands, true],
      ["provider ingestion", ingestion, true],
      ["checkpoints", checkpoints, true],
      ["usage pause", usage, false],
    ] as const) {
      const boundary = reactor.updateBoundary;
      if (boundary === undefined) {
        blockers.push(`${name} receipt boundary unavailable`);
        continue;
      }
      const seen = yield* boundary.position;
      if (
        !seen.started ||
        (needsDomain && seen.domain !== before) ||
        (name !== "provider commands" && seen.runtime !== position.published)
      )
        blockers.push(`${name} pending input`);
    }
    blockers.push(...(yield* commands.updateBlockers ?? Effect.succeed(["provider work unknown"])));
    const snapshot = yield* engine.updateReadModel;
    const pendingRequests = yield* sql<{
      readonly thread_id: string;
    }>`SELECT thread_id FROM projection_threads WHERE pending_approval_count > 0 OR pending_user_input_count > 0 OR has_actionable_proposed_plan = 1`;
    blockers.push(...pendingRequests.map((request) => `${request.thread_id}: open request`));
    const sessions = yield* provider.listSessions();
    for (const thread of snapshot.threads) {
      blockers.push(...v1ThreadBlockers(thread).map((reason) => `${thread.id}: ${reason}`));
      if (background.getThreadBackgroundLiveness(thread.id) !== null)
        blockers.push(`${thread.id}: live background work`);
      const live = sessions.find((session) => session.threadId === thread.id);
      const [binding] =
        yield* sql<ResumeBinding>`SELECT provider_name, provider_instance_id, resume_cursor_json FROM provider_session_runtime WHERE thread_id = ${thread.id}`;
      if (binding === undefined && thread.session === null && live === undefined) continue;
      const driver = binding?.provider_name === "claudeAgent" ? "claude" : binding?.provider_name;
      const reason = yield* nativeResumeBlocker({
        driver,
        nativeRef: thread.id,
        thread: thread.id,
        instanceId: thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
        binding,
        ...(live === undefined ? {} : { liveCursor: live.resumeCursor }),
      });
      if (reason !== undefined) blockers.push(`${thread.id}: ${reason}`);
    }
    for (const session of sessions) {
      if (!snapshot.threads.some((thread) => thread.id === session.threadId))
        blockers.push("provider session has no legacy engine record");
      if (
        session.activeTurnId != null ||
        session.status === "running" ||
        session.status === "connecting"
      )
        blockers.push("live provider turn or session transition");
    }
    const finalPosition = yield* provider.eventBarrier.position;
    if (
      (yield* engine.latestSequence) !== before ||
      finalPosition.published !== position.published ||
      finalPosition.processing > 0
    )
      blockers.push("legacy state changed during idle proof");
    return { idle: blockers.length === 0, blockers };
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed<UpdateIdleFacts>({
        idle: false,
        blockers: ["legacy engine state unreadable"],
      }),
    ),
  );

  const quiesce = quiesceV1NativeSessions({
    closed: admission?.closed ?? Effect.succeed(false),
    facts,
    sessions: provider.listSessions().pipe(Effect.orDie),
    stop: (threadId) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* engine
          .dispatch({
            type: "thread.session.stop",
            commandId: CommandId.make(`update-close:${threadId}:${now}`),
            threadId,
            createdAt: IsoDateTime.make(DateTime.formatIso(yield* DateTime.now)),
          })
          .pipe(Effect.orDie);
      }),
    settle: commands.drain.pipe(
      Effect.andThen(ingestion.drain),
      Effect.andThen(checkpoints.drain),
      Effect.andThen(usage.drain),
    ),
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed<UpdateIdleFacts>({
        idle: false,
        blockers: ["native sessions could not quiesce"],
      }),
    ),
  );

  return V1UpdateDrain.of({
    begin: admission?.begin ?? Effect.void,
    cancel: (admission?.cancel ?? Effect.void).pipe(
      Effect.andThen(usage.resumeDeferred ?? Effect.void),
    ),
    facts,
    quiesce,
    changes: Stream.mergeAll(
      [
        admission?.changes ?? Stream.empty,
        engine.streamDomainEvents.pipe(Stream.map(() => void 0)),
        provider.eventBarrier?.changes ?? Stream.empty,
        commands.updateBoundary?.changes ?? Stream.empty,
        ingestion.updateBoundary?.changes ?? Stream.empty,
        checkpoints.updateBoundary?.changes ?? Stream.empty,
        usage.updateBoundary?.changes ?? Stream.empty,
      ],
      { concurrency: "unbounded" },
    ),
  });
});

export const v1UpdateDrainLayer = Layer.effect(V1UpdateDrain, makeV1UpdateDrain);
