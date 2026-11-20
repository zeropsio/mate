import { expect, it } from "vite-plus/test";
import {
  CommandId,
  ConversationId,
  ItemId,
  effectId,
  runId,
  type EffectOutcome,
  type KnownEngineEvent,
  type Principal,
} from "@t3tools/contracts";

import type { Command, Decision, EffectDraft, ImportedRecord } from "./command.ts";
import { decide } from "./decide.ts";
import { fold, stampEvents } from "./evolve.ts";
import { initialState, type ConversationState } from "./state.ts";

const conversation = ConversationId.make("mate");
const ana: Principal = { kind: "person", subject: "ana" };
const T0 = 1_000_000_000;
const r = (n: number) => runId(conversation, n);
const source = { kind: "v1", threadId: "mate" } as const;
const importEffect = (n: number) => effectId(`${conversation}/history`, "history.import", n);

interface Scene {
  readonly state: ConversationState;
  readonly decision: Decision;
  readonly events: ReadonlyArray<KnownEngineEvent>;
  readonly effects: ReadonlyArray<EffectDraft>;
}

/** Decides each command under a literal clock, Ana sending and the engine doing the rest; the last step's scene. */
const play = (commands: ReadonlyArray<Command>): Scene => {
  let state = initialState(conversation);
  let scene: Scene | undefined;
  commands.forEach((command, index) => {
    const envelope = {
      commandId: CommandId.make(`c${index}`),
      conversationId: conversation,
      principal: command._tag === "Send" ? ana : ({ kind: "engine" } as const),
      command,
    };
    const decision = decide(state, envelope, T0 + index);
    const events =
      decision._tag === "Accept"
        ? stampEvents(state.headSeq, envelope, decision.step.events, T0 + index)
        : [];
    state = fold(state, events);
    scene = {
      state,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return scene!;
};

const tags = (events: ReadonlyArray<KnownEngineEvent>) => events.map((event) => event._tag);

const importRuns = (runs: number): Command => ({ _tag: "ImportHistory", source, runs });

const importedRun = (ordinal: number): ImportedRecord => ({
  _tag: "RunImported",
  runId: r(ordinal),
  ordinal,
  trigger: { kind: "imported", from: "v1", turn: `turn-${ordinal}` },
  principal: { kind: "engine" },
  end: { kind: "completed" },
  source: "agent",
  happenedAt: T0 - 10_000,
  startedAt: T0 - 9_000,
  endedAt: T0 - 8_000,
});

const importedNote = (ordinal: number, n: number): ImportedRecord => ({
  _tag: "ItemImported",
  runId: r(ordinal),
  itemId: ItemId.make(`${r(ordinal)}/i/${n}`),
  by: { kind: "mate" },
  body: { kind: "note", text: "done", streaming: false, answer: false },
  happenedAt: T0 - 8_500,
});

const batch = (
  from: number,
  to: number,
  records: ReadonlyArray<ImportedRecord>,
  n = from + 1,
): Command => ({
  _tag: "HistoryBatch",
  effectId: importEffect(n),
  from,
  to,
  records,
  details: [],
  data: [],
});

const settled = (n: number, outcome: EffectOutcome): Command => ({
  _tag: "EffectSettled",
  effectId: importEffect(n),
  outcome,
});

// witness: apps/server/src/engine/domain/evolve.ts | nextRunOrdinal: Math.max(state.nextRunOrdinal, event.runs + 1), → nextRunOrdinal: state.nextRunOrdinal,
it("ED18: A conversation's earlier record takes the first ordinals, so a message sent meanwhile runs after it", () => {
  const scene = play([importRuns(3), { _tag: "Send", text: "hi" }]);
  expect(scene.events[0]).toMatchObject({ _tag: "RunQueued", runId: r(4), ordinal: 4 });
  expect(tags(scene.events)).not.toContain("RunAdmitted");
  expect(scene.effects).toEqual([]);
});

// witness: apps/server/src/engine/domain/decide.runs.ts | if (b.state.history?.state === "importing") return; → if (b.state.history?.state === "complete") return;
it("ED19: The import of an earlier record holds every run until it ends, then the queue moves", () => {
  const scene = play([
    importRuns(1),
    { _tag: "Send", text: "hi" },
    batch(0, 2, [importedRun(1), importedNote(1, 1)]),
    settled(1, { kind: "ok", value: { done: true } }),
  ]);
  expect(scene.events.filter((event) => event._tag === "RunAdmitted")).toMatchObject([
    { runId: r(2) },
  ]);
  expect(scene.state.history).toMatchObject({ state: "complete", cursor: 2 });
});

// witness: apps/server/src/engine/domain/decide.history.ts | history.cursor > started) return askHistory(b, history.cursor); → history.cursor > started) return askHistory(b, started);
it("ED20: The import asks for the next batch from where the last one ended, until the read is done", () => {
  const scene = play([
    importRuns(2),
    batch(0, 2, [importedRun(1), importedNote(1, 1)]),
    settled(1, { kind: "ok", value: { done: false } }),
  ]);
  expect(scene.effects).toEqual([
    expect.objectContaining({
      effectId: importEffect(3),
      payload: { source, runs: 2, cursor: 2 },
    }),
  ]);
});

// witness: apps/server/src/engine/domain/decide.history.ts | if (command.from !== history.cursor || command.to <= command.from) { → if (command.to <= command.from) {
it("ED21: An import batch is refused when no import is under way, when it does not start where the import stands, and when it writes under another run's id", () => {
  const refused = { _tag: "Reject", rejection: { reason: "invalid-signal" } };
  // No import is under way.
  expect(play([batch(0, 1, [importedRun(1)])]).decision).toMatchObject(refused);
  // A batch that does not start where the import stands.
  expect(play([importRuns(2), batch(1, 2, [importedRun(2)])]).decision).toMatchObject(refused);
  // An item under another run's id.
  expect(
    play([
      importRuns(2),
      batch(0, 1, [{ ...(importedNote(1, 1) as object), itemId: `${r(2)}/i/1` } as ImportedRecord]),
    ]).decision,
  ).toMatchObject(refused);
});

// witness: apps/server/src/engine/domain/decide.history.ts | if (b.state.nextRunOrdinal !== 1) return; → if (b.state.nextRunOrdinal < 1) return;
it("ED22: An earlier record is imported once: asked again, or after the conversation ran, it takes nothing", () => {
  const again = play([importRuns(2), importRuns(5)]);
  expect(again.decision._tag).toBe("Accept");
  expect(again.events).toEqual([]);
  const afterRun = play([{ _tag: "Send", text: "hi" }, importRuns(2)]);
  expect(afterRun.decision._tag).toBe("Accept");
  expect(afterRun.events).toEqual([]);
});

// witness: apps/server/src/engine/domain/decide.history.ts | b.emit({ _tag: "HistoryImportEnded", outcome: "failed", reason }); → b.emit({ _tag: "HistoryImportEnded", outcome: "complete" });
it("ED23: An import that fails for good ends failed, saying what was not brought over, and lets the queue move", () => {
  const ends = (outcome: EffectOutcome, reason: string) => {
    const scene = play([importRuns(2), { _tag: "Send", text: "hi" }, settled(1, outcome)]);
    expect(scene.events.find((event) => event._tag === "ItemImported")).toMatchObject({
      runId: null,
      body: {
        kind: "marker",
        marker: {
          kind: "error",
          reason: `The earlier conversation could not all be brought over: ${reason}`,
        },
      },
    });
    expect(scene.events.find((event) => event._tag === "HistoryImportEnded")).toMatchObject({
      outcome: "failed",
      reason,
    });
    expect(tags(scene.events)).toContain("RunAdmitted");
  };
  // A read that failed for good.
  ends(
    { kind: "failed", reason: "the V1 record could not be read" },
    "the V1 record could not be read",
  );
  // A read that came no further.
  ends({ kind: "ok", value: { done: false } }, "the import read nothing more");
});
