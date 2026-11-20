/**
 * The one-time import of a conversation's history.
 *
 * @module engine/domain/decide.history
 */
import {
  runId as deriveRunId,
  type EffectId,
  type EffectOutcome,
  type RunId,
  ItemId,
} from "@t3tools/contracts";

import type { Command, ImportedRecord } from "./command.ts";
import { ENGINE_ACTOR, Rejected, type StepBuilder } from "./decide.step.ts";
import { admitNext } from "./decide.runs.ts";

/** The cause every import effect derives its id from: one import per conversation. */
const historyCause = (b: StepBuilder) => `${b.state.conversationId}/history`;

/** The effect that reads the plan's records from `cursor` on: one per batch, by where it starts. */
const askHistory = (b: StepBuilder, cursor: number): void => {
  const history = b.state.history;
  if (history === null) return;
  b.effect("history.import", historyCause(b), cursor + 1, null, {
    source: history.source,
    runs: history.runs,
    cursor,
  });
};

/**
 * The earlier record is copied in once, before the conversation runs anything of its own: its
 * turns take the first ordinals, so they read before every run of the engine's. A conversation
 * that already ran, or already imported, takes nothing.
 */
export const importHistory = (
  b: StepBuilder,
  command: Extract<Command, { readonly _tag: "ImportHistory" }>,
): void => {
  if (b.state.history !== null || b.state.archived) return;
  if (b.state.nextRunOrdinal !== 1) return;
  if (command.unread !== undefined) {
    // Nothing could be read: the gap is said where the earlier record would have been.
    b.emit({ _tag: "HistoryImportStarted", source: command.source, runs: 0 });
    return endHistoryFailed(b, command.unread);
  }
  if (command.runs < 1) return;
  b.emit({ _tag: "HistoryImportStarted", source: command.source, runs: command.runs });
  askHistory(b, 0);
};

/** Whether a batch's record sits where the import reserved it: ids derive from their cause. */
const placed = (b: StepBuilder, runs: number, record: ImportedRecord): boolean => {
  const conversation = b.state.conversationId;
  const ofRun = (run: RunId | null) => {
    if (run === null) return false;
    const ordinal = Number(run.slice(`${conversation}/r/`.length));
    return (
      Number.isInteger(ordinal) &&
      ordinal >= 1 &&
      ordinal <= runs &&
      run === deriveRunId(conversation, ordinal)
    );
  };
  switch (record._tag) {
    case "RunImported":
      return record.runId === deriveRunId(conversation, record.ordinal) && ofRun(record.runId);
    case "ItemImported":
      return record.runId === null
        ? record.itemId.startsWith(`${historyCause(b)}/`)
        : ofRun(record.runId) && record.itemId.startsWith(`${record.runId}/i/`);
    case "RequestImported":
      return ofRun(record.runId) && record.requestId.startsWith(`${record.runId}/q/`);
  }
};

/** One batch of the earlier record: its records, then how far the import has come. */
export const historyBatch = (
  b: StepBuilder,
  command: Extract<Command, { readonly _tag: "HistoryBatch" }>,
): void => {
  const history = b.state.history;
  if (history?.state !== "importing") {
    throw new Rejected("invalid-signal", "No import of the earlier record is under way.");
  }
  if (command.from !== history.cursor || command.to <= command.from) {
    throw new Rejected(
      "invalid-signal",
      `The batch reads ${command.from}..${command.to}; the import is at ${history.cursor}.`,
    );
  }
  for (const record of command.records) {
    if (!placed(b, history.runs, record)) {
      throw new Rejected("invalid-signal", `An imported record is out of place: ${record._tag}.`);
    }
    b.emit(record);
  }
  b.details.push(...command.details);
  b.data.push(...command.data);
  b.emit({ _tag: "HistoryBatchImported", cursor: command.to });
};

/** What an import's read came to: the next batch, the end, or what could not be brought over. */
export const historySettled = (b: StepBuilder, id: EffectId, outcome: EffectOutcome): void => {
  const history = b.state.history;
  if (history?.state !== "importing") return admitNext(b);
  const started = Number(id.slice(id.lastIndexOf("/") + 1)) - 1;
  const value = outcome.kind === "ok" ? (outcome.value as { done?: unknown } | undefined) : null;
  if (value != null && value.done === true) {
    b.emit({ _tag: "HistoryImportEnded", outcome: "complete" });
    return admitNext(b);
  }
  if (outcome.kind === "ok" && history.cursor > started) return askHistory(b, history.cursor);
  const reason =
    outcome.kind === "ok"
      ? "the import read nothing more"
      : outcome.kind === "failed" || outcome.kind === "cut"
        ? outcome.reason
        : outcome.kind === "timed-out"
          ? "the earlier record took too long to read"
          : `an outcome this build does not know (${outcome.type})`;
  endHistoryFailed(b, reason);
};

/** An import that could not bring everything: a marker says so, and the queue moves. */
const endHistoryFailed = (b: StepBuilder, reason: string): void => {
  b.emit({
    _tag: "ItemImported",
    runId: null,
    itemId: ItemId.make(`${historyCause(b)}/failed`),
    by: ENGINE_ACTOR,
    body: {
      kind: "marker",
      marker: {
        kind: "error",
        reason: `The earlier conversation could not all be brought over: ${reason}`,
      },
    },
    happenedAt: b.now,
  });
  b.emit({ _tag: "HistoryImportEnded", outcome: "failed", reason });
  admitNext(b);
};
