/**
 * The top of a Mate's conversation — the header, whose line the strip of its
 * chats and crew takes, and what the chat on screen is about under it — in
 * every state the strip has, at the width the owner's chat column really gets
 * (1786 wide, the menu at 435), and folded at 640 and 390.
 *
 * The strip is the real `ConversationStripView` over entries the real
 * `chatEntries` and `crewEntries` make of fixture threads and a fixture crew;
 * the header around it and the line under it are drawn with `ChatHeader`'s
 * and `ChatView`'s own classes, since the real header reads the app's stores.
 *
 * Served by the dev server at `/design-strip.html` (`?theme=dark`,
 * `?width=<px>` for every frame's width). Fixtures only: nothing here ships,
 * and no route imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CrewSnapshot,
  type Crewmate,
} from "@t3tools/contracts";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { mateMarkStateForThreadStatus, resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { ChevronDownIcon, EllipsisIcon, PlusIcon } from "lucide-react";

import { ConversationStripView } from "~/components/chat/ConversationStrip";
import {
  chatEntries,
  crewEntries,
  mateChats,
  stripShown,
  type ConversationStripGroup,
} from "~/components/chat/ConversationStrip.logic";
import { Button } from "~/components/ui/button";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { ZeropsMark } from "~/components/ZeropsMark";
import { CrewLeadBar } from "~/components/zerops/crew/CrewLeadBar";
import { Chip, MateFace } from "~/components/zerops/primitives";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
/** The owner's chat column: 1786 wide, the menu at 435. */
const WIDTH = Number(params.get("width") ?? 1351);

const ENVIRONMENT = EnvironmentId.make("environment-strip");
const PROJECT = ProjectId.make("project-strip");
const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 9, minute)).toISOString();

const FEN = { name: "Fen", tint: "amber" as MateTintId, connected: true };
const FEN_TASK = "Build the game server and its rules engine from the spec, tests first.";

type Activity = "idle" | "working" | "needs" | "done";

