/**
 * The top of a Mate's conversation — one line, the header's — in every state
 * it has, at the width the owner's chat column really gets (1786 wide, the
 * menu at 435), and narrowed to 570 and 390.
 *
 * The line is the real `ConversationStripView` over the models the real
 * `lineMate`, `lineChats` and `lineCrew` make of fixture threads and a fixture
 * crew, and a crewmate's menu the real `CrewmateMenuPopup` over the real
 * `crewmateMenuModel` and `crewTryOf`; the header around it is drawn with
 * `ChatHeader`'s own classes, since the real header reads the app's stores.
 *
 * Served by the dev server at `/design-strip.html` (`?theme=dark`,
 * `?width=<px>` for every full-width frame, `?open=<frame>` to open that
 * frame's menu — the writer's by default, `none` for none). The `reload`
 * frame paints the crew this browser remembers and turns to the feed's a
 * moment later, as a reload does. The first frame switches on a press
 * (`SwitchFrame`). Fixtures only: nothing here ships, and no route imports
 * this module.
 */
import { StrictMode, useEffect, useState, type ReactNode } from "react";
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
  type CrewHost,
  type CrewSnapshot,
  type Crewmate,
} from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";
import { EllipsisIcon } from "lucide-react";

import { ConversationStripView } from "~/components/chat/ConversationStrip";
import {
  lineChats,
  lineCrew,
  lineMate,
  mateChats,
  type LineCrewmate,
} from "~/components/chat/ConversationStrip.logic";
import { Button } from "~/components/ui/button";
import { threadAgentActivity } from "~/zerops/agentActivity";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { ZeropsMark } from "~/components/ZeropsMark";
import { CrewmateMenuPopup } from "~/components/zerops/crew/CrewmateMenu";
import { crewmateMenuModel } from "~/components/zerops/crew/CrewmateMenu.logic";
import { crewTryOf, crewTryPress, crewTryStops } from "~/zerops/crew/crewTry";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
/** The owner's chat column: 1786 wide, the menu at 435. */
const WIDTH = Number(params.get("width") ?? 1351);
/** Whose menu is open: a frame's id, or `none`. */
const OPEN = params.get("open") ?? "writer";

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
  readonly kind: Crewmate["kind"];
  readonly job: string;
  readonly activity: Activity;
  /** Its own app: running or stopped on a crew port, or none — shown on dev instead. */
  readonly app: "running" | "stopped" | "none" | null;
}

const CREW: ReadonlyArray<CrewSeat> = [
  {
    handle: "lead",
    displayName: "Lead",
    tint: "violet",
    kind: "lead",
    job: "Turns the brief into tasks and reviews each landing.",
    activity: "idle",
    app: null,
  },
  {
    handle: "world-server",
    displayName: "World Server",
    tint: "sky",
    kind: "writer",
    job: "You own the world server under server/ and its tests.",
    activity: "working",
    app: "running",
  },
  {
    handle: "game-rules",
    displayName: "Game Rules",
    tint: "rose",
    kind: "writer",
    job: "You own Game Rules: turns, scoring and their tests. Write the tests first.",
    activity: "needs",
    app: "stopped",
  },
  {
    handle: "web-client",
    displayName: "Web Client",
    tint: "olive",
    kind: "writer",
    job: "Owns the browser client and its end-to-end tests.",
    activity: "done",
    app: "none",
  },
];

const EXTRA_CREW: ReadonlyArray<CrewSeat> = [
  {
    handle: "docs",
    displayName: "Docs",
    tint: "coral",
    kind: "reader",
    job: "Reviews the README and the API reference against each change.",
    activity: "idle",
    app: null,
  },
  {
    handle: "load-tests",
    displayName: "Load Tests",
    tint: "slate",
    kind: "writer",
    job: "Writes and runs the load tests against the stage.",
    activity: "working",
    app: "stopped",
  },
];

