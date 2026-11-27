/**
 * The conversation column of the Crew tab's flow (`crewHarness.tsx`): the Mate's own chat, where
 * its crew card stands, or one crewmate's chat with its task cards — each in the real conversation
 * list (`KeptTimelines`) under the conversation's line, beside the Crew tab at the same phase. So a
 * row the crew adds to a conversation, and whatever pops in as its data reads, is seen in the flow
 * before it ships.
 *
 * The crew card reads its crew as the app does (`useCrew`): the flow answers the crew feed and the
 * Mate's directory with its own fixtures in a registry of its own. Fixtures only: nothing here
 * ships.
 */
import { RegistryContext } from "@effect/atom-react";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  type CrewCard,
  type CrewTask,
  type EnvironmentId,
  MessageId,
  type ThreadLiveStep,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateTintId } from "@t3tools/shared/brand";
import type { LegendListRef } from "@legendapp/list/react";
import { AtomRegistry } from "effect/reactivity";
import { type ReactNode, useMemo, useRef } from "react";

import { parseCrewAsk } from "~/components/ask/crewAsk.logic";
import { ConversationStripView } from "~/components/chat/ConversationStrip";
import type { LineCrewmate } from "~/components/chat/ConversationStrip.logic";
import { deriveDock } from "~/components/chat/conversationDock.logic";
import { KeptTimelines } from "~/components/chat/KeptTimelines";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import type { CrewTimeline } from "~/components/zerops/crew/CrewTaskCard";
import type { TimelineEntry } from "~/session-logic";
import { zeropsFeeds } from "~/zerops/feeds";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import type { CrewRead } from "~/zerops/crew/useCrew";
import { zeropsMatesAtom } from "~/zerops/useZeropsMates";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import { harnessAppearance } from "./harnessPage";

export interface CrewChatSeat {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  readonly kind: "lead" | "writer" | "reader";
  readonly job: string;
}

/** A crewmate's chat as the flow's state has it: at rest since `ago` minutes, or at work on `step`. */
export interface CrewChatThread {
  readonly ago: number;
  readonly step?: ThreadLiveStep;
  readonly asked?: string;
  readonly said?: string;
}

const ROLES = { lead: "lead", writer: "builder", reader: "reviewer" } as const;

/**
 * The crew card the Mate drew in its chat, as a `crew-ask` fence, and its key: the crew the flow
 * stands is the one this card set up.
 */