function shell(
  id: string,
  activity: Activity,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  const turn = (state: "running" | "completed") => ({
    turnId: TurnId.make(`turn-${id}`),
    state,
    requestedAt: at(1),
    startedAt: at(1),
    completedAt: state === "running" ? null : at(20),
    assistantMessageId: null,
  });
  return {
    id: ThreadId.make(id),
    environmentId: ENVIRONMENT,
    projectId: PROJECT,
    title: id,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn:
      activity === "working" ? turn("running") : activity === "done" ? turn("completed") : null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: at(1),
    hasPendingApprovals: false,
    hasPendingUserInput: activity === "needs",
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

/** What each thread's reader last saw: a done thread finished after it. */
function visits(shells: ReadonlyArray<EnvironmentThreadShell>): Record<string, string> {
  return Object.fromEntries(
    shells.map((each) => [
      `${ENVIRONMENT}:${each.id}`,
      each.latestTurn?.completedAt ? at(10) : at(30),
    ]),
  );
}

interface CrewSeat {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  readonly lead?: boolean;
  readonly job: string;
  readonly activity: Activity;
}

const CREW: ReadonlyArray<CrewSeat> = [
  {
    handle: "lead",
    displayName: "Lead",
    tint: "violet",
    lead: true,
    job: "Plans the work, splits it into tasks and reviews each landing.",
    activity: "idle",
  },
  {
    handle: "world-server",
    displayName: "World Server",
    tint: "sky",
    job: "Owns the world server under server/ and its tests.",
    activity: "working",
  },
  {
    handle: "game-rules",
    displayName: "Game Rules",
    tint: "amber",
    job: "Owns the rules engine: turns, scoring and their tests.",
    activity: "needs",
  },
  {
    handle: "web-clients",
    displayName: "Web Clients",
    tint: "olive",
    job: "Owns the browser client and its end-to-end tests.",
    activity: "done",
  },
];

const EXTRA_CREW: ReadonlyArray<CrewSeat> = [
  {
    handle: "docs",
    displayName: "Docs",
    tint: "rose",
    job: "Keeps the README and the API reference current.",
    activity: "idle",
  },
  {
    handle: "load-tests",
    displayName: "Load Tests",
    tint: "slate",
    job: "Writes and runs the load tests against the stage.",
    activity: "working",
  },
];

const crewThread = (seat: CrewSeat) => `thread-crew-${seat.handle}-1`;

function crewSnapshot(seats: ReadonlyArray<CrewSeat>): CrewSnapshot {
  const base = crewSnapshotFixture();
  const template = base.crewmates[1]!;
  const lead = base.crewmates[0]!;
  const crewmates = seats.map((seat): Crewmate => ({
    ...(seat.lead ? lead : template),
    handle: seat.handle,
    displayName: seat.displayName,
    tint: seat.tint,
    jobFirstLine: seat.job,
    currentThreadId: ThreadId.make(crewThread(seat)),
    stints: [
      {
        stint: 1,
        threadId: ThreadId.make(crewThread(seat)),
        state: "active",
        reason: null,
        lastCompactSummary: null,
        startedAt: at(0),
        retiredAt: null,
      },
    ],
    openTaskId: null,
    queuedTaskIds: [],
  }));
  return { ...base, crewmates, board: { ...base.board, tasks: [] } };
}

interface HeadState {
  readonly id: string;
  readonly title: string;
  readonly width?: number;
  /** The Mate's chats: the main one first. */
  readonly chats: ReadonlyArray<{ readonly title: string; readonly activity: Activity }>;
  readonly crew: ReadonlyArray<CrewSeat>;
  /** The chat on screen: a chat's index, or a crewmate's handle. */
  readonly on: number | string;
}

const STATES: ReadonlyArray<HeadState> = [
  {
    id: "lone",
    title: "A Mate with one chat: no strip, New chat in the header",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: [],
    on: 0,
  },
  {
    id: "crew",
    title:
      "Fen and its crew, on Fen's chat — World Server works, Game Rules needs you, Web Clients finished unseen",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: 0,
  },
  {
    id: "crewmate",
    title: "A crewmate's chat open (World Server, working)",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "world-server",
  },
  {
    id: "lead",
    title: "The lead's chat open",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "lead",
  },
  {
    id: "chats",
    title: "A Mate with three chats, on the second — the main one works, the third finished unseen",
    chats: [
      { title: FEN_TASK, activity: "working" },
      { title: "Fix the flaky login test", activity: "idle" },
      { title: "Rename the orders column", activity: "done" },
    ],
    crew: [],
    on: 1,
  },
  {
    id: "all",
    title: "Two chats and a crew of six, on a crewmate's chat",
    chats: [
      { title: FEN_TASK, activity: "idle" },
      { title: "Fix the flaky login test", activity: "working" },
    ],
    crew: [...CREW, ...EXTRA_CREW],
    on: "game-rules",
  },
  {
    id: "narrow",
    title: "The same at 640 px (the right panel open)",
    width: 640,
    chats: [
      { title: FEN_TASK, activity: "idle" },
      { title: "Fix the flaky login test", activity: "working" },
    ],
    crew: [...CREW, ...EXTRA_CREW],
    on: "game-rules",
  },
  {
    id: "phone",
    title: "The same at 390 px (a phone)",
    width: 390,
    chats: [
      { title: FEN_TASK, activity: "idle" },
      { title: "Fix the flaky login test", activity: "working" },
    ],
    crew: [...CREW, ...EXTRA_CREW],
    on: "game-rules",
  },
];

interface HeadModel {
  readonly groups: ReadonlyArray<ConversationStripGroup>;
  readonly shown: boolean;
  /** Line 1: who the chat on screen is with, and what about. */
  readonly heading:
    | { readonly kind: "mate"; readonly face: MateMarkState; readonly headline: string }
    | {
        readonly kind: "crewmate";
        readonly seat: CrewSeat;
        readonly face: MateMarkState;
      };
}

function headModel(state: HeadState): HeadModel {
  const chatShells = state.chats.map((chat, index) =>
    shell(index === 0 ? "thread-fen-main" : `thread-fen-${index}`, chat.activity, {
      title: chat.title,
      createdAt: at(index),
      pinnedAt: state.chats.length > 1 && index === 0 ? at(0) : null,
    }),
  );
  const crewShells = state.crew.map((seat) =>
    shell(crewThread(seat), seat.activity, {
      title: seat.displayName,
      crew: { crew: "main", crewmate: seat.handle, stint: 1 },
    }),
  );
  const lastVisitedAtById = visits([...chatShells, ...crewShells]);
  const current =
    typeof state.on === "number"
      ? chatShells[state.on]!.id
      : ThreadId.make(crewThread(state.crew.find((seat) => seat.handle === state.on)!));
  const chats = chatEntries({
    chats: mateChats(chatShells),
    currentThreadId: current,
    startingChat: false,
    mate: FEN,
    lastVisitedAtById,
  });
  const view =
    state.crew.length === 0
      ? null
      : deriveCrewView(crewSnapshot(state.crew), crewShells, (thread) => ({
          status: resolveThreadStatus(thread),
          word: null,
          working: resolveThreadStatus(thread).kind === "working",
        }));
  const crew = crewEntries({ view, currentThreadId: current, connected: true, lastVisitedAtById });
  const face = (thread: EnvironmentThreadShell) =>
    mateMarkStateForThreadStatus(
      resolveThreadStatus({
        ...thread,
        lastVisitedAt: lastVisitedAtById[`${ENVIRONMENT}:${thread.id}`] ?? null,
      }).kind,
    );
  const seat =
    typeof state.on === "string" ? state.crew.find((each) => each.handle === state.on) : undefined;
  return {
    groups: [{ id: "chats", label: "Chats", entries: chats }, crew],
    shown: stripShown(chats, [crew]),
    heading:
      seat === undefined
        ? {
            kind: "mate",
            face: face(chatShells[state.on as number]!),
            headline: chatShells[state.on as number]!.title,
          }
        : { kind: "crewmate", seat, face: face(crewShells[state.crew.indexOf(seat)]!) },
  };
}

/** The header's actions on the right, as `ChatHeader` draws them for a Mate. */
function HeaderActions({ lone }: { readonly lone: boolean }) {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center" />
      <div className="flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25">
        {lone ? (
          <Button aria-label="New chat" data-chat-header-ghost size="icon-sm" variant="ghost-muted">
            <PlusIcon />
          </Button>
        ) : null}
        <Button
          aria-label="More header actions"
          data-chat-header-ghost
          size="icon-sm"
          variant="ghost-muted"
        >
          <EllipsisIcon className="size-4" />
        </Button>
        <Button data-chat-header-ghost size="sm" variant="ghost-muted">
          <ZeropsMark className="size-3.5 shrink-0" />
          <span className="hidden text-line @3xl/header-actions:inline">Open in Zerops</span>
        </Button>
      </div>
    </>
  );
}

/** A Mate with one chat and no crew: `ChatHeader`'s own crumb, the Mate and its task. */
function LoneHeader({
  headline,
  face,
}: {
  readonly headline: string;
  readonly face: MateMarkState;
}) {
  return (
    <WorkspacePageHeader className="relative bg-background" data-chat-header>
      <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <WorkspaceBreadcrumb ariaLabel="Thread breadcrumb" className="flex-1">
          <WorkspaceBreadcrumbItem>
            <span className="inline-flex min-w-0 items-center gap-2.5 text-foreground">
              <MateFace size="sm" state={face} tint={FEN.tint} />
              <span className="max-w-48 truncate font-medium">{FEN.name}</span>
            </span>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbItem
            current
            className="flex-1 font-normal text-muted-foreground transition-colors has-[button:hover]:text-foreground"
          >
            <TitleButton headline={headline} />
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <HeaderActions lone />
      </div>
    </WorkspacePageHeader>
  );
}

/** The task as `ChatHeader`'s title button draws it: the thread's menu on a click. */
function TitleButton({ headline }: { readonly headline: string }) {
  return (
    <button
      className="group/thread-title inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-sm text-left"
      type="button"
    >
      <h2 className="min-w-0 truncate">{headline}</h2>
      <ChevronDownIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/thread-title:opacity-100"
      />
    </button>
  );
}

/**
 * The header with the strip as its line — the real `ConversationStripView` —
 * and the subject under it, in `ChatView`'s slot: the task, or a crewmate's
 * `CrewmateHeader` without its face and name.
 */
function StripHeader({ model }: { readonly model: HeadModel }) {
  const { heading } = model;
  return (
    <>
      <WorkspacePageHeader className="relative bg-background" data-chat-header>
        <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <ConversationStripView
            canMakeMain
            groups={model.groups}
            onClose={() => {}}
            onMakeMain={() => {}}
            onNewChat={() => {}}
            onOpen={() => {}}
          />
          <HeaderActions lone={false} />
        </div>
      </WorkspacePageHeader>
      <div className="relative -mt-3 flex h-6 shrink-0 items-center ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)">
        <div
          className="ms-7.5 flex min-w-0 flex-1 items-center text-line"
          data-conversation-subject
        >
          {heading.kind === "crewmate" ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-foreground">@{heading.seat.handle}</span>
              <span className="min-w-0 truncate text-muted-foreground">{heading.seat.job}</span>
              <Chip className="shrink-0" label="Job v1" tone="off" />
              <Button aria-label="More" className="shrink-0" size="icon-xs" variant="ghost-muted">
                <EllipsisIcon aria-hidden="true" className="size-3.5" />
              </Button>
            </span>
          ) : (
            <div className="flex min-w-0 flex-1 items-center text-muted-foreground transition-colors has-[button:hover]:text-foreground">
              <TitleButton headline={heading.headline} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Frame({ state }: { readonly state: HeadState }) {
  const model = headModel(state);
  return (
    <section className="flex flex-col gap-2" data-head-state={state.id}>
      <p className="text-xs text-muted-foreground">{state.title}</p>
      <div
        className="flex flex-col overflow-hidden rounded-md border border-border bg-background"
        data-head-frame={state.id}
        style={{ width: state.width ?? WIDTH }}
      >
        {model.shown || model.heading.kind === "crewmate" ? (
          <StripHeader model={model} />
        ) : (
          <LoneHeader face={model.heading.face} headline={model.heading.headline} />
        )}
        {model.heading.kind === "crewmate" && model.heading.seat.lead ? <CrewLeadBar /> : null}
        <Conversation />
      </div>
    </section>
  );
}

/** Where the conversation starts under the head, so the head's gap to it shows. */
function Conversation(): ReactNode {
  return (
    <div className="flex justify-center px-5 pt-4 pb-8 sm:px-6">
      <div className="flex w-full max-w-3xl justify-end">
        <p className="rounded-2xl bg-secondary px-4 py-2.5 text-sm">
          Go on with the rules engine, the scoring first.
        </p>
      </div>
    </div>
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen flex-col gap-8 bg-background p-8 text-foreground">
      {STATES.map((state) => (
        <Frame key={state.id} state={state} />
      ))}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
