/**
 * ThreadUsagePauseReactorLive — one pause per usage limit, and the resume at
 * its reset (`orchestration/usagePause.ts` for the why and the decisions).
 *
 * Provider runtime events feed it: a window reported blocked pauses the
 * thread (`thread.usage-pause.set`), a background result arriving while paused
 * is counted as held, and a turn that completes lifts the pause. Each pause
 * arms a timer for its reset; when it fires the pause is cleared and, unless
 * the thread's switch is off or a turn is already under way, the server sends
 * `USAGE_LIMIT_RESUME_PROMPT` as the thread's next turn. Pauses live in the
 * projection, so a restart re-arms them — and a reset that passed while the
 * server was down resumes at once.
 *
 * Everything runs on one worker, in arrival order, so a count or a timer is
 * never raced by the next event.
 *
 * @module ThreadUsagePauseReactor
 */
import {
  CommandId,
  MessageId,
  type ProviderRuntimeEvent,
  type ThreadId,
  type ThreadUsagePause,
  type ThreadUsagePauseState,
} from "@t3tools/contracts";
import { makeDrainableWorker, type DrainableWorker } from "@t3tools/shared/DrainableWorker";
import { USAGE_LIMIT_RESUME_PROMPT } from "@t3tools/shared/userAsk";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ThreadUsagePauseReactor,
  type ThreadUsagePauseReactorShape,
} from "../Services/ThreadUsagePauseReactor.ts";
import {
  isHeldBackgroundResult,
  liftsUsagePause,
  pauseForBlock,
  resumeDelayMs,
  resumesAtReset,
} from "../usagePause.ts";

type Work =
  | { readonly kind: "recover" }
  | { readonly kind: "runtime"; readonly event: ProviderRuntimeEvent }
  | { readonly kind: "reset"; readonly threadId: ThreadId; readonly resetsAt: string };

// Only these runtime events can change a pause; the rest never reach the worker.
function concernsUsagePause(event: ProviderRuntimeEvent): boolean {
  return (
    (event.type === "account.rate-limits.updated" && event.payload.blocked !== undefined) ||
    event.type === "task.completed" ||
    event.type === "turn.completed"
  );
}

function pauseState(pause: ThreadUsagePause): ThreadUsagePauseState {
  const { autoResume: _autoResume, ...state } = pause;
  return state;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Effect.scope;

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const serverId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => `${tag}:${uuid}`));

  // The armed reset per paused thread. Every pause has one, so a thread
  // missing here is not paused and its events need no read.
  const resets = new Map<
    ThreadId,
    { readonly resetsAt: string; readonly fiber: Fiber.Fiber<void> }
  >();
  let worker: DrainableWorker<Work>;

  const readShell = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadShellById(threadId).pipe(Effect.map(Option.getOrUndefined));

  const armReset = Effect.fn("ThreadUsagePauseReactor.armReset")(function* (
    threadId: ThreadId,
    pause: Pick<ThreadUsagePauseState, "resetsAt"> | null,
  ) {
    const armed = resets.get(threadId);
    if (armed !== undefined && armed.resetsAt === pause?.resetsAt) return;
    if (armed !== undefined) {
      resets.delete(threadId);
      yield* Fiber.interrupt(armed.fiber);
    }
    if (pause === null) return;
    const delay = resumeDelayMs(pause, yield* Clock.currentTimeMillis);
    const fiber = yield* Effect.sleep(Duration.millis(delay)).pipe(
      Effect.andThen(
        Effect.suspend(() => worker.enqueue({ kind: "reset", threadId, resetsAt: pause.resetsAt })),
      ),
      Effect.forkIn(scope),
    );
    resets.set(threadId, { resetsAt: pause.resetsAt, fiber });
  });

  const setPause = Effect.fn("ThreadUsagePauseReactor.setPause")(function* (
    threadId: ThreadId,
    usagePause: ThreadUsagePauseState | null,
  ) {
    yield* orchestrationEngine.dispatch({
      type: "thread.usage-pause.set",
      commandId: CommandId.make(yield* serverId("server:usage-pause")),
      threadId,
      usagePause,
      createdAt: yield* nowIso,
    });
    yield* armReset(threadId, usagePause);
  });

  const onRuntimeEvent = Effect.fn("ThreadUsagePauseReactor.onRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const blocked =
      event.type === "account.rate-limits.updated" ? event.payload.blocked : undefined;
    if (blocked === undefined && !resets.has(event.threadId)) return;
    const heldResult = isHeldBackgroundResult(event);
    const lifted = liftsUsagePause(event);
    if (blocked === undefined && !heldResult && !lifted) return;

    const shell = yield* readShell(event.threadId);
    if (shell === undefined) return;
    const current = shell.usagePause ? pauseState(shell.usagePause) : null;
    if (blocked !== undefined) {
      const next = pauseForBlock({ current, block: blocked, now: yield* nowIso });
      if (next !== undefined) yield* setPause(shell.id, next);
      return;
    }
    if (current === null) return;
    yield* setPause(shell.id, lifted ? null : { ...current, held: current.held + 1 });
  });

  const onReset = Effect.fn("ThreadUsagePauseReactor.onReset")(function* (
    threadId: ThreadId,
    resetsAt: string,
  ) {
    if (resets.get(threadId)?.resetsAt === resetsAt) resets.delete(threadId);
    const shell = yield* readShell(threadId);
    const pause = shell?.usagePause;
    // Lifted early, extended to a later reset, or the thread is gone.
    if (shell === undefined || pause == null || pause.resetsAt !== resetsAt) return;
    yield* setPause(threadId, null);
    if (
      !resumesAtReset({
        autoResume: pause.autoResume,
        sessionStatus: shell.session?.status ?? null,
      })
    )
      return;
    const resumeId = yield* serverId("usage-resume");
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(`server:${resumeId}`),
      threadId,
      message: {
        messageId: MessageId.make(resumeId),
        role: "user",
        text: USAGE_LIMIT_RESUME_PROMPT,
        attachments: [],
      },
      runtimeMode: shell.runtimeMode,
      interactionMode: shell.interactionMode,
      createdAt: yield* nowIso,
    });
  });

  // Pauses outlive the server; each one's reset is armed again.
  const recover = Effect.fn("ThreadUsagePauseReactor.recover")(function* () {
    const snapshot = yield* projectionSnapshotQuery.getShellSnapshot();
    for (const thread of snapshot.threads) {
      if (thread.usagePause) yield* armReset(thread.id, thread.usagePause);
    }
  });

  const process = (work: Work) =>
    (work.kind === "recover"
      ? recover()
      : work.kind === "runtime"
        ? onRuntimeEvent(work.event)
        : onReset(work.threadId, work.resetsAt)
    ).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("thread usage pause reactor failed to process work", {
            kind: work.kind,
            cause: Cause.pretty(cause),
          }),
      ),
    );

  worker = yield* makeDrainableWorker(process);

  const start: ThreadUsagePauseReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      worker
        .enqueue({ kind: "recover" })
        .pipe(
          Effect.andThen(
            Stream.runForEach(providerService.streamEvents, (event) =>
              concernsUsagePause(event) ? worker.enqueue({ kind: "runtime", event }) : Effect.void,
            ),
          ),
        ),
    );
  });

  return { start, drain: worker.drain } satisfies ThreadUsagePauseReactorShape;
});

export const ThreadUsagePauseReactorLive = Layer.effect(ThreadUsagePauseReactor, make);