export function crewCardFence(
  seats: ReadonlyArray<CrewChatSeat>,
  goal: string,
  host: string | null,
): { readonly code: string; readonly key: string } {
  const code = JSON.stringify({
    title: "Set up a crew for seasons",
    why: "The server, the rules and the clients can each take their part at once, and the lead keeps them to the goal.",
    goal,
    crew: seats.map((seat) => ({
      name: seat.displayName,
      role: ROLES[seat.kind],
      part: seat.job.split("\n")[0] ?? seat.job,
      ...(seat.kind === "writer" && host !== null ? { host } : {}),
    })),
  });
  return { code, key: parseCrewAsk(code)!.key };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const message = (
  id: string,
  role: "user" | "assistant",
  text: string,
  at: string,
  fields: { readonly turnId?: TurnId; readonly streaming?: boolean; readonly card?: CrewCard } = {},
): TimelineEntry => ({
  id,
  kind: "message",
  createdAt: at,
  message: {
    id: MessageId.make(id),
    role,
    text,
    turnId: fields.turnId ?? null,
    createdAt: at,
    updatedAt: at,
    streaming: fields.streaming ?? false,
    ...(fields.card === undefined ? {} : { crewCard: fields.card }),
  },
});

const cardOf = (kind: CrewCard["kind"], task: CrewTask, why: string): CrewCard => ({
  kind,
  taskId: task.id,
  number: task.number,
  title: task.title,
  why,
  doneWhen: kind === "task" && task.doneWhen !== "" ? task.doneWhen : null,
  links: [],
});

/** The Mate's own chat: the person's ask, and the answer with the crew card in it. */
function mateChat(fence: string): TimelineEntry[] {
  const asked = minutesAgo(26 * 60 + 12);
  const answered = minutesAgo(26 * 60 + 11);
  return [
    message(
      "fen-ask",
      "user",
      "Seasons come next for Letopis. Can a crew build them while I keep the server running?",
      asked,
    ),
    message(
      "fen-answer",
      "assistant",
      `Three parts can be built side by side, so here is a crew for them.\n\n\`\`\`crew-ask\n${fence}\n\`\`\``,
      answered,
      { turnId: TurnId.make("turn-fen") },
    ),
  ];
}

/** What a crewmate said back on a task, by where the task stands. */
function answerOf(task: CrewTask): string | null {
  switch (task.state) {
    case "blocked":
      return task.question ?? "I'm stuck on this one.";
    case "review":
    case "ready":
    case "landing":
    case "landed":
      return `Done: ${task.title.toLowerCase()}. The check passes, and the change is ready to review.`;
    case "rework":
      return null;
    default:
      return null;
  }
}

/** A crewmate's chat: each task card the crew sent it, and what it answered or is at now. */
function crewmateChat(
  seat: CrewChatSeat,
  thread: CrewChatThread,
  tasks: ReadonlyArray<CrewTask>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const handle = seat.handle;
  // The lead's turns are the person's asks, and the reviews the crew hands it.
  const mine =
    seat.kind === "lead"
      ? tasks.filter((task) => task.state === "review" || task.state === "ready")
      : tasks.filter((task) => task.owner === handle);
  if (thread.asked !== undefined) {
    entries.push(message(`${handle}-asked`, "user", thread.asked, minutesAgo(thread.ago + 1)));
    if (thread.said !== undefined) {
      entries.push(
        message(`${handle}-said`, "assistant", thread.said, minutesAgo(thread.ago), {
          turnId: TurnId.make(`turn-${handle}-asked`),
        }),
      );
    }
  }
  mine.forEach((task, index) => {
    const at = minutesAgo(thread.ago + (mine.length - index) * 6);
    const turnId = TurnId.make(`turn-${handle}-${task.id}`);
    const card =
      seat.kind === "lead"
        ? cardOf("review", task, `${task.title} is finished: review it against its Done when.`)
        : task.state === "rework"
          ? cardOf("rework", task, task.review?.note ?? task.reason ?? "Sent back.")
          : cardOf("task", task, task.brief);
    entries.push(message(`${handle}-card-${task.id}`, "user", card.title, at, { card }));
    const answer = seat.kind === "lead" ? "Reading the change against the goal." : answerOf(task);
    if (answer !== null) {
      entries.push(message(`${handle}-answer-${task.id}`, "assistant", answer, at, { turnId }));
    }
  });
  return entries;
}

/** The markdown's commands ask the account's grant what they may do: stand-ins that answer nothing. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    lost: new Set(),
    deleted: [],
  };
  const data: ZeropsDataContextValue = {
    scope: {} as AccountScope,
    signals: { hidden: () => false, online: () => true, listen: () => () => undefined },
    organizationRef: () => {
      throw new Error("not in the harness");
    },
    projectRef: () => {
      throw new Error("not in the harness");
    },
  };
  return (
    <ZeropsDataContext value={data}>
      <InventoryContext value={inventory}>{children}</InventoryContext>
    </ZeropsDataContext>
  );
}

const COMPOSER_HEIGHT = 132;
const noop = () => {};
const keptForever = () => true;
const readsNothing = () => null;

/**
 * The conversation column: the line (the Mate, then its crew, the chat on screen a pill) over the
 * chat `chat` names — `fen`, the Mate's own, or a crewmate's handle — and a composer's stand-in.
 */
export function CrewChat({
  environmentId,
  mate,
  seats,
  crew,
  threads,
  chat,
  fence,
}: {
  readonly environmentId: EnvironmentId;
  readonly mate: { readonly name: string; readonly tint: MateTintId };
  readonly seats: ReadonlyArray<CrewChatSeat>;
  readonly crew: CrewRead;
  readonly threads: Readonly<Record<string, CrewChatThread>>;
  readonly chat: string;
  readonly fence: string;
}) {
  // The crew card reads the crew feed and the Mate's directory: the flow answers both.
  const registry = useMemo(
    () =>
      AtomRegistry.make({
        initialValues: [
          [
            zeropsFeeds.crew({ environmentId, input: {} }),
            crew.snapshot === null
              ? { state: "unread", waitingFor: null }
              : {
                  state: "known",
                  value: crew.snapshot,
                  asOf: { ordinal: 1, atMs: 0 },
                  coverage: "complete",
                  freshness: { kind: "settled" },
                },
          ],
          [
            zeropsMatesAtom,
            new Map([
              [
                environmentId,
                {
                  name: mate.name,
                  tint: mate.tint,
                  shape: MATE_SHAPE_OF_TINT[mate.tint],
                  project: "Letopis",
                  projectUrl: "https://app.zerops.io/project/harness",
                  connected: true,
                },
              ],
            ]),
          ],
        ],
      }),
    [crew.snapshot, environmentId, mate],
  );
  const seat = seats.find((candidate) => candidate.handle === chat) ?? null;
  const thread = seat === null ? null : (threads[seat.handle] ?? { ago: 60 });
  const tasks = crew.snapshot?.board.tasks ?? [];
  const entries = useMemo(
    () => (seat === null || thread === null ? mateChat(fence) : crewmateChat(seat, thread, tasks)),
    [fence, seat, tasks, thread],
  );
  const working = thread?.step !== undefined;
  const threadId = ThreadId.make(seat === null ? "thread-fen" : `thread-crew-${seat.handle}`);
  const routeThreadKey = `${environmentId}:${threadId}`;
  const latestTurn = useMemo(
    () => ({
      turnId: TurnId.make(`turn-${chat}`),
      state: working ? ("running" as const) : ("completed" as const),
      startedAt: minutesAgo(thread?.ago ?? 60),
      completedAt: working ? null : minutesAgo(thread?.ago ?? 60),
    }),
    [chat, thread, working],
  );
  const dock = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking: working,
        runningTurnId: working ? latestTurn.turnId : null,
        agentPanelModel: emptyAgentPanelModel(),
        plan: null,
        pause: null,
      }),
    [entries, latestTurn, working],
  );
  const profile =
    seat === null
      ? null
      : (crew.snapshot?.crewmates.find((candidate) => candidate.handle === seat.handle) ?? null);
  const crewTimeline: CrewTimeline | null =
    seat === null
      ? null
      : {
          firstCardId: entries.find((entry) => entry.id.includes("-card-"))?.id ?? null,
          origin: null,
          tasks,
          crewmate: { handle: seat.handle, profile },
          mateName: mate.name,
          onOpenThread: noop,
          onChangeJob: noop,
        };
  const listRef = useRef<LegendListRef | null>(null);
  const line = seats.map((candidate): LineCrewmate => ({
    handle: candidate.handle,
    name: candidate.displayName,
    tint: candidate.tint,
    face: threads[candidate.handle]?.step === undefined ? "idle" : "working",
    lead: candidate.kind === "lead",
    open: candidate.handle === chat,
    known: true,
    threadId: ThreadId.make(`thread-crew-${candidate.handle}`),
    role: candidate.kind === "lead" ? `, ${mate.name}'s lead` : `, one of ${mate.name}'s crew`,
    job: null,
    status: null,
  }));
  return (
    <RegistryContext value={registry}>
      <Standins>
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspacePageHeader
            className="relative bg-toolbar text-toolbar-foreground"
            data-chat-header
          >
            <div className="flex min-w-0 flex-1 items-center">
              <ConversationStripView
                chats={null}
                crew={crew.status === "applied" ? line : []}
                mate={{
                  name: mate.name,
                  tint: mate.tint,
                  face: "idle",
                  open: seat === null,
                  threadId: ThreadId.make("thread-fen"),
                  tooltip: seat === null ? null : `${mate.name}'s own chat`,
                }}
                onCloseChat={noop}
                onOpen={noop}
                onRename={null}
                renameField={null}
                renderCrewmateMenu={() => null}
              />
            </div>
          </WorkspacePageHeader>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col">
              <KeptTimelines
                alive={keptForever}
                crewTimeline={crewTimeline}
                open={routeThreadKey}
                Reader={readsNothing}
                timeline={{
                  isWorking: working,
                  activeTurnStartedAt: working ? latestTurn.startedAt : null,
                  listRef,
                  timelineEntries: entries,
                  latestTurn,
                  runningTurnId: working ? latestTurn.turnId : null,
                  working: dock,
                  routeThreadKey,
                  onImageExpand: noop,
                  activeThreadEnvironmentId: environmentId,
                  markdownCwd: undefined,
                  resolvedTheme: harnessAppearance,
                  timestampFormat: "locale",
                  workspaceRoot: undefined,
                  anchorMessageId: null,
                  onAnchorReady: noop,
                  contentInsetEndAdjustment: COMPOSER_HEIGHT,
                  liveFollowEnabled: true,
                  onIsAtEndChange: noop,
                  onPersonInput: noop,
                  onManualNavigation: noop,
                  hideEmptyPlaceholder: false,
                  loading: false,
                  syncing: false,
                  topFadeEnabled: true,
                  flowRead: true,
                }}
              />
            </div>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pt-2"
              style={{ height: COMPOSER_HEIGHT }}
            >
              <div
                className="mx-auto max-w-3xl rounded-sheet border border-border bg-card shadow-sm"
                style={{ height: COMPOSER_HEIGHT - 20 }}
              />
            </div>
          </div>
        </main>
      </Standins>
    </RegistryContext>
  );
}
