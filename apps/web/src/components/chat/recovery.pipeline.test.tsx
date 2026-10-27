import {
  engineRun,
  noteItem,
  personItem,
  engineThreadOfRecords,
  engineRunCardsOfRecords,
  type EngineRecords,
} from "@t3tools/client-runtime/data/fixtures";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";
import { derivePhase, deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";

it("a long run stays working until the provider reports its result", () => {
  const key = { environmentId: "env-Wren", conversationId: "thread-Wren" };
  const previousAnswer = noteItem(
    `${key.conversationId}/r/1`,
    2,
    "The existing conversation is still here",
  );
  const previous = engineRun(key.conversationId, 1, {
    summary: { items: 2, calls: {}, answerItemId: previousAnswer.id, lastItemSeq: 2 },
  });
  const run = engineRun(key.conversationId, 2, { state: "running", end: null, endedAt: null });
  const items = [
    personItem(previous.id, 1, "Show the existing conversation"),
    previousAnswer,
    personItem(run.id, 1, "Begin the long inspection"),
  ];
  const started = run.startedAt!;
  const show = (records: EngineRecords, nowMs: number) => {
    const thread = engineThreadOfRecords(key, records)!;
    const working = derivePhase(thread.session) === "running";
    const rows = deriveMessagesTimelineRows({
      runCards: engineRunCardsOfRecords(key, records)!,
      timelineEntries: deriveTimelineEntries(
        thread.messages as ReadonlyArray<ChatMessage>,
        [],
        deriveWorkLogEntries(thread.activities),
      ),
      latestTurn: thread.latestTurn,
      runningTurnId: working ? thread.latestTurn!.turnId : null,
      isWorking: working,
      activeTurnStartedAt: thread.latestTurn?.startedAt ?? null,
      nowMs,
    });
    const controls = renderToStaticMarkup(
      createElement(ComposerPrimaryActions, {
        compact: true,
        pendingAction: null,
        isRunning: working,
        showPlanFollowUpPrompt: false,
        promptHasText: false,
        isSendBusy: false,
        sendDisabledReason: null,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isPreparingWorktree: false,
        hasSendableContent: false,
        onPreviousPendingQuestion: () => {},
        onInterrupt: () => {},
        onImplementPlanInNewThread: () => {},
      }),
    );
    return { thread, rows, controls };
  };
  const records = { runs: [previous, run], items };
  const later = started + 4 * 60 * 60 * 1_000;
  for (const now of [started, later]) {
    const shown = show(records, now);
    expect(shown.thread.latestTurn?.state).toBe("running");
    expect(shown.controls).toContain('aria-label="Stop generation"');
    expect(
      shown.thread.messages.filter(
        (message) => message.text === "The existing conversation is still here",
      ),
    ).toHaveLength(1);
    expect(shown.rows.findLast((row) => row.kind === "record")).toMatchObject({
      status: { live: true, face: "working" },
    });
    expect(JSON.stringify(shown.rows)).not.toContain("couldn't restart");
  }
  const finalAnswer = noteItem(run.id, 2, "The long inspection finished", { at: later });
  const completed = show(
    {
      runs: [
        previous,
        engineRun(key.conversationId, 2, {
          endedAt: later,
          summary: { items: 2, calls: {}, answerItemId: finalAnswer.id, lastItemSeq: 2 },
        }),
      ],
      items: [...items, finalAnswer],
    },
    later,
  );
  expect(completed.thread.latestTurn?.state).toBe("completed");
  expect(
    completed.thread.messages.filter((message) => message.text === "The long inspection finished"),
  ).toHaveLength(1);
  expect(completed.controls).not.toContain('aria-label="Stop generation"');
});
