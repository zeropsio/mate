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

import { assembleRecordCard, rowGap } from "~/components/chat/MessagesTimeline.logic";
import type { MessagesTimelineRow, RecordItem } from "~/components/chat/MessagesTimeline.logic";
import { TimelineRowContent } from "~/components/chat/TimelineRowFrame";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import { MateTaskCardView } from "~/components/zerops/MateTaskCard";
import { BoardPlanCardView } from "~/components/zerops/board/BoardPlanCard";
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

const QUESTION_RECORD = {
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
  card: "top",
  cardWhole: true,
} satisfies MessagesTimelineRow;

/** A run's card whole: its head row and its edge's. */
const runCard = (key: string): ReadonlyArray<MessagesTimelineRow> => [
  { ...QUESTION_RECORD, id: `record:${key}`, turnKey: key },
  { kind: "card-end", id: `card-end:${key}`, createdAt: ago(5), card: "bottom", cardWhole: true },
];

const answer = (key: string, text: string, turnId: TurnId): MessagesTimelineRow => ({
  kind: "message",
  id: `message:${key}`,
  createdAt: ago(5),
  message: {
    id: MessageId.make(`message-${key}`),
    role: "assistant",
    text,
    turnId,
    streaming: false,
    createdAt: ago(5),
    updatedAt: ago(5),
  },
  receipt: null,
  aside: false,
  imageOnly: false,
  showAssistantMeta: true,
});

/** Each row's room above it as the timeline gives it (`rowGap`), under the row before it. */
const spaced = (
  rows: ReadonlyArray<MessagesTimelineRow>,
  first?: MessagesTimelineRow,
): ReadonlyArray<MessagesTimelineRow> =>
  rows.map((row, index) => {
    const previous = index === 0 ? first : rows[index - 1];
    return { ...row, gap: row.kind === "card-end" ? "none" : rowGap(previous, row) };
  });

/** The task's card heads the conversation: the rows under it are spaced from it. */
const TASK_ASK = { kind: "task-ask", id: "task-ask:31" } as MessagesTimelineRow;

/**
 * The task's conversation as the owner saw Raya's: a run that ends on its question alone, the
 * answer given on the Board, then the next run, ending on words and a question after them.
 */
const ROWS = spaced(
  [
    ...runCard("question"),
    answer("question", "QUESTION: Which number do you prefer, 1 or 2?", TurnId.make("turn-asked")),
    {
      kind: "task-message",
      id: "task-message:answer",
      createdAt: ago(2),
      message: { id: "m1", from: "reply", author: "Ales Rechtorik", text: "2" },
      taskId: "task-31",
      source: TASK,
    },
    ...runCard("again"),
    answer(
      "again",
      "The banner reads its number from the copy file, and both fit.\n\nQUESTION: Should the home page say it too?",
      TURN,
    ),
  ],
  TASK_ASK,
);

const settled = {
  live: false,
  face: "idle",
  waitedMs: 0,
  waitingSince: null,
} as const;

/**
 * A Mate's ordinary conversation, as the owner saw Mira's: a run that worked (its card holds its
 * line alone), its answer; a run that only wrote (nothing to show), its answer; the plan it puts
 * on the Board.
 */
const NORMAL_ROWS = spaced([
  ...runCard("normal"),
  answer(
    "normal-1",
    "The banner reads its number from the copy file now.",
    TurnId.make("turn-normal-1"),
  ),
  {
    kind: "work-line",
    id: "work-line:normal-2",
    createdAt: ago(30),
    stretchKey: "normal-2",
    turnId: TurnId.make("turn-normal-2"),
    ...settled,
    startedAt: ago(30),
    endedAt: ago(26),
    worked: false,
    wrote: true,
  },
  answer(
    "normal-2",
    "Here is the plan: two tasks, the second after the first.",
    TurnId.make("turn-normal-2"),
  ),
]);

const PLAN = [
  {
    key: "a",
    title: "Write the banner's copy",
    brief: "Two lines, the number first.",
    after: null,
    task: null,
  },
  {
    key: "b",
    title: "Show the banner on the home page",
    brief: "Above the fold.",
    after: "after 1",
    task: null,
  },
];

const nothing = () => undefined;

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
        <div className="grid min-w-0 flex-1 content-start gap-16 px-8 py-10">
          <div className="mx-auto w-full max-w-3xl" data-harness="normal-column">
            {NORMAL_ROWS.map((row) => (
              <TimelineRowContent key={row.id} row={row} />
            ))}
            {/* The plan's card stands as `rowInset` and `BoardRequestTimelineRow` frame it (no
                inset): its container reads the conversation, which the harness has not. */}
            <div className="pt-5" data-col-row="board-request">
              <div className="min-w-0 py-0.5">
                <BoardPlanCardView
                  appName="Nebius Demo"
                  editable
                  mateName="Mira"
                  onBrief={nothing}
                  onNotNow={nothing}
                  onPut={nothing}
                  onTitle={nothing}
                  put={false}
                  ready
                  requestId="plan-normal"
                  state={{ kind: "waiting" }}
                  tasks={PLAN}
                />
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-3xl" data-harness="task-column">
            {/* The task's card stands in the timeline's frame as `rowInset` draws a task-ask row
                (no inset): its card needs its Mate, which the harness has not, so it is the view. */}
            <div data-col-row="task-ask">
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
