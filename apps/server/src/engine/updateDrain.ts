import { subscribeUpdateChanges, mergeUpdateSubscriptions } from "../update/subscribeChanges.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { ConversationId } from "@t3tools/contracts";

import { ProviderService } from "../provider/Services/ProviderService.ts";
export { nativeResumeBlocker } from "../update/NativeResume.ts";
import { nativeResumeBlocker, type ResumeBinding } from "../update/NativeResume.ts";
import type { MateUpdateDrain, UpdateIdleFacts } from "../update/MateUpdateDrain.ts";
import { Conversations } from "./Conversations.ts";
import { EngineSignals } from "./EngineSignals.ts";
import { providerThreadOf, TurnPump } from "./pump/TurnPump.ts";
import { engineStateBlockers } from "./updateIdle.ts";

export const makeEngineUpdateDrain = Effect.gen(function* () {
  const conversations = yield* Conversations;
  const pump = yield* TurnPump;
  const provider = yield* ProviderService;
  const signals = yield* EngineSignals;
  const sql = yield* SqlClient.SqlClient;
  const admission = conversations.updateAdmission;
  if (admission === undefined) return undefined;

  const facts = Effect.gen(function* () {
    const blockers: string[] = [
      ...(yield* pump.updateBlockers ?? Effect.succeed(["provider pump state unknown"])),
    ];
    const position = yield* pump.updatePosition ?? Effect.succeed(undefined);
    let sessions: Awaited<Effect.Success<ReturnType<typeof provider.listSessions>>> | undefined;
    const rows = yield* sql<{
      readonly conversation_id: string;
    }>`SELECT conversation_id FROM engine_conversation WHERE owner_kind = 'conversation'`;
    for (const row of rows) {
      const state = yield* conversations.state(ConversationId.make(row.conversation_id));
      blockers.push(
        ...engineStateBlockers(state).map((reason) => `${row.conversation_id}: ${reason}`),
      );
      if (state.session === null && state.lastNativeRef === null) continue;
      const driver = state.session?.driver ?? state.agent?.driver;
      const nativeRef = state.session?.nativeRef ?? state.lastNativeRef;
      const thread = providerThreadOf(state.conversationId, state.threadGeneration);
      const [binding] = yield* sql<ResumeBinding>`
        SELECT provider_name, provider_instance_id, resume_cursor_json FROM provider_session_runtime WHERE thread_id = ${thread}
      `;
      sessions ??= yield* provider.listSessions();
      const live = sessions.find((session) => session.threadId === thread);
      const reason = yield* nativeResumeBlocker({
        driver,
        nativeRef,
        thread,
        ...(live === undefined ? {} : { liveCursor: live.resumeCursor }),
        instanceId: state.session?.instanceId ?? state.agent?.instanceId,
        binding,
      });
      if (reason !== undefined) blockers.push(`${row.conversation_id}: ${reason}`);
    }
    const pending = yield* sql<{
      readonly effect_id: string;
    }>`SELECT effect_id FROM engine_effect WHERE state IN ('pending', 'running', 'settling') LIMIT 1`;
    if (pending.length > 0) blockers.push("unsettled worker receipt");
    blockers.push(
      ...(yield* pump.updateBlockers ?? Effect.succeed(["provider pump state unknown"])),
    );
    const finalPosition = yield* pump.updatePosition ?? Effect.succeed(undefined);
    if (position === undefined || finalPosition !== position)
      blockers.push("provider state changed during idle proof");
    return { idle: blockers.length === 0, blockers } satisfies UpdateIdleFacts;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("engine update drain: state unreadable", { cause }).pipe(
        Effect.as<UpdateIdleFacts>({ idle: false, blockers: ["engine state unreadable"] }),
      ),
    ),
  );

  const quiesce = Effect.gen(function* () {
    if (!(yield* admission.closed)) return { idle: false, blockers: ["admission is open"] };
    const before = yield* facts;
    if (!before.idle) return before;
    return yield* Effect.gen(function* () {
      for (const host of yield* pump.updateHosts ?? Effect.succeed([])) {
        if ((yield* host.current) === null) continue;
        // The proved-idle close must finish rather than being cut by the updater's deadline.
        yield* host.record({ kind: "stop", cause: "idle" });
        yield* provider.stopSession({ threadId: host.thread });
        yield* host.record({ kind: "stopped" });
        yield* host.settled;
      }
      return yield* facts;
    }).pipe(Effect.uninterruptible);
  }).pipe(
    Effect.catchCause(() =>
      Effect.succeed<UpdateIdleFacts>({
        idle: false,
        blockers: ["native sessions could not quiesce"],
      }),
    ),
  );

  return {
    begin: admission.begin,
    cancel: admission.cancel.pipe(Effect.andThen(signals.wakes.ring)),
    facts,
    quiesce,
    subscribeChanges: mergeUpdateSubscriptions([
      admission.subscribeChanges,
      subscribeUpdateChanges(signals.commits),
      ...(pump.subscribeUpdateChanges === undefined ? [] : [pump.subscribeUpdateChanges]),
    ]),
    changes: Stream.mergeAll(
      [
        admission.changes,
        Stream.fromPubSub(signals.commits).pipe(Stream.map(() => void 0)),
        pump.updateChanges ?? Stream.empty,
      ],
      { concurrency: "unbounded" },
    ),
  } satisfies MateUpdateDrain;
});
