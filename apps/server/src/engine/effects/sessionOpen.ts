/**
 * `session.open` (process-bound, lane `turn`): the conversation's session, opened as the engine
 * asked — never as a side effect of a send, a Stop or an answer.
 *
 * A session ProviderService already holds live on the conversation's thread is adopted, never
 * restarted (`startSession` would kill it); otherwise one starts with the conversation's runtime
 * mode (the workspace's until a person set one), resuming from the thread's binding when there is
 * one — a binding another instance of the driver left too, which ProviderService resumes only
 * when their resume state is compatible. The session says which model options it takes per turn. The handler records its own settlement before it opens the
 * session's gate, since the actor refuses a session's boundaries until its open has committed;
 * the worker's settlement after it is the same receipt.
 *
 * @module engine/effects/sessionOpen
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import {
  SessionId,
  type ConversationId,
  type EffectOutcome,
  type ProviderOptionSelection,
  type RuntimeMode,
  type SessionCapabilities,
} from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { DRIVER_CAPABILITIES } from "../bridge/capabilities.ts";
import type { BridgeDriver } from "../bridge/spi3.ts";
import { Conversations } from "../Conversations.ts";
import type { SessionOpenedValue } from "../domain/decide.ts";
import { effectSettledCommandId } from "../domain/ids.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { AgentWorkspace, HandedOverResume } from "../ports.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { bounded, failed, knownDriver, recovering, timedOut, wordsOf } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly instanceId: string | null;
  readonly driver: string | null;
  readonly model: string | null;
  /** The agent's model options (absent from a payload a build before them wrote). */
  readonly options?: ReadonlyArray<ProviderOptionSelection> | null;
  readonly resume: string | null;
  readonly rotateFrom: string | null;
  /** The conversation's thread generation (absent from an open asked before it existed: 1). */
  readonly generation?: number;
  /** A rotation's open: a fresh thread (or a resumed one), told `seed` as it starts. */
  readonly fresh?: boolean;
  readonly seed?: string | null;
  /** The runtime mode a person set; absent: the workspace's. */
  readonly runtimeMode?: RuntimeMode;
}

const ENGINE = { kind: "engine" } as const;

