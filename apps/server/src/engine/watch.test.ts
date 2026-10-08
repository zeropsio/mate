/**
 * The engine's watch lines: what an operator reads in the server log when a Mate misbehaves. Each
 * line is driven through a conversation's actor, the one place a commit becomes the record.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as TestClock from "effect/testing/TestClock";
import { effectId, type ConversationId, type EffectId } from "@t3tools/contracts";

import type { Command } from "./domain/command.ts";
import * as ConversationsModule from "./Conversations.ts";
import { Conversations } from "./Conversations.ts";
import * as EngineSignals from "./EngineSignals.ts";
import { makeEngineStore, EngineStore } from "./store/EngineStore.ts";
import {
  conversation,
  envelope,
  opened,
  prepared,
  r,
  send,
  sent,
  signal,
  sqliteWithEngineTables,
  turn,
} from "./testing/fixtures.ts";

interface Line {
  readonly level: string;
  readonly message: string;
  readonly fields: Record<string, unknown>;
}

/** The engine on an in-memory database, with every log line it writes kept. */
const watched = <A, E>(body: (lines: Array<Line>) => Effect.Effect<A, E, Conversations>) => {
  const lines: Array<Line> = [];
  const logger = Logger.make(({ logLevel, message }) => {
    const parts = Array.isArray(message) ? message : [message];
    const [first, second] = parts;
    if (typeof first !== "string" || !first.startsWith("Mate engine:")) return;
    lines.push({
      level: logLevel,
      message: first,
      fields: typeof second === "object" && second !== null ? (second as never) : {},
    });
  });
  const engine = ConversationsModule.layer().pipe(
    Layer.provideMerge(
      Layer.mergeAll(Layer.effect(EngineStore, makeEngineStore()), EngineSignals.layer),
    ),
    Layer.provideMerge(sqliteWithEngineTables),
  );
  return body(lines).pipe(
    Effect.provide(Layer.merge(engine, Logger.layer([logger], { mergeWithExisting: false }))),
  );
};

/** Everything the lines say, as one text. */
const said = (lines: ReadonlyArray<Line>) =>
  lines
    .map((line) => [line.message, ...Object.values(line.fields).map(String)].join(" "))
    .join("\n");

const ENGINE = { kind: "engine" } as const;
const SECRET_WORDS = "deploy with the token zrp_live_7f3a in prod";

const tell = (command: Command, by: "person" | "engine" = "engine") =>
  Effect.flatMap(Conversations, (conversations) =>
    conversations.tell(
      by === "engine" ? { ...envelope(command), principal: ENGINE } : envelope(command),
    ),
  );

const historyEffect = (c: ConversationId) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const state = yield* conversations.state(c);
    const id = Object.keys(state.effects).find((key) => key.includes("/e/history.import/"));
    if (id === undefined) throw new Error("no import effect is queued");
    return id as EffectId;
  });

describe("the engine's watch lines", () => {
  it.effect.each([
    {
      name: "complete",
      end: { kind: "ok", value: { done: true } } as const,
      brought: 3,
      expected: { state: "complete", runs: 2, records: 3, ms: 1_500 },
      level: "Info",
    },
    {
      name: "failed",
      end: { kind: "failed", reason: "V1's tables could not be read" } as const,
      brought: 0,
      expected: {
        state: "failed",
        runs: 2,
        records: 0,
        ms: 1_500,
        reason: "V1's tables could not be read",
      },
      level: "Warn",
    },
  ])("the import's end is logged with what it brought over ($name)", (row) =>
    watched((lines) =>
      Effect.gen(function* () {
        yield* tell({
          _tag: "ImportHistory",
          source: { kind: "v1", threadId: "thread-1" },
          runs: 2,
        });
        const id = yield* historyEffect(conversation);
        yield* TestClock.adjust(1_500);
        if (row.brought > 0) {
          yield* tell({
            _tag: "HistoryBatch",
            effectId: id,
            from: 0,
            to: row.brought,
            records: [],
            details: [],
            data: [],
          });
        }
        yield* tell({ _tag: "EffectSettled", effectId: id, outcome: row.end });
        const ends = lines.filter((line) => line.message === "Mate engine: an import ended");
        expect(ends).toEqual([
          {
            level: row.level,
            message: "Mate engine: an import ended",
            fields: { conversation, ...row.expected },
          },
        ]);
      }),
    ),
  );

  it.effect.each([
    {
      name: "failed",
      end: signal({
        kind: "turn-ended",
        turn: turn(1),
        outcome: { kind: "failed", class: "provider", words: "The agent process exited." },
        source: "agent",
      }),
      expected: { end: "failed", reason: "The agent process exited." },
      level: "Warn",
    },
    {
      name: "crashed",
      end: signal({ kind: "session-exited", reason: "exit code 137" }),
      expected: { end: "crashed", reason: "exit code 137" },
      level: "Warn",
    },
    {
      name: "cut-by-restart",
      end: {
        _tag: "Recovered",
        bootId: "boot-2" as never,
        cutEffects: [],
        words: "Zerops restarted the service after an update.",
      } satisfies Command,
      expected: { end: "cut-by-restart", reason: "Zerops restarted the service after an update." },
      level: "Info",
    },
    {
      name: "completed",
      end: signal({
        kind: "turn-ended",
        turn: turn(1),
        outcome: { kind: "completed" },
        source: "agent",
      }),
      expected: null,
      level: "",
    },
  ])(
    "a run that ends failed, crashed or cut by a restart is logged with its reason, never the person's words ($name)",
    (row) =>
      watched((lines) =>
        Effect.gen(function* () {
          yield* tell(send(SECRET_WORDS), "person");
          for (const step of [prepared(1), opened(1), sent(1), row.end]) yield* tell(step);
          const ends = lines.filter(
            (line) => line.message === "Mate engine: a run did not complete",
          );
          expect(ends).toEqual(
            row.expected === null
              ? []
              : [
                  {
                    level: row.level,
                    message: "Mate engine: a run did not complete",
                    fields: { conversation, run: r(1), ...row.expected },
                  },
                ],
          );
          expect(said(lines)).not.toContain("zrp_live");
        }),
      ),
  );

  it.effect("an effect that fails for good is logged with its kind, conversation and reason", () =>
    watched((lines) =>
      Effect.gen(function* () {
        yield* tell(send(SECRET_WORDS), "person");
        const id = effectId(r(1), "run.prepare", 1);
        yield* tell({
          _tag: "EffectSettled",
          effectId: id,
          outcome: { kind: "failed", reason: "the workspace could not be captured\n  at stack" },
        });
        const failures = lines.filter(
          (line) => line.message === "Mate engine: an effect failed for good",
        );
        expect(failures).toEqual([
          {
            level: "Warn",
            message: "Mate engine: an effect failed for good",
            fields: {
              kind: "run.prepare",
              conversation,
              effect: id,
              reason: "the workspace could not be captured",
            },
          },
        ]);
        expect(said(lines)).not.toContain("zrp_live");
      }),
    ),
  );
});
