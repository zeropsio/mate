import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  ItemId,
  RequestId,
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
  /** Every event of the play, in order. */
  readonly all: ReadonlyArray<KnownEngineEvent>;
}

const play = (commands: ReadonlyArray<Command>): Scene => {
  let state = initialState(conversation);
  const all: Array<KnownEngineEvent> = [];
  let scene: Omit<Scene, "all"> | undefined;
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
    all.push(...events);
    scene = {
      state,
      decision,
      events,
      effects: decision._tag === "Accept" ? decision.step.effects : [],
    };
  });
  return { ...scene!, all };
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

describe("a conversation's earlier record", () => {
  it("takes the first ordinals, so a message sent meanwhile runs after it", () => {
    const scene = play([importRuns(3), { _tag: "Send", text: "hi" }]);
    expect(scene.events[0]).toMatchObject({ _tag: "RunQueued", runId: r(4), ordinal: 4 });
    expect(tags(scene.events)).not.toContain("RunAdmitted");
    expect(scene.effects).toEqual([]);
  });

  it("is read by one effect, beside the agent's work, that a restart may run again", () => {
    const scene = play([importRuns(3)]);
    expect(tags(scene.events)).toEqual(["HistoryImportStarted", "EffectRequested"]);
    expect(scene.effects).toEqual([
      {
        effectId: importEffect(1),
        kind: "history.import",
        lane: "side",
        class: "replay-safe",
        runId: null,
        payload: { source, runs: 3, cursor: 0 },
      },
    ]);
  });

  it("holds every run until the import ends, then the queue moves", () => {
    const scene = play([
      importRuns(1),
      { _tag: "Send", text: "hi" },
      batch(0, 2, [importedRun(1), importedNote(1, 1)]),
      settled(1, { kind: "ok", value: { done: true } }),
    ]);
    expect(tags(scene.events)).toEqual([
      "EffectOutcomeRecorded",
      "HistoryImportEnded",
      "RunAdmitted",
      "EffectRequested",
    ]);
    expect(scene.events[2]).toMatchObject({ runId: r(2) });
    expect(scene.state.history).toMatchObject({ state: "complete", cursor: 2 });
  });

  it("asks for the next batch from where the last one ended, until the read is done", () => {
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

  it("is never queued, admitted or woken: the rules hold none of it", () => {
    const scene = play([
      importRuns(2),
      batch(0, 3, [importedRun(1), importedNote(1, 1), importedRun(2)]),
    ]);
    expect(scene.state.runs).toEqual({});
    expect(scene.state.queue).toEqual([]);
    expect(scene.state.items).toEqual({});
    expect(scene.state.wakes).toEqual({});
    expect(tags(scene.events)).toEqual([
      "RunImported",
      "ItemImported",
      "RunImported",
      "HistoryBatchImported",
    ]);
  });

  it.each([
    ["no import is under way", [batch(0, 1, [importedRun(1)])]],
    [
      "a batch that does not start where the import stands",
      [importRuns(2), batch(1, 2, [importedRun(2)])],
    ],
    ["a batch that reads nothing", [importRuns(2), batch(0, 0, [])]],
    ["a run past the ordinals the import reserved", [importRuns(1), batch(0, 1, [importedRun(2)])]],
    [
      "an item under another run's id",
      [
        importRuns(2),
        batch(0, 1, [
          { ...(importedNote(1, 1) as object), itemId: `${r(2)}/i/1` } as ImportedRecord,
        ]),
      ],
    ],
    [
      "a request under another run's id",
      [
        importRuns(2),
        batch(0, 1, [
          {
            _tag: "RequestImported",
            runId: r(1),
            requestId: RequestId.make(`${r(2)}/q/1`),
            ask: { kind: "approval", requestKind: "command", detail: "ls" },
            state: "answered",
            principal: { kind: "engine" },
            happenedAt: T0,
          },
        ]),
      ],
    ],
  ] as ReadonlyArray<readonly [string, ReadonlyArray<Command>]>)(
    "refuses %s",
    (_name, commands) => {
      const scene = play(commands);
      expect(scene.decision).toMatchObject({
        _tag: "Reject",
        rejection: { reason: "invalid-signal" },
      });
    },
  );

  it.each([
    ["again", [importRuns(2), importRuns(5)]],
    ["after the conversation ran", [{ _tag: "Send", text: "hi" }, importRuns(2)]],
    ["with no turns to bring", [importRuns(0)]],
  ] as ReadonlyArray<readonly [string, ReadonlyArray<Command>]>)(
    "is imported once: asked %s, it takes nothing",
    (_name, commands) => {
      const scene = play(commands);
      expect(scene.decision._tag).toBe("Accept");
      expect(scene.events).toEqual([]);
    },
  );

  it.each([
    [
      "a read that failed for good",
      { kind: "failed", reason: "the V1 record could not be read" } as EffectOutcome,
      "the V1 record could not be read",
    ],
    [
      "a read that came no further",
      { kind: "ok", value: { done: false } } as EffectOutcome,
      "the import read nothing more",
    ],
  ])(
    "ends failed after %s, saying what was not brought over, and lets the queue move",
    (_name, outcome, reason) => {
      const scene = play([importRuns(2), { _tag: "Send", text: "hi" }, settled(1, outcome)]);
      expect(tags(scene.events)).toEqual([
        "EffectOutcomeRecorded",
        "ItemImported",
        "HistoryImportEnded",
        "RunAdmitted",
        "EffectRequested",
      ]);
      expect(scene.events[1]).toMatchObject({
        runId: null,
        body: {
          kind: "marker",
          marker: {
            kind: "error",
            reason: `The earlier conversation could not all be brought over: ${reason}`,
          },
        },
      });
      expect(scene.events[2]).toMatchObject({ outcome: "failed", reason });
    },
  );
});
