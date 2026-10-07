/**
 * `session.open` (process-bound, lane `turn`): the conversation's session, opened as the engine
 * asked — never as a side effect of a send, a Stop or an answer.
 *
 * A session ProviderService already holds live on the conversation's thread is adopted, never
 * restarted (`startSession` would kill it); otherwise one starts, resuming from the thread's
 * binding when there is one. The handler records its own settlement before it opens the
 * session's gate, since the actor refuses a session's boundaries until its open has committed;
 * the worker's settlement after it is the same receipt.
 *
 * @module engine/effects/sessionOpen
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SessionId, type ConversationId, type EffectOutcome } from "@t3tools/contracts";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { DRIVER_CAPABILITIES } from "../bridge/capabilities.ts";
import { Conversations } from "../Conversations.ts";
import type { SessionOpenedValue } from "../domain/decide.ts";
import { effectSettledCommandId } from "../domain/ids.ts";
import type { EffectHandler } from "../outbox/EffectWorker.ts";
import { AgentWorkspace } from "../ports.ts";
import { TurnPump } from "../pump/TurnPump.ts";
import { failed, knownDriver, recovering, wordsOf } from "./shared.ts";

interface Payload {
  readonly runId: string;
  readonly instanceId: string | null;
  readonly driver: string | null;
  readonly model: string | null;
  readonly resume: string | null;
  readonly rotateFrom: string | null;
}

const ENGINE = { kind: "engine" } as const;

export const makeSessionOpen = Effect.gen(function* () {
  const provider = yield* ProviderService;
  const pump = yield* TurnPump;
  const conversations = yield* Conversations;
  const workspace = yield* AgentWorkspace;
  const sql = yield* SqlClient.SqlClient;

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
        const host = yield* pump.hostFor(row.conversationId, driver);
        const session = yield* sessionIdOf(host.thread, row.conversationId, row.effectId);
        const setup = yield* workspace.of(row.conversationId);
        yield* host.begin(session);
        const live = (yield* provider.listSessions()).find(
          (candidate) =>
            String(candidate.threadId) === host.thread && candidate.status !== "closed",
        );
        let opened = live;
        if (live !== undefined) {
          yield* host.record({ kind: "start", session, from: "resume" });
          yield* host.record({ kind: "started", resume: live.resumeCursor });
        } else {
          yield* host.record({
            kind: "start",
            session,
            from: payload.resume === null && payload.rotateFrom === null ? "fresh" : "resume",
          });
          const started = yield* Effect.exit(
            provider.startSession(host.thread, {
              threadId: host.thread,
              providerInstanceId: payload.instanceId as never,
              cwd: setup.cwd,
              runtimeMode: setup.runtimeMode,
              ...(payload.model === null
                ? {}
                : {
                    modelSelection: {
                      instanceId: payload.instanceId as never,
                      model: payload.model,
                    },
                  }),
            }),
          );
          if (started._tag === "Failure") {
            const words = wordsOf(started.cause);
            yield* host.record({ kind: "start-failed", words });
            yield* host.discard(session);
            return failed(words);
          }
          opened = started.value;
          yield* host.record({ kind: "started", resume: started.value.resumeCursor });
        }
        const value: SessionOpenedValue = {
          sessionId: session,
          driver,
          model: opened?.model ?? payload.model,
          // The thread's binding holds the latest cursor; a later open of this thread resumes it.
          nativeRef: host.thread,
          capabilities: { steer: DRIVER_CAPABILITIES[driver].steer === "native" },
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
