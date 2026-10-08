/**
 * An engine Mate's receipts, from its records: a message whose run came read it, however the run
 * ended — a Stop before a word included (live on Milo, 2026-10-08: the stopped run drew nothing
 * and its message read "Not read yet" until the next message's run).
 */
import type { Item, RunRecord } from "@t3tools/contracts";
import {
  engineRun,
  engineThreadOfRecords,
  personItem,
} from "@t3tools/client-runtime/data/fixtures";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntries, deriveWorkLogEntries } from "../session-logic";
import type { ChatMessage } from "../types";
import { deriveMessagesTimelineRows } from "../components/chat/MessagesTimeline.logic";

const key = { environmentId: "env-ada", conversationId: "thread-ada" };
const runId = (ordinal: number) => `thread-ada/r/${ordinal}`;
const STOPPED: Partial<RunRecord> = {
  end: { kind: "stopped", by: { kind: "person", subject: "user-ada" } },
  endSource: "stop-confirmed",
};

function receipts(runs: ReadonlyArray<RunRecord>, items: ReadonlyArray<Item>) {
  const thread = engineThreadOfRecords(key, { runs, items });
  if (thread === null) throw new Error("no thread");
  const running = thread.session?.activeTurnId ?? null;
  return deriveMessagesTimelineRows({
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(thread.activities),
    ),
    latestTurn: thread.latestTurn,
    runningTurnId: running,
    isWorking: running !== null,
    activeTurnStartedAt: null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  }).flatMap((row) =>
    row.kind === "message" && row.message.role === "user" ? [[row.message.text, row.receipt]] : [],
  );
}

describe("an engine Mate's receipts", () => {
  it.each([
    {
      name: "a run stopped before a word",
      runs: [engineRun("thread-ada", 1, STOPPED)],
      items: [personItem(runId(1), 1, "Write the numbers 1 to 300.")],
      said: [["Write the numbers 1 to 300.", "seen"]],
    },
    {
      name: "two runs stopped before a word",
      runs: [engineRun("thread-ada", 1, STOPPED), engineRun("thread-ada", 2, STOPPED)],
      items: [
        personItem(runId(1), 1, "Write the numbers 1 to 300."),
        personItem(runId(2), 2, "Count to ten."),
      ],
      said: [
        ["Write the numbers 1 to 300.", "seen"],
        ["Count to ten.", "seen"],
      ],
    },
    {
      name: "a run that ended silent",
      runs: [engineRun("thread-ada", 1)],
      items: [personItem(runId(1), 1, "Say nothing.")],
      said: [["Say nothing.", "seen"]],
    },
    {
      name: "a run still queued",
      runs: [engineRun("thread-ada", 1, { state: "queued", end: null, startedAt: null })],
      items: [
        personItem(runId(1), 1, "Write the numbers 1 to 300.", {
          delivery: { state: "queued", at: null },
        }),
      ],
      said: [["Write the numbers 1 to 300.", "sent"]],
    },
  ] as const)(
    "a message whose run ended never reads not read yet: $name",
    ({ runs, items, said }) => {
      expect(receipts(runs, items)).toEqual(said);
    },
  );
});
