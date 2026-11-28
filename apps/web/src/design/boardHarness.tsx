/**
 * The Board in a conversation: Send's split with **Put on board**, the board ask card from the
 * proposal to the task it becomes (its row following the task: queued, in progress by the pool or
 * a person's Mate, asking its putter with the answer field, up for review, merged, stopped), a
 * taken task's own chat — its header with Done and Release, and its card saying where it came from
 * (a conversation, or the Board itself) — and, in the Mate's conversation, a Take whose
 * conversation did not open, with Open its conversation.
 *
 * Served by the dev server at `/design-board.html` (`?theme=dark`; `?state=<name>` draws one state
 * alone). Open it at the owner's 1786 × 1000; the column is the conversation's 760 px.
 *
 * Fixtures only. Nothing here ships — `design-board.html` is not `index.html`, and no route imports
 * this module.
 */
import type { ConversationSource, MateTaskSource } from "@t3tools/contracts";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import { StrictMode, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

import type { AskState } from "~/components/ask/ask.logic";
import { ComposerPrimaryActions } from "~/components/chat/ComposerPrimaryActions";
import { ComposerPutOnBoardButton } from "~/components/chat/ComposerPutOnBoardButton";
import { NoticeLine } from "~/components/chat/ConversationRows";
import { strandedTakeNotice } from "~/components/chat/conversationNotices";
import { MateTaskCardView, MateTaskStatusView } from "~/components/zerops/MateTaskCard";
import { BoardAskCardView } from "~/components/zerops/board/BoardAskCard";
import { BoardPlanCardView } from "~/components/zerops/board/BoardPlanCard";
import type { BoardAnswerState } from "~/components/zerops/board/BoardTaskRow";
import {
  boardAskState,
  boardPlanState,
  planNeedsWords,
} from "~/components/zerops/board/boardAsk.logic";
import { boardOf, type BoardRow } from "~/components/zerops/projectAutomation/taskBoard.logic";
import type { TaskSession } from "~/zerops/taskSession.logic";
import type { BoardFace } from "~/zerops/useBoardTasks";
import "../index.css";

const params = new URLSearchParams(location.search);
const STATE = params.get("state");
const nothing = () => {};

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

/** A made-up plant shop: Mara's Lark proposes, Rhea's Moss takes, Wren is the pool's. */
const ME = "u-mara";
const PEOPLE: Readonly<Record<string, string>> = { [ME]: "Mara", "u-rhea": "Rhea" };
const FACES: Readonly<Record<string, BoardFace>> = {
  "p-lark": { name: "Lark", tint: "violet", shape: "gem" },
  "p-moss": { name: "Moss", tint: "rose", shape: "seal" },
  "p-wren": { name: "Wren", tint: "sky", shape: "pick" },
};
const TITLE = "Offer gift wrapping at checkout";
const BRIEF =
  "Let a shopper add gift wrapping to any order at checkout, for a flat €3.\n\nShow it as a checkbox under the delivery options, carry it into the order summary and the confirmation e-mail, and add it to the order export. Keep the price in one setting so the shop can change it.";
const SOURCE: ConversationSource = {
  kind: "conversation",
  putBy: ME,
  mateProjectId: "p-lark",
  conversationId: "c-lark",
  title: TITLE,
};

const task = (patch: Partial<HqAppTask>): HqAppTask => ({
  id: "50",
  title: TITLE,
  label: "a conversation",
  url: null,
  state: "queued",
  mate: null,
  position: 1,
  requestedBy: null,
  createdAt: ago(3),
  startedAt: null,
  endedAt: null,
  spentUsd: null,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: null,
  source: SOURCE,
  brief: BRIEF,
  taker: null,
  ...patch,
});

/** The task's row as the card reads it from the Board, in Mara's words. */
function rowOf(record: HqAppTask, waiting = false): BoardRow {
  const lanes = boardOf([record], NOW, {
    live: waiting
      ? new Map([[record.id, { id: record.id, title: TITLE, url: null, waiting: true as const }]])
      : new Map(),
    viewerId: ME,
    personName: (userId) => PEOPLE[userId],
    mateName: (projectId) => FACES[projectId]?.name,
  }).lanes;
  const row =
    lanes.queued[0] ?? lanes.progress[0] ?? lanes.waiting[0] ?? lanes.review[0] ?? lanes.done[0];
  if (row === undefined) throw new Error("no row");
  return row;
}

const POOL = { kind: "pool" as const, mateProjectId: "p-wren" };
const WREN = { projectId: "p-wren", name: "Wren" };
const QUEUED = task({});
const AT_WORK = task({
  state: "working",
  mate: WREN,
  taker: POOL,
  startedAt: ago(12),
  workedMs: 11 * 60_000,
});
const ASKING = task({
  state: "waiting",
  mate: WREN,
  taker: POOL,
  startedAt: ago(20),
  detail: "Should gift wrapping be offered on orders that ship to a pickup point too?",
  history: [
    { kind: "asked", at: ago(16), question: "One wrapping style, or a choice of three?" },
    { kind: "answered", at: ago(14) },
    {
      kind: "asked",
      at: ago(6),
      question: "Should gift wrapping be offered on orders that ship to a pickup point too?",
    },
  ],
});
const TAKEN = task({
  state: "taken",
  taker: { kind: "person", userId: "u-rhea", mateProjectId: "p-moss" },
  takenAt: ago(40),
});
const REVIEW = task({
  state: "taken",
  taker: { kind: "person", userId: "u-rhea", mateProjectId: "p-moss" },
  takenAt: ago(5 * 60),
  changes: [{ repo: "shop", number: 47 }],
});
const MERGED = task({
  state: "merged",
  mate: WREN,
  taker: POOL,
  endedAt: ago(90),
  change: { repo: "shop", number: 48 },
  pullRequest: { number: 48, url: "https://github.com/fernhill/plant-shop/pull/48" },
});
const STOPPED = task({ state: "stopped", endedAt: ago(30), detail: "Mara stopped it." });

const OPEN = {
  state: "open" as const,
  put: { kind: "idle" as const },
  refusal: null,
  by: null,
  at: null,
};
const putState = (record: HqAppTask, waiting = false): AskState =>
  boardAskState({ ...OPEN, state: "put", task: rowOf(record, waiting) });

interface CardState {
  readonly id: string;
  readonly title: string;
  readonly state: AskState;
  readonly editable?: boolean;
  readonly record?: HqAppTask;
  readonly waiting?: boolean;
  readonly answer?: BoardAnswerState;
}

const CARDS: ReadonlyArray<CardState> = [
  {
    id: "waiting",
    title: "Proposed: title and brief to read and change",
    state: boardAskState(OPEN),
    editable: true,
  },
  {
    id: "putting",
    title: "Put on board pressed",
    state: boardAskState({ ...OPEN, put: { kind: "working", verb: "task-put" } }),
    editable: true,
  },
  {
    id: "refused",
    title: "HQ refused the put",
    state: boardAskState({
      ...OPEN,
      put: { kind: "failed", words: "That task is no longer on the Board." },
    }),
    editable: true,
  },
  { id: "queued", title: "On the board, queued", state: putState(QUEUED), record: QUEUED },
  {
    id: "pool",
    title: "In progress: the pool's Wren took it",
    state: putState(AT_WORK),
    record: AT_WORK,
  },
  {
    id: "asks",
    title: "Wren asks its putter: the answer field",
    state: putState(ASKING, true),
    record: ASKING,
    waiting: true,
    answer: { kind: "idle" },
  },
  {
    id: "answered",
    title: "Answer sent",
    state: putState(ASKING, true),
    record: ASKING,
    waiting: true,
    answer: { kind: "sent" },
  },
  {
    id: "answer-refused",
    title: "Answer refused",
    state: putState(ASKING, true),
    record: ASKING,
    waiting: true,
    answer: { kind: "refused", words: "That task moved meanwhile. Look at the Board again." },
  },
  { id: "taken", title: "Taken by Rhea for her Moss", state: putState(TAKEN), record: TAKEN },
  {
    id: "review",
    title: "Up for review: Moss linked its change",
    state: putState(REVIEW),
    record: REVIEW,
  },
  { id: "merged", title: "Merged", state: putState(MERGED), record: MERGED },
  { id: "stopped", title: "Stopped", state: putState(STOPPED), record: STOPPED },
  {
    id: "not-now",
    title: "Not now",
    state: boardAskState({ ...OPEN, state: "declined", by: "Mara", at: "15:04" }),
  },
];

function Card({ card }: { readonly card: CardState }) {
  const record = card.record;
  const row = record === undefined ? null : rowOf(record, card.waiting === true);
  return (
    <BoardAskCardView
      appName="Plant Shop"
      brief={BRIEF}
      editable={card.editable === true}
      mateName="Lark"
      onBrief={nothing}
      onNotNow={nothing}
      onPut={nothing}
      onTitle={nothing}
      ready
      requestId={`board-${card.id}`}
      state={card.state}
      task={
        row === null || record === undefined
          ? null
          : {
              row,
              face: row.holder === null ? undefined : FACES[row.holder.projectId],
              question: row.lane === "waiting" ? record.detail : null,
              answer:
                card.answer === undefined ? undefined : { state: card.answer, onSend: nothing },
              onOpenChange: nothing,
            }
      }
      title={TITLE}
    />
  );
}

/** Lark's plan for gift cards: modelled first, then sold, then emailed after both. */
const PLAN = [
  {
    key: "model",
    title: "Model gift cards in the database",
    brief:
      "Add a gift card with a code, an amount, a balance and who it is for. Codes are unique and hard to guess.",
    needs: [],
  },
  {
    key: "sell",
    title: "Sell gift cards at checkout",
    brief: "Offer gift cards of €25, €50 and €100 as products, and issue the card on payment.",
    needs: ["model"],
  },
  {
    key: "email",
    title: "Email each gift card to its recipient",
    brief:
      "Send the card's code and amount to the recipient the buyer named, on the day they chose.",
    needs: ["model", "sell"],
  },
];
const PLAN_KEYS = PLAN.map((task) => task.key);
const planTask = (id: string, at: number, patch: Partial<HqAppTask>): HqAppTask =>
  task({
    id,
    title: PLAN[at]?.title ?? "",
    brief: PLAN[at]?.brief ?? "",
    source: { ...SOURCE, title: PLAN[at]?.title ?? "" },
    ...patch,
  });
/** On the board: the first at work by the pool's Wren, the others held on what comes before. */
const PLAN_ON_BOARD = [
  planTask("70", 0, {
    state: "working",
    mate: WREN,
    taker: POOL,
    startedAt: ago(9),
    workedMs: 8 * 60_000,
  }),
  planTask("71", 1, {
    state: "held",

    needs: [{ taskId: "70", state: "waiting" }],
  }),
  planTask("72", 2, {
    state: "held",

    needs: [
      { taskId: "70", state: "waiting" },
      { taskId: "71", state: "waiting" },
    ],
  }),
];
/** Later: the first merged, the second taken by Rhea, the third still held on the second. */
const PLAN_LATER = [
  planTask("70", 0, {
    state: "merged",
    mate: WREN,
    taker: POOL,
    endedAt: ago(50),
    change: { repo: "shop", number: 51 },
    pullRequest: { number: 51, url: "https://github.com/fernhill/plant-shop/pull/51" },
  }),
  planTask("71", 1, {
    state: "taken",

    taker: { kind: "person", userId: "u-rhea", mateProjectId: "p-moss" },
    takenAt: ago(30),
    needs: [{ taskId: "70", state: "met" }],
  }),
  planTask("72", 2, {
    state: "held",

    needs: [
      { taskId: "70", state: "met" },
      { taskId: "71", state: "waiting" },
    ],
  }),
];

/** The plan's tasks as the card follows them, read from the whole Board as the card reads it. */
function planRows(records: ReadonlyArray<HqAppTask>): ReadonlyArray<BoardRow> {
  const lanes = boardOf(records, NOW, {
    viewerId: ME,
    personName: (userId) => PEOPLE[userId],
    mateName: (projectId) => FACES[projectId]?.name,
  }).lanes;
  const all = Object.values(lanes).flat();
  return records.flatMap((record) => all.filter((row) => row.id === record.id));
}

function PlanCard({
  id,
  state,
  records,
  reading = false,
}: {
  readonly id: string;
  readonly state: AskState;
  /** Put: its tasks on the Board; absent while it waits. */
  readonly records?: ReadonlyArray<HqAppTask>;
  /** Put, its tasks not read yet (a reload): each stands as its row's shape. */
  readonly reading?: boolean;
}) {
  const rows = records === undefined ? null : planRows(records);
  return (
    <BoardPlanCardView
      appName="Plant Shop"
      editable={rows === null && !reading}
      mateName="Lark"
      onBrief={nothing}
      onNotNow={nothing}
      onPut={nothing}
      onTitle={nothing}
      put={records !== undefined || reading}
      ready
      requestId={`plan-${id}`}
      state={state}
      tasks={PLAN.map((task, at) => {
        const row = rows?.[at];
        return {
          key: task.key,
          title: task.title,
          brief: task.brief,
          after: planNeedsWords(task.needs, PLAN_KEYS),
          task:
            row === undefined
              ? null
              : {
                  row,
                  face: row.holder === null ? undefined : FACES[row.holder.projectId],
                  question: null,
                  onOpenChange: nothing,
                },
        };
      })}
    />
  );
}

const planPut = (records: ReadonlyArray<HqAppTask>): AskState =>
  boardPlanState({ ...OPEN, state: "put", tasks: planRows(records) });

const PLAN_STATES = [
  {
    id: "plan-waiting",
    title: "A plan proposed: three tasks in order, each title and brief to read and change",
    view: <PlanCard id="waiting" state={boardPlanState({ ...OPEN, tasks: [] })} />,
  },
  {
    id: "plan-putting",
    title: "The plan's Put on board pressed: all of it or none",
    view: (
      <PlanCard
        id="putting"
        state={boardPlanState({ ...OPEN, put: { kind: "working", verb: "task-plan" }, tasks: [] })}
      />
    ),
  },
  {
    id: "plan-refused",
    title: "HQ refused the plan",
    view: (
      <PlanCard
        id="refused"
        state={boardPlanState({
          ...OPEN,
          put: {
            kind: "failed",
            words:
              "Tasks of this plan wait for each other, so it cannot go on the Board. Ask the Mate to propose it again.",
          },
          tasks: [],
        })}
      />
    ),
  },
  {
    id: "plan-reading",
    title: "On the board after a reload, its tasks not read yet: each stands as its row's shape",
    view: (
      <PlanCard
        id="reading"
        reading
        state={boardPlanState({ ...OPEN, state: "put", tasks: [null, null, null] })}
      />
    ),
  },
  {
    id: "plan-on-board",
    title: "On the board: the first at work, the others held on what comes before",
    view: <PlanCard id="on-board" records={PLAN_ON_BOARD} state={planPut(PLAN_ON_BOARD)} />,
  },
  {
    id: "plan-later",
    title: "Later: the first merged, the second taken by Rhea, the third held on it",
    view: <PlanCard id="later" records={PLAN_LATER} state={planPut(PLAN_LATER)} />,
  },
];

/** A taken task's chat: its header's pill with Done and Release, and its card at the top. */
const TAKEN_SESSION: TaskSession = {
  status: "taken",
  taskId: "50",
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};
const TAKEN_SOURCE: MateTaskSource = { ...SOURCE, putBy: "u-rhea", mateProjectId: "p-moss" };
/** Where the taken task's panel opens on its Board. */
const TAKEN_ON_BOARD = { groupId: "acme-store", taskId: "50" } as const;
/** A task Rhea put on the Board itself (New task): no conversation behind it. */
const TAKEN_FROM_BOARD: MateTaskSource = { kind: "board", putBy: "u-rhea", title: TITLE };

function Composer({ board, empty = false }: { readonly board: boolean; readonly empty?: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 rounded-card border border-border bg-card px-3 py-2">
      <span className="me-auto text-body text-muted-foreground">
        {empty ? "Ask Moss anything" : "Offer gift wrapping at checkout"}
      </span>
      {board ? <ComposerPutOnBoardButton disabled={empty} onPress={nothing} /> : null}
      <ComposerPrimaryActions
        away={null}
        compact={false}
        hasSendableContent={!empty}
        isConnecting={false}
        isPreparingWorktree={false}
        isRunning={false}
        isSendBusy={false}
        onImplementPlanInNewThread={nothing}
        onInterrupt={nothing}
        onPreviousPendingQuestion={nothing}
        pendingAction={null}
        promptHasText={!empty}
        sendDisabledReason={null}
        showPlanFollowUpPrompt={false}
        unavailableAgentName={null}
      />
    </div>
  );
}

const STATES: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly view: ReactNode;
}> = [
  { id: "composer", title: "Send, with Put on board beside it", view: <Composer board /> },
  {
    id: "composer-empty",
    title: "An empty draft: Put on board held back, its tooltip still there",
    view: <Composer board empty />,
  },
  {
    id: "composer-plain",
    title: "Send where the Mate cannot put on a Board",
    view: <Composer board={false} />,
  },
  ...CARDS.map((card) => ({
    id: `card-${card.id}`,
    title: `Card: ${card.title}`,
    view: <Card card={card} />,
  })),
  ...PLAN_STATES,
  {
    id: "taken",
    title: "A taken task's chat: the task, Mark done and Put back, and where it came from",
    view: (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <MateTaskStatusView
            board={TAKEN_ON_BOARD}
            onDone={nothing}
            onRelease={nothing}
            session={TAKEN_SESSION}
            task={TAKEN_SOURCE}
          />
        </div>
        <MateTaskCardView
          origin={{ words: "Put on board by Rhea in Moss’s chat", onOpen: nothing }}
          session={TAKEN_SESSION}
          task={TAKEN_SOURCE}
          text={`${TITLE}\n\n${BRIEF}`}
        />
      </div>
    ),
  },
  {
    id: "taken-board",
    title: "A taken task put on the Board itself: who put it, and no chat to go back to",
    view: (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <MateTaskStatusView
            board={TAKEN_ON_BOARD}
            onDone={nothing}
            onRelease={nothing}
            session={TAKEN_SESSION}
            task={TAKEN_FROM_BOARD}
          />
        </div>
        <MateTaskCardView
          origin={{ words: "Put on board by Rhea" }}
          session={TAKEN_SESSION}
          task={TAKEN_FROM_BOARD}
          text={`${TITLE}\n\n${BRIEF}`}
        />
      </div>
    ),
  },
  {
    id: "stranded",
    title: "Where a Take lands, its conversation not opened: Open its conversation",
    view: (
      <NoticeLine
        notice={strandedTakeNotice({
          taskId: "t-stranded",
          title: TITLE,
          opening: false,
          open: nothing,
        })}
      />
    ),
  },
  {
    id: "stranded-opening",
    title: "Where a Take lands, its conversation opening",
    view: (
      <NoticeLine
        notice={strandedTakeNotice({
          taskId: "t-stranded",
          title: TITLE,
          opening: true,
          open: nothing,
        })}
      />
    ),
  },
  {
    id: "taken-review",
    title: "A taken task's chat, its change up for review",
    view: (
      <div className="grid gap-3">
        <div className="flex justify-end">
          <MateTaskStatusView
            onDone={nothing}
            onRelease={nothing}
            session={{ ...TAKEN_SESSION, status: "review", change: { repo: "shop", number: 47 } }}
            task={SOURCE}
          />
        </div>
        <MateTaskCardView
          onOpenChange={nothing}
          origin={{ words: "Put on board by you" }}
          session={{ ...TAKEN_SESSION, status: "review", change: { repo: "shop", number: 47 } }}
          task={{ ...SOURCE }}
          text={`${TITLE}\n\n${BRIEF}`}
        />
      </div>
    ),
  },
];

function Harness() {
  const states = STATE === null ? STATES : STATES.filter((state) => state.id === STATE);
  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto grid w-full content-start gap-8" style={{ maxWidth: 760 }}>
        {states.map((state) => (
          <section className="grid content-start gap-3" data-state={state.id} key={state.id}>
            <h2 className="text-caption font-medium tracking-wide text-muted-foreground uppercase">
              {state.title}
            </h2>
            {state.view}
          </section>
        ))}
      </div>
    </div>
  );
}

// The links the task's surfaces draw (to its Board) need a router; nothing here navigates.
const router = createRouter({
  routeTree: createRootRoute({ component: Harness }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