const crewThread = (seat: CrewSeat) => `thread-crew-${seat.handle}-1`;

/** The dev service the writers' copies live on: its own port, then its crew ports. */
const HOST: CrewHost = {
  host: "appdev",
  integration: null,
  crewPorts: [3001, 3002, 3003, 3004, 3005].map((port) => ({ port, routed: true })),
  served: { by: "tree" },
  claim: { state: "none", handle: null, grantWaiting: false },
};
const SERVICES = [
  {
    hostname: "appdev",
    routes: [3000, 3001, 3002, 3003, 3004, 3005].map((port) => ({
      port,
      url: `https://appdev-${port}.example.test`,
    })),
  },
];

function crewSnapshot(seats: ReadonlyArray<CrewSeat>): CrewSnapshot {
  const base = crewSnapshotFixture();
  const writer = base.crewmates[1]!;
  const lead = base.crewmates[0]!;
  const crewmates = seats.map((seat, index): Crewmate => {
    const template = seat.kind === "writer" ? writer : lead;
    return {
      ...template,
      handle: seat.handle,
      displayName: seat.displayName,
      tint: seat.tint,
      kind: seat.kind,
      readOnly: seat.kind !== "writer",
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
      host: seat.kind === "writer" ? "appdev" : null,
      lane:
        seat.kind === "writer"
          ? { ...writer.lane!, branch: `crew/${seat.handle}`, ahead: 2 }
          : null,
      app:
        seat.app === null
          ? null
          : {
              state: seat.app,
              port: seat.app === "none" ? null : 3001 + index,
              url: null,
            },
    };
  });
  return {
    ...base,
    crewmates,
    hosts: [HOST],
    board: { ...base.board, tasks: [] },
    attention: [],
  };
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
  /** The crew this browser remembers, turning to the feed's a moment later. */
  readonly reload?: true;
  /** Nothing remembered: the crewmate on screen alone, its crew's feed a moment later. */
  readonly arrive?: true;
  /** What the chat on screen is about, where not its title; `null` for a chat nobody spoke into. */
  readonly subject?: string | null;
  /** The subject arrives a moment after the line is painted, as the first words sent. */
  readonly lateSubject?: true;
}

const LONG_SUBJECT =
  "Move the checkout's payment calls into one batched request per basket, keep the old path behind a flag for a day, and write down what to watch in the logs before we remove it for good.";

const STATES: ReadonlyArray<HeadState> = [
  {
    id: "crew",
    title:
      "Fen's own chat, with its crew — World Server works, Game Rules needs you, Web Client finished unseen",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: 0,
  },
  {
    id: "writer",
    title: "A writer's chat — Game Rules, its app stopped — its menu open",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "game-rules",
  },
  {
    id: "writer-running",
    title: "A writer whose app runs — World Server (?open=writer-running)",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "world-server",
  },
  {
    id: "writer-dev",
    title: "A writer whose app cannot run on its own — Web Client (?open=writer-dev)",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "web-client",
  },
  {
    id: "lead",
    title: "The lead's chat (?open=lead)",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "lead",
  },
  {
    id: "chats",
    title: "A Mate with two chats, from before chats were retired, on the second (?open=chats)",
    chats: [
      { title: FEN_TASK, activity: "working" },
      { title: "Fix the flaky login test", activity: "idle" },
    ],
    crew: [],
    on: 1,
  },
  {
    id: "lone",
    title: "A Mate with no crew: its face and name, then what its chat is about",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: [],
    on: 0,
  },
  {
    id: "lone-short",
    title: "A Mate with no crew, a short subject",
    chats: [{ title: "Fix the login redirect", activity: "idle" }],
    crew: [],
    on: 0,
  },
  {
    id: "lone-long",
    title: "A Mate with no crew, a subject longer than the line: cut off, whole on hover",
    chats: [{ title: LONG_SUBJECT, activity: "working" }],
    crew: [],
    on: 0,
  },
  {
    id: "lone-none",
    title: "A Mate with no crew in a chat nobody has spoken into: its name alone",
    chats: [{ title: "New chat", activity: "idle" }],
    crew: [],
    on: 0,
    subject: null,
  },
  {
    id: "lone-late",
    title: "A Mate with no crew whose subject arrives after the line is painted: it fades in",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: [],
    on: 0,
    lateSubject: true,
  },
  {
    id: "reload",
    title: "A reload: the crew this browser remembers, at rest, then the feed's",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "game-rules",
    reload: true,
  },
  {
    id: "arrive",
    title:
      "A crewmate's chat opened with nothing remembered: that crewmate alone, then its crew as the feed answers — placed, never slid",
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: CREW,
    on: "game-rules",
    arrive: true,
  },
  {
    id: "narrow",
    title: "A crew of six on a crewmate's chat at 570 px: the rest fold into N more",
    width: 570,
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: [...CREW, ...EXTRA_CREW],
    on: "load-tests",
  },
  {
    id: "phone",
    title: "The same at 390 px (a phone)",
    width: 390,
    chats: [{ title: FEN_TASK, activity: "idle" }],
    crew: [...CREW, ...EXTRA_CREW],
    on: "load-tests",
  },
];

