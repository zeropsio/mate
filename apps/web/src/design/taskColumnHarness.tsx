/**
 * An automated Mate's task conversation as its column draws it: the task's card, the run's card,
 * the Mate's answer ending on its question, and what a person said of the task after, each row in
 * the timeline's own frame (`TimelineRowContent`), so their edges can be measured against each
 * other. Served by `/design-automated.html?unit=column` (`?theme=dark`), at the owner's
 * 1786 × 1000 beside the 435 px menu; the column is the conversation's (max-w-3xl).
 *
 * Fixtures only. Nothing here ships.
 */
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { EnvironmentId, MessageId, TurnId, type MateTaskSource } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { assembleRecordCard } from "~/components/chat/MessagesTimeline.logic";
import type { MessagesTimelineRow, RecordItem } from "~/components/chat/MessagesTimeline.logic";
import { TimelineRowContent } from "~/components/chat/TimelineRowFrame";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import { MateTaskCardView } from "~/components/zerops/MateTaskCard";
import { InventoryContext } from "~/zerops/inventoryContext";
import { stepOf } from "~/zerops/runSteps/steps";
import { ZeropsDataContext } from "~/zerops/zeropsDataContext";
import type { WorkLogEntry } from "~/session-logic";
import { harnessAppearance } from "./harnessPage";

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const TURN = TurnId.make("turn-question");

const TASK: MateTaskSource = {
  kind: "board",
  putBy: "u-ales",
  title: "Pick a number for the welcome banner",
};

const command = (id: string, text: string, at: number): RecordItem => {
  const entry: WorkLogEntry = {
    id,
    createdAt: ago(at + 2),
    label: "Command run",
    tone: "tool",
    sourceActivityKind: "tool.completed",
    toolLifecycleStatus: "completed",
    itemType: "command_execution",
    command: text,
    startedAt: ago(at + 2),
    updatedAt: ago(at),
  };
  return { kind: "step", key: `step:${id}`, at: ago(at), step: stepOf(entry, undefined, false) };
};

const ITEMS: ReadonlyArray<RecordItem> = [
  command("c1", "cat src/banner.tsx", 40),
  command("c2", "cat src/copy.ts", 30),
];

const ROWS: ReadonlyArray<MessagesTimelineRow> = [
  {
    kind: "record",
    id: "record:question",
    createdAt: ago(45),
    turnKey: "question",
    live: false,
    items: ITEMS,
    ...assembleRecordCard({ items: ITEMS, now: null, answering: false, outcome: null }),
    now: null,
    answering: false,
    status: {
      live: false,
      face: "idle",
      startedAt: ago(45),
      endedAt: ago(5),
      waitedMs: 0,
      waitingSince: null,
      worked: true,
    },
    outcome: null,
    gap: "turn",
    card: "top",
    cardWhole: true,
  },
  { kind: "card-end", id: "card-end:question", createdAt: ago(5), card: "bottom", cardWhole: true },
  {
    kind: "message",
    id: "message:question",
    createdAt: ago(5),
    message: {
      id: MessageId.make("message-question"),
      role: "assistant",
      text: "The banner reads its number from the copy file, and both fit.\n\nQUESTION: Which number do you prefer, 1 or 2?",
      turnId: TURN,
      streaming: false,
      createdAt: ago(5),
      updatedAt: ago(5),
    },
    receipt: null,
    aside: false,
    imageOnly: false,
    showAssistantMeta: true,
    gap: "part-words",
  },
  {
    kind: "task-message",
    id: "task-message:answer",
    createdAt: ago(2),
    message: { id: "m1", from: "reply", author: "Ales Rechtorik", text: "2" },
    gap: "turn",
  },
];

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: harnessAppearance,
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  speaker: { name: "Raya", tint: "amber" },
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: null,
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
  automatedTask: { source: TASK, taskId: "task-31" },
};

/** The contexts a conversation row reads, with nothing behind them. */
function Standins({ children }: { readonly children: ReactNode }) {
  const notHere = () => {
    throw new Error("not in the harness");
  };
  return (
    <ZeropsDataContext
      value={{
        scope: {} as AccountScope,
        signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
        organizationRef: notHere,
        projectRef: notHere,
      }}
    >
      <InventoryContext
        value={{
          projects: [],
          isLoading: false,
          error: null,
          projectRefs: new Map(),
          authority: new Map(),
          lost: new Set(),
          deleted: [],
        }}
      >
        <TimelineRowCtx value={SHARED}>
          <TimelineRowActivityCtx
            value={{
              isWorking: false,
              isCompacting: false,
              latestTurnId: TURN,
              workingStepLabel: null,
            }}
          >
            {children}
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </InventoryContext>
    </ZeropsDataContext>
  );
}

export function TaskColumn() {
  return (
    <Standins>
      <div className="flex min-h-screen bg-background text-foreground">
        <div className="w-[435px] shrink-0 border-e border-border bg-sidebar" />
        <div className="min-w-0 flex-1 px-8 py-10">
          <div className="mx-auto w-full max-w-3xl" data-harness="task-column">
            {/* The task's card stands in the timeline's frame as `rowInset` draws a task-ask row:
                its card needs its Mate, which the harness has not, so it is the view here. */}
            <div className="px-3.25 sm:px-4.25" data-col-row="task-ask">
              <MateTaskCardView
                origin={{ words: "Put on board by you" }}
                session={{
                  status: "waiting",
                  taskId: "task-31",
                  stoppable: true,
                  workedMs: 61_000,
                  spentUsd: 0.04,
                  change: null,
                  pullRequest: null,
                }}
                task={TASK}
                text="Pick a number for the welcome banner"
              />
            </div>
            {ROWS.map((row) => (
              <TimelineRowContent key={row.id} row={row} />
            ))}
          </div>
        </div>
      </div>
    </Standins>
  );
}
