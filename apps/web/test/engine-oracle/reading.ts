/**
 * What a person reads of an engine conversation, from a client's store: each run card as the
 * timeline draws it (`deriveMessagesTimelineRows`, fed as `ChatView` and `MessagesTimeline` feed
 * it for an engine Mate), the helpers' surface (`deriveAgentPanelModel`) and the dock's background
 * band (`foldBackgroundTasks`) — in words and states, never in markup. Everything a person reads
 * names the tree's entity it is about by the id the generator wrote into its words (`C4`, `J2`,
 * `H3`), so the oracle can hold each line against the record and the tree.
 */
import {
  engineCardPaging,
  engineRunCards,
  engineThreadOf,
  type EngineConversationKey,
} from "@t3tools/client-runtime/data";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
  type AgentPanelModel,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import { foldBackgroundTasks } from "../../src/components/chat/conversationDock.logic";
import { helpersBubbleOf } from "../../src/components/chat/helpersBubble.logic";
import {
  backgroundLineOf,
  jobItems,
  taskItems,
} from "../../src/components/chat/backgroundLine.logic";
import {
  deriveMessagesTimelineRows,
  helperFinishesOf,
  type MessagesTimelineRow,
  type RecordItem,
} from "../../src/components/chat/MessagesTimeline.logic";
import { nowLineOf, nowLineWords } from "../../src/components/chat/runCard.logic";
import { runEffortWords } from "../../src/components/chat/runResult.logic";
import {
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntries,
  deriveWorkLogEntries,
  type WorkLogEntry,
} from "../../src/session-logic";
import type { ChatMessage } from "../../src/types";

type Reads = Parameters<typeof engineThreadOf>[0];

/** The tree's entity a line is about, by the id written into its words. */
export const entityOf = (text: string | null | undefined): string | null =>
  text?.match(/\b([CJH]\d+)\b/u)?.[1] ?? null;

export interface StepReading {
  /** The entity it is (`C4`, `J2`), or its words when they name none. */
  readonly what: string;
  readonly state: string;
  /** A command it sent to the background: the job as its line says it. */
  readonly job?: { readonly state: string; readonly report: string | null };
}

export interface SpawnReading {
  /** "Started 3 helpers". */
  readonly words: string;
  /** The helpers it names, by entity. */
  readonly helpers: ReadonlyArray<string>;
  readonly failed: boolean;
  readonly live: boolean;
  /** How those that did not finish ended, once none works: "1 failed, 2 stopped". */
  readonly ended: string | null;
}

export interface CardReading {
  readonly card: string;
  readonly live: boolean;
  /** Its line: what it does now, or who worked and for how long. */
  readonly line: string;
  /** What its runs came to: "3 commands · 2 helpers". */
  readonly effort: string | null;
  readonly steps: ReadonlyArray<StepReading>;
  readonly spawns: ReadonlyArray<SpawnReading>;
  /** A task or helper reporting back, where its result reached the run. */
  readonly reports: ReadonlyArray<string>;
  /** The background lines under it, and each job they list. */
  readonly background: ReadonlyArray<{
    readonly words: string;
    readonly jobs: ReadonlyArray<{ readonly what: string; readonly state: string }>;
  }>;
}

export interface Reading {
  readonly cards: ReadonlyArray<CardReading>;
  /** The helpers' surface: each helper, its state. */
  readonly helpers: ReadonlyArray<{
    readonly what: string;
    readonly status: string;
    readonly parent: string | null;
  }>;
  /** The dock's band: each background task, its state. */
  readonly dock: ReadonlyArray<{ readonly what: string; readonly state: string }>;
}

const stepWhat = (entry: WorkLogEntry | undefined, words: string | null, code: string | null) =>
  entityOf(words) ?? entityOf(code) ?? entityOf(entry?.detail) ?? words ?? code ?? "?";

function stepsOf(items: ReadonlyArray<RecordItem>): StepReading[] {
  const steps: StepReading[] = [];
  for (const item of items) {
    if (item.kind !== "step") continue;
    for (const part of item.parts ?? [item]) {
      const step = part.step;
      steps.push({
        what: stepWhat(step.entries[0], step.words, step.code),
        state: step.noResult === undefined ? step.state : `${step.state}/${step.noResult}`,
        ...(step.background === undefined
          ? {}
          : { job: { state: step.background.state, report: step.background.report } }),
      });
    }
  }
  return steps;
}

