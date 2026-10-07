/**
 * Shared fixtures for the engine's tests: an in-memory SQLite with the engine's tables, a
 * conversation, people, and the commands a script plays.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CommandId,
  ConversationId,
  SessionId,
  effectId,
  runId,
  type Principal,
} from "@t3tools/contracts";

import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import type { Command, Envelope, ProviderSignal } from "./domain/command.ts";
import { decide } from "./domain/decide.ts";
import type { ConversationState } from "./domain/state.ts";
import type { Committed, EngineStoreShape } from "./store/EngineStore.ts";
import { runEngineMigrations } from "./store/migrations.ts";

export const sqliteWithEngineTables = Layer.effectDiscard(runEngineMigrations()).pipe(
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

export const conversation = ConversationId.make("mate");
export const ana: Principal = { kind: "person", subject: "ana" };
export const T0 = 1_000_000_000;
export const r = (n: number, c: ConversationId = conversation) => runId(c, n);
export const s1 = SessionId.make("s1");

let commandCounter = 0;
export const envelope = (
  command: Command,
  options: {
    readonly id?: string;
    readonly by?: Principal;
    readonly conversation?: ConversationId;
  } = {},
): Envelope => ({
  commandId: CommandId.make(options.id ?? `cmd-${++commandCounter}`),
  conversationId: options.conversation ?? conversation,
  principal: options.by ?? ana,
  command,
});

export const send = (text = "hello"): Command => ({ _tag: "Send", text });
export const opened = (run: number, c: ConversationId = conversation): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(r(run, c), "session.open", 1),
  outcome: {
    kind: "ok",
    value: {
      sessionId: "s1",
      driver: "claude",
      model: null,
      nativeRef: "native-1",
      capabilities: { steer: false },
    },
  },
});
export const sent = (run: number, c: ConversationId = conversation): Command => ({
  _tag: "EffectSettled",
  effectId: effectId(r(run, c), "provider.send", 1),
  outcome: { kind: "ok" },
});
export const signal = (...signals: ReadonlyArray<ProviderSignal>): Command => ({
  _tag: "ProviderSignals",
  sessionId: s1,
  signals,
});
export const turnEnded = signal({ kind: "turn-ended", outcome: { kind: "completed" } });

/** Decides and commits each command in turn, as the actor would; returns the last commit. */
export const drive = Effect.fnUntraced(function* (
  store: EngineStoreShape,
  state: ConversationState,
  commands: ReadonlyArray<Command | Envelope>,
  now = T0,
) {
  let current = state;
  let last: Committed | undefined;
  for (const input of commands) {
    const env = "_tag" in input ? envelope(input) : input;
    last = yield* store.commit({
      envelope: env,
      decision: decide(current, env, now),
      state: current,
      now,
    });
    current = last.state;
  }
  return { state: current, last };
});