export const makeSessionOpen = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;
  const conversations = yield* Conversations;
  const workspace = yield* AgentWorkspace;
  const sql = yield* SqlClient.SqlClient;
  const handedOver = yield* HandedOverResume;

  /** The model options a session of this driver takes on its next send, as V1 decides it. */
  const inSessionOptions = (driver: BridgeDriver, instanceId: string) =>
    DRIVER_CAPABILITIES[driver].modelOptions === "per-turn"
      ? Effect.succeed<NonNullable<SessionCapabilities["inSessionOptions"]>>("all")
      : provider.getCapabilities(instanceId as never).pipe(
          Effect.map((capabilities): NonNullable<SessionCapabilities["inSessionOptions"]> => [
            ...(capabilities.inSessionModelOptions ?? []),
          ]),
          // Unknown: every change waits for a new session, never applied to the wrong one.
          Effect.orElseSucceed(() => []),
        );

  /** `<thread>.<n>`: the conversation's n-th open, the same id for the same effect after a crash. */
  const sessionIdOf = (thread: string, conversation: ConversationId, effectId: string) =>
    sql<{ readonly n: number }>`
      SELECT count(*) AS n FROM engine_effect
      WHERE conversation_id = ${conversation} AND kind = 'session.open'
        AND rowid <= (SELECT rowid FROM engine_effect WHERE effect_id = ${effectId})
    `.pipe(Effect.map((rows) => SessionId.make(`${thread}.${rows[0]?.n ?? 1}`)));

  return {
    kind: "session.open",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as Payload;
        if (payload.instanceId === null || payload.driver === null) {
          return failed("The conversation has no agent to open a session for.");
        }
        if (!knownDriver(payload.driver)) {
          return failed(`The engine cannot run the ${payload.driver} driver yet.`);
        }
        const driver = payload.driver;
        const host = yield* pump.hostFor(row.conversationId, driver, payload.generation ?? 1);
        const session = yield* sessionIdOf(host.thread, row.conversationId, row.effectId);
        const setup = yield* workspace.of(row.conversationId).pipe(
          Effect.catchTags({
            WorkspaceUnavailable: (unavailable) => Effect.succeed(unavailable),
          }),
        );
        // A workspace that cannot be told now (a crewmate's copy unread) opens nothing anywhere
        // else: the open is tried again, over minutes, as the copy's own effects are.
        if ("_tag" in setup)
          return { _tag: "Retry", reason: setup.message, patient: true } as const;
        yield* host.begin(session);
        const live = (yield* provider.listSessions()).find(
          (candidate) =>
            String(candidate.threadId) === host.thread && candidate.status !== "closed",
        );
        let opened = live;
        const runtimeMode = payload.runtimeMode ?? setup.runtimeMode;
        if (live !== undefined) {
          yield* host.record({ kind: "start", session, from: "resume" });
          yield* host.record({ kind: "started", resume: live.resumeCursor });
        } else {
          yield* host.record({
            kind: "start",
            session,
            from:
              payload.fresh === true
                ? payload.seed == null
                  ? "fresh"
                  : "seeded"
                : payload.resume === null && payload.rotateFrom === null
                  ? "fresh"
                  : "resume",
          });
          const resumeCursor = yield* handedOver.of({
            thread: host.thread,
            instanceId: payload.instanceId,
          });
          const started = yield* Effect.exit(
            bounded(
              provider.startSession(host.thread, {
                threadId: host.thread,
                providerInstanceId: payload.instanceId as never,
                cwd: setup.cwd,
                runtimeMode,
                ...(resumeCursor === undefined ? {} : { resumeCursor }),
                ...(payload.model === null
                  ? {}
                  : {
                      modelSelection: {
                        instanceId: payload.instanceId as never,
                        model: payload.model,
                        ...(payload.options == null ? {} : { options: payload.options }),
                      },
                    }),
              }),
            ),
          );
          if (started._tag === "Success" && started.value._tag === "None") {
            yield* host.record({
              kind: "start-failed",
              words: "The session did not open in time.",
            });
            yield* host.discard(session);
            return timedOut;
          }
          if (started._tag === "Failure") {
            if (Cause.hasInterrupts(started.cause)) return yield* Effect.failCause(started.cause);
            const words = wordsOf(started.cause);
            yield* host.record({ kind: "start-failed", words });
            yield* host.discard(session);
            return failed(words);
          }
          const startedSession = Option.getOrThrow(started.value);
          opened = startedSession;
          yield* host.record({ kind: "started", resume: startedSession.resumeCursor });
        }
        const value: SessionOpenedValue = {
          sessionId: session,
          driver,
          model: opened?.model ?? payload.model,
          // The thread's binding holds the latest cursor; a later open of this thread resumes it.
          nativeRef: host.thread,
          capabilities: {
            steer: DRIVER_CAPABILITIES[driver].steer === "native",
            inSessionOptions: yield* inSessionOptions(driver, payload.instanceId),
          },
          requestedModel: payload.model,
          instanceId: payload.instanceId,
          // None asked is none: an option set later is a change.
          options: payload.options ?? [],
          // An adopted session runs the mode it was started with.
          runtimeMode: live?.runtimeMode ?? runtimeMode,
        };
        const outcome: EffectOutcome = { kind: "ok", value };
        // Committed before the gate opens: the session's boundaries never meet an actor that has
        // not seen it open.
        yield* conversations.tell({
          commandId: effectSettledCommandId(row.effectId),
          conversationId: row.conversationId,
          principal: ENGINE,
          command: { _tag: "EffectSettled", effectId: row.effectId, outcome },
        });
        yield* host.openGate(session);
        return { _tag: "Done", outcome } as const;
      }).pipe(Effect.catchCause(recovering)),
  } satisfies EffectHandler;
});