function spawnsOf(items: ReadonlyArray<RecordItem>, panel: AgentPanelModel): SpawnReading[] {
  return items.flatMap((item) => {
    if (item.kind !== "helpers" || item.entry.agentSpawn === undefined) return [];
    const bubble = helpersBubbleOf(panel, item.entry.agentSpawn);
    return [
      {
        words: bubble.words,
        helpers: bubble.agents.map((agent) => entityOf(agent.title) ?? agent.title),
        failed: bubble.failed,
        live: bubble.summary.live,
        ended: bubble.ended,
      },
    ];
  });
}

function readCard(
  row: Extract<MessagesTimelineRow, { kind: "record" }>,
  after: ReadonlyArray<MessagesTimelineRow>,
  panel: AgentPanelModel,
): CardReading {
  const effort = runEffortWords(row.outcome);
  const line =
    row.status === null
      ? ""
      : nowLineWords(
          nowLineOf({
            status: row.status,
            now: row.now,
            answering: row.answering,
            compacting: false,
            speaker: "Milo",
            effort,
          }),
        );
  return {
    card: row.turnId ?? row.turnKey,
    live: row.live,
    line,
    effort,
    steps: stepsOf(row.items),
    spawns: spawnsOf(row.items, panel),
    reports: row.items.flatMap((item) =>
      item.kind === "task" ? [entityOf(item.entry.toolTitle ?? item.entry.label) ?? "?"] : [],
    ),
    background: after.flatMap((next) =>
      next.kind === "background"
        ? [
            {
              words: backgroundLineOf(
                next.jobs === undefined ? taskItems(next.entries) : jobItems(next.jobs),
                next.helpers,
              ).words,
              jobs: (next.jobs ?? []).map((job) => ({
                what: entityOf(job.title) ?? job.title,
                state: job.state,
              })),
            },
          ]
        : [],
    ),
  };
}

/** What the conversation reads as, from this store, at `nowMs`. */
export function readConversation(
  reads: Reads,
  key: EngineConversationKey,
  nowMs: number,
): Reading | null {
  const thread = engineThreadOf(reads, key);
  if (thread === null) return null;
  const runCards = engineRunCards.derive(reads, key) ?? undefined;
  const cardPaging = engineCardPaging.derive(reads, key);
  const activities = thread.activities as ReadonlyArray<OrchestrationThreadActivity>;
  const phase = derivePhase(thread.session);
  const latestTurn = thread.latestTurn;
  const isWorking = phase === "running";
  const runningTurnId =
    (thread.session?.status === "running" ? thread.session.activeTurnId : null) ??
    (latestTurn?.state === "running" ? latestTurn.turnId : null);
  const panel = deriveAgentPanelModel({
    agents: foldSubagentActivities(activities, { sessionLive: phase !== "disconnected" }),
  });
  const agents = [
    ...panel.directAgents,
    ...panel.workflows.flatMap((group) => group.unphasedMembers),
  ];
  const latestUserMessageAt =
    thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null;
  const rows = deriveMessagesTimelineRows({
    ...(runCards === undefined ? {} : { runCards }),
    cardPaging,
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(activities),
    ),
    latestTurn,
    runningTurnId,
    isWorking,
    activeTurnStartedAt: deriveActiveWorkStartedAt(
      latestTurn,
      thread.session,
      null,
      latestUserMessageAt,
    ),
    turnDiffSummaries: [],
    supportsConversationRollback: false,
    afterTurnWork: null,
    liveJobs: null,
    nowMs,
    helperFinishes: helperFinishesOf(panel),
    provider: thread.session?.providerName ?? null,
  });
  const cards: CardReading[] = [];
  rows.forEach((row, index) => {
    // A run with no chat to end on draws its line alone: a card all the same.
    if (row.kind === "work-line") {
      cards.push({
        card: row.turnId ?? row.stretchKey,
        live: row.live,
        line: nowLineWords(
          nowLineOf({
            status: row,
            now: null,
            answering: false,
            compacting: false,
            speaker: "Milo",
            effort: null,
          }),
        ),
        effort: null,
        steps: [],
        spawns: [],
        reports: [],
        background: [],
      });
      return;
    }
    if (row.kind !== "record") return;
    const next = rows.slice(index + 1);
    const end = next.findIndex((later) => later.kind === "record");
    cards.push(readCard(row, end === -1 ? next : next.slice(0, end), panel));
  });
  return {
    cards,
    helpers: agents.map((agent) => {
      const parent = agent.spawnedBy ?? agent.parentAgentId;
      const parentAgent = agents.find((each) => each.id === parent);
      return {
        what: entityOf(agent.title) ?? agent.title,
        status: agent.status,
        parent:
          parent === null ? null : (entityOf(parentAgent?.title) ?? parentAgent?.title ?? parent),
      };
    }),
    dock: foldBackgroundTasks(activities).map((task) => ({
      what: entityOf(task.title) ?? task.title,
      state: task.state,
    })),
  };
}