/** The header's actions on the right, as `ChatHeader` draws them for a Mate. */
function HeaderActions() {
  return (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center" />
      <div className="flex shrink-0 items-center justify-end gap-1 pr-18.25 sm:pr-14.25">
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

function Frame({
  state,
  onSwitch,
}: {
  readonly state: HeadState;
  /** Presses open the chat pressed: the Mate's own (`0`) or a crewmate's handle. */
  readonly onSwitch?: (on: number | string) => void;
}) {
  // A reload: what this browser remembers first, the feed's a moment later.
  const [live, setLive] = useState(state.reload !== true && state.arrive !== true);
  useEffect(() => {
    if (live) return;
    const timer = setTimeout(() => setLive(true), 1500);
    return () => clearTimeout(timer);
  }, [live]);
  // A subject arriving late: none on the first paint, the first words a moment later.
  const [spoken, setSpoken] = useState(state.lateSubject !== true);
  useEffect(() => {
    if (spoken) return;
    const timer = setTimeout(() => setSpoken(true), 1500);
    return () => clearTimeout(timer);
  }, [spoken]);
  // The menu asked for opens as a press opens it, once the frame stands.
  useEffect(() => {
    if (OPEN !== state.id) return;
    const timer = setTimeout(() => {
      const frame = document.querySelector(`[data-head-frame="${state.id}"]`);
      frame
        ?.querySelector<HTMLElement>(
          state.chats.length > 1 && state.crew.length === 0
            ? "[data-conversation-chats]"
            : '[data-conversation-crewmate][data-current="true"]',
        )
        ?.click();
    }, 300);
    return () => clearTimeout(timer);
  }, [state]);

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
  const seat =
    typeof state.on === "string" ? state.crew.find((each) => each.handle === state.on) : undefined;
  const current =
    seat === undefined ? chatShells[state.on as number]!.id : ThreadId.make(crewThread(seat));
  const snapshot = state.crew.length === 0 ? null : crewSnapshot(state.crew);
  const view =
    snapshot === null || !live
      ? null
      : deriveCrewView(snapshot, crewShells, (thread) => ({
          status: resolveThreadStatus(thread),
          word: null,
          working: resolveThreadStatus(thread).kind === "working",
        }));
  const chats = mateChats(chatShells);
  // What the data layer reads of the Mate: here, the chat of its own on screen, else its main one.
  const its = seat === undefined ? chatShells[state.on as number]! : chats[0]!;
  const activity = threadAgentActivity(its, lastVisitedAtById[`${ENVIRONMENT}:${its.id}`]);
  const crew = lineCrew({
    view,
    remembered:
      state.reload === true
        ? {
            faces: state.crew.map((each) => ({
              handle: each.handle,
              displayName: each.displayName,
              tint: each.tint,
              lead: each.kind === "lead",
            })),
          }
        : undefined,
    crewChat: seat === undefined ? null : { handle: seat.handle, title: seat.displayName },
    mateName: FEN.name,
    connected: true,
    lastVisitedAtById,
  });
  const menu = (crewmate: LineCrewmate): ReactNode => {
    const row = view?.crewmates.find((each) => each.crewmate.handle === crewmate.handle);
    if (row === undefined || snapshot === null) return null;
    const tries = crewTryOf(snapshot.hosts, row.crewmate, SERVICES);
    return (
      <CrewmateMenuPopup
        model={crewmateMenuModel({
          crewmate: row.crewmate,
          mateName: FEN.name,
          tries:
            tries === null
              ? null
              : {
                  where: tries.where,
                  enabled: crewTryPress(tries, row.working) !== null,
                  stops: crewTryStops(tries),
                },
          busy: false,
        })}
        onSelect={() => {}}
      />
    );
  };
  return (
    <section className="flex flex-col gap-2" data-head-state={state.id}>
      <p className="text-xs text-muted-foreground">{state.title}</p>
      <div
        className="flex flex-col overflow-hidden rounded-md border border-border bg-background"
        data-head-frame={state.id}
        style={{ width: state.width ?? WIDTH }}
      >
        <WorkspacePageHeader className="relative bg-background" data-chat-header>
          <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <ConversationStripView
              chats={lineChats(chats, current)}
              crew={crew}
              renderCrewmateMenu={menu}
              mate={lineMate({
                mate: FEN,
                face: {
                  connected: FEN.connected,
                  activity,
                  reviewWaits: false,
                  mine: true,
                  restarting: false,
                },
                chats,
                crewChatOpen: seat !== undefined,
                subject:
                  seat !== undefined || !spoken
                    ? null
                    : state.subject === undefined
                      ? chatShells[state.on as number]!.title
                      : state.subject,
              })}
              onCloseChat={() => {}}
              onOpen={(threadId) => {
                const pressed = state.crew.find((each) => crewThread(each) === threadId);
                onSwitch?.(pressed === undefined ? 0 : pressed.handle);
              }}
              onRename={() => {}}
              renameField={null}
            />
            <HeaderActions />
          </div>
        </WorkspacePageHeader>
        <Conversation />
      </div>
    </section>
  );
}

/** Where the conversation starts under the line, so the line's gap to it shows. */
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

/**
 * The line to press: Fen and its crew, a press on a face opening that
 * crewmate's chat and one on Fen its own, as a route change does.
 * `window.__stripHarness.switchTo("game-rules")` (or `0` for Fen's own chat)
 * switches from a script, so a per-frame sampler can watch a switch it
 * started itself; `setCrewSize(6)` adds the crew's two others, `setCrewSize(4)`
 * takes them away.
 */
function SwitchFrame() {
  const [on, setOn] = useState<number | string>(0);
  // How many of the crew stand on the line: a crewmate added or removed is placed, never slid.
  const [size, setSize] = useState(CREW.length);
  useEffect(() => {
    (window as unknown as { __stripHarness: unknown }).__stripHarness = {
      switchTo: setOn,
      setCrewSize: setSize,
    };
  }, []);
  return (
    <Frame
      onSwitch={setOn}
      state={{
        id: "switch",
        title: "Press a face, or Fen: the band travels, the faces slide, the names fold and open",
        chats: [{ title: FEN_TASK, activity: "idle" }],
        crew: [...CREW, ...EXTRA_CREW].slice(0, size),
        on,
      }}
    />
  );
}

function Harness() {
  return (
    <div className="flex min-h-screen flex-col gap-8 bg-background p-8 text-foreground">
      <SwitchFrame />
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
