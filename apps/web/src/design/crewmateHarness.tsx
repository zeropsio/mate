/**
 * A crewmate's empty conversation as the app lays it out at the owner's size:
 * 1786 wide, the left menu at 435 (`?menu=` for another), the conversation's
 * column under its line — Fen and its crew — and the Crew tab open at its
 * default 540 beside it (`?panel=0` without it).
 *
 * One `?state=` per case, each a button in the menu's place: `lead` (the
 * default — the owner's view of Lead's empty conversation in Fen's crew),
 * `builder`, `reviewer`, `long` (a job whose first line runs past three
 * lines), `locked` (a viewer who may not change the crew: no _Change its job_,
 * and the lock notice where the composer would be), `work` (a crewmate that
 * finished work: what went in and what closed with nothing to add), `seams`
 * (a cleared conversation's seam on top), `previous` (a later conversation no
 * seam of its own opens: why it began, and the link to the one before),
 * `unread` (the crew not read yet) and `fen` — Fen's own empty conversation,
 * so the face's place can be measured across a switch between the two.
 * `?theme=dark` for the dark theme. _Change its job_ opens the crewmate's job
 * in the panel, as the conversation's does in the Crew tab.
 *
 * The pane is the real `CrewmateEmptyState` (and the real `MateEmptyStateView`
 * for Fen), the line the real `ConversationStripView`, the panel the real
 * `CrewPanelBody` and `CrewmateJob` over fixture crew files, and the lock
 * notice the real `ZeropsReadOnlyConversationFooter`; the composer is a
 * stand-in in the composer's own glass shell.
 * `window.__crewmateHarness.go(id)` moves to a state from a script, so a
 * measurement can switch without a reload.
 *
 * Served by the dev server at `/design-crewmate.html`. Fixtures only: nothing
 * here ships, and no route imports this module.
 */
import { crewAccess, type CrewLock } from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  crewJobSentence,
  crewMessagePlaceholder,
  crewmateRoleWords,
  crewRunsOnWord,
  mateOwnChatWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CrewFiles,
  type CrewSeam,
  type CrewSnapshot,
  type CrewStint,
  type CrewTask,
  type Crewmate,
} from "@t3tools/contracts";
import { MATE_SHAPE_OF_TINT, type MateTintId } from "@t3tools/shared/brand";
import { parseBrief, renderCrewHome, type CrewDefinition } from "@t3tools/shared/crewHome";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ConversationStripView } from "~/components/chat/ConversationStrip";
import type { LineCrewmate } from "~/components/chat/ConversationStrip.logic";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { crewGoalMarkdown } from "~/components/zerops/crew/CrewGoal.logic";
import { CrewmateEmptyState } from "~/components/zerops/crew/CrewmateEmptyState";
import { CrewmateJob } from "~/components/zerops/crew/CrewmateJob";
import { CrewPanelBody, CrewPanelFrame } from "~/components/zerops/crew/CrewPanel";
import { CrewTimelineContext, type CrewTimeline } from "~/components/zerops/crew/CrewTaskCard";
import { crewCardOrigin } from "~/components/zerops/crew/CrewTaskCard.logic";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import { ZeropsReadOnlyConversationFooter } from "~/components/zerops/ZeropsReadOnlyConversationFooter";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { readCrewThread, type CrewRead } from "~/zerops/crew/useCrew";
import type { UseCrewCommand } from "~/zerops/crew/useCrewCommand";
import type { ZeropsMateIdentity } from "~/zerops/mateIdentities";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
/** The left menu's width: the owner's 435 by default, `?menu=` for another. */
const MENU = Number(params.get("menu") ?? 435);
/** The Crew tab beside the conversation, at its default 540; `?panel=0` closes it. */
const PANEL = params.get("panel") !== "0";

const ENVIRONMENT = EnvironmentId.make("environment-crewmate-harness");
const PROJECT = ProjectId.make("project-crewmate-harness");
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const YESTERDAY = hoursAgo(26);

const FEN: ZeropsMateIdentity = {
  name: "Fen",
  tint: "amber",
  shape: MATE_SHAPE_OF_TINT.amber,
  project: "Letopis",
  projectUrl: "https://app.zerops.io/project/harness",
  connected: true,
};

/* ------------------------------------------------------------ Fen's crew on Letopis */

interface Seat {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  readonly kind: Crewmate["kind"];
  /** The job as it is written to the crewmate; its first line is what the chat shows. */
  readonly job: string;
}

const LEAD: Seat = {
  handle: "lead",
  displayName: "Lead",
  tint: "violet",
  kind: "lead",
  job: "You lead the Letopis crew: Server and world, Game systems, Clients and creation.\n\nPlan each goal into tasks, one owner each, and check every piece before it goes into Fen's code.",
};
const SERVER: Seat = {
  handle: "server-and-world",
  displayName: "Server and world",
  tint: "sky",
  kind: "writer",
  job: "You own Server and world: the authoritative server, the world's state, saving it, and the public API.\n\nNothing in the world resets.",
};
const SYSTEMS: Seat = {
  handle: "game-systems",
  displayName: "Game systems",
  tint: "olive",
  kind: "writer",
  job: "You own Game systems: how life in the Letopis world works — seasons, weather, growth, the creatures and what they need, and the balance between all of them. Its code is src/systems, with its tests, and nothing goes in without them passing on a saved world.\n\nAsk the lead before changing a rule another part reads.",
};
const CLIENTS: Seat = {
  handle: "clients-and-creation",
  displayName: "Clients and creation",
  tint: "coral",
  kind: "writer",
  job: "You own Clients and creation: how people and authoring agents see, create and share the world.",
};
const REFEREE: Seat = {
  handle: "referee",
  displayName: "Referee",
  tint: "rose",
  kind: "reader",
  job: "You review every change to the world's rules: nothing may break a saved world.",
};

const SEATS: ReadonlyArray<Seat> = [LEAD, SERVER, SYSTEMS, CLIENTS, REFEREE];

const firstLine = (job: string) => job.split("\n").find((line) => line.trim() !== "") ?? "";
const threadIdOf = (handle: string) => ThreadId.make(`thread-crew-${handle}`);
const FEN_THREAD = ThreadId.make("thread-fen");

const stintOf = (handle: string): CrewStint => ({
  stint: 1,
  threadId: threadIdOf(handle),
  state: "active",
  reason: null,
  lastCompactSummary: null,
  startedAt: YESTERDAY,
  retiredAt: null,
});

/**
 * The lead's conversations in `previous`: an earlier one, and the one on screen
 * — begun when its job's save applied at a turn's end, which wrote no seam of
 * its own.
 */
const LEAD_EARLIER = ThreadId.make("thread-crew-lead-earlier");
const LEAD_STINTS: ReadonlyArray<CrewStint> = [
  {
    ...stintOf(LEAD.handle),
    threadId: LEAD_EARLIER,
    state: "retired",
    startedAt: hoursAgo(50),
    retiredAt: hoursAgo(3),
  },
  { ...stintOf(LEAD.handle), stint: 2, startedAt: hoursAgo(3) },
];

const landed = (
  id: string,
  number: number,
  title: string,
  commit: string | null,
  hours: number,
): CrewTask => ({
  id,
  number,
  title,
  owner: CLIENTS.handle,
  state: "landed",
  source: "lead",
  createdBy: "user-harness",
  createdAt: hoursAgo(hours + 2),
  dependsOn: [],
  fresh: false,
  brief: title,
  doneWhen: "",
  note: null,
  attempts: 1,
  reason: null,
  question: null,
  waitingOn: [],
  diffStat: null,
  report: null,
  check: null,
  review: null,
  landedCommit: commit,
  landedAt: hoursAgo(hours),
  delivered: true,
});

/** What Clients and creation finished: three pieces that went in, one that closed with nothing to add. */
const CLIENTS_WORK: ReadonlyArray<CrewTask> = [
  landed("task-sky", 9, "Seasons in the sky and in the editor", "5e1a2b7", 2),
  landed("task-snow", 10, "Snow on the ground in winter", "c4d9e02", 27),
  landed("task-undo", 6, "Check the editor's undo across a reload", null, 51),
  landed("task-share", 4, "Share a world by its link", "a1b2c3d", 74),
];

function crewmateOf(seat: Seat): Crewmate {
  const writer = seat.kind === "writer";
  return {
    handle: seat.handle,
    displayName: seat.displayName,
    tint: seat.tint,
    kind: seat.kind,
    jobFirstLine: firstLine(seat.job),
    jobVersion: 1,
    promptVersions: { running: null, current: { brief: 1, job: 1 } },
    login: { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
    model: null,
    effort: null,
    readOnly: !writer,
    host: writer ? "appdev" : null,
    currentThreadId: threadIdOf(seat.handle),
    stints: [stintOf(seat.handle)],
    context: null,
    compactions: 0,
    memory: { entries: 0, unfiled: 0 },
    openTaskId: null,
    queuedTaskIds: [],
    lane: writer
      ? {
          branch: `crew/${seat.handle}`,
          ahead: 0,
          insertions: 0,
          deletions: 0,
          dirty: false,
          check: null,
          state: "ready",
          detail: null,
        }
      : null,
    app: writer ? { state: "stopped", port: null, url: null } : null,
  };
}

const GOAL = {
  title: "Letopis — shared persistent world",
  body: "Letopis is a persistent, gradually expanding 3D world built by players and their agents: an authoritative server, a web game client, an editor, and a public API.",
  rules: "The server is the only source of truth: clients never decide what happens.",
  doneWhen: "A player walks from one season into the next without a reload.",
};

const SNAPSHOT: CrewSnapshot = {
  status: "applied",
  seq: 1,
  crew: { name: "crew", briefTitle: GOAL.title, briefVersion: 1, briefExcerpt: GOAL.body },
  crewmates: SEATS.map(crewmateOf),
  hosts: [
    {
      host: "appdev",
      integration: null,
      crewPorts: [],
      served: { by: "tree" },
      claim: { state: "none", handle: null, grantWaiting: false },
    },
  ],
  board: { tasks: CLIENTS_WORK },
  run: null,
  attention: [],
  devHosts: [{ host: "appdev", database: false }],
  landedNotDelivered: 0,
  lastError: null,
};

/** Each crewmate's chat, opened by the crew's start and never spoken into. */
function shellOf(seat: Seat): EnvironmentThreadShell {
  return {
    id: threadIdOf(seat.handle),
    environmentId: ENVIRONMENT,
    projectId: PROJECT,
    title: seat.displayName,
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make(`turn-${seat.handle}`),
      state: "completed",
      requestedAt: YESTERDAY,
      startedAt: YESTERDAY,
      completedAt: YESTERDAY,
      assistantMessageId: null,
    },
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    crew: { crew: "main", crewmate: seat.handle, stint: 1 },
  } as EnvironmentThreadShell;
}

const CREW: CrewRead = {
  status: "applied",
  snapshot: SNAPSHOT,
  view: deriveCrewView(SNAPSHOT, SEATS.map(shellOf), readCrewThread),
  current: true,
};

/** The crew home the job view reads, as the crew's start wrote it. */
const DEFINITION: CrewDefinition = (() => {
  const { title, text } = crewGoalMarkdown(GOAL);
  return {
    crew: "crew",
    name: "Crew",
    brief: parseBrief(title, text),
    members: SEATS.map((seat) => ({
      handle: seat.handle,
      displayName: seat.displayName,
      kind: seat.kind,
      readOnly: seat.kind !== "writer",
      tint: seat.tint,
      ...(seat.kind === "writer"
        ? { host: "appdev", setup: "npm ci", check: "npm test", run: "npm run dev" }
        : {}),
      restartAfterMerge: false,
      afterLandRestart: false,
      login: "claudeAgent",
      env: {},
      migrations: [],
      job: `${seat.job}\n`,
    })),
  };
})();

const FILES: UseCrewCommand = {
  files: {
    state: "known",
    value: { files: renderCrewHome(DEFINITION) },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "settled" },
  },
  send: async () => ({ _tag: "done" }),
  readFiles: async (): Promise<CrewFiles> => ({ files: renderCrewHome(DEFINITION) }),
  writeFiles: async () => true,
  pending: false,
  isPending: () => false,
  error: null,
  errorAt: () => null,
  lastRefusal: () => null,
  clearError: () => undefined,
};

/* ------------------------------------------------------------ the states */

interface HarnessState {
  readonly id: string;
  readonly label: string;
  /** Whose empty conversation; `null` for Fen's own. */
  readonly seat: Seat | null;
  /** Its conversations, when it has had more than the one on screen. */
  readonly stints: ReadonlyArray<CrewStint> | null;
  /** The viewer may change the crew: _Change its job_ is offered and the composer is theirs. */
  readonly mayChange: boolean;
  /** The crew's feed has answered: the crewmate is known. */
  readonly read: boolean;
  readonly seams: ReadonlyArray<{
    readonly id: string;
    readonly seam: CrewSeam;
    readonly words: string;
  }>;
}

const state = (
  id: string,
  label: string,
  seat: Seat | null,
  fields: Partial<Pick<HarnessState, "mayChange" | "read" | "seams" | "stints">> = {},
): HarnessState => ({
  id,
  label,
  seat,
  stints: fields.stints ?? null,
  mayChange: fields.mayChange ?? true,
  read: fields.read ?? true,
  seams: fields.seams ?? [],
});

const STATES: ReadonlyArray<HarnessState> = [
  state("lead", "Lead · the owner's view", LEAD),
  state("builder", "A builder · Server and world", SERVER),
  state("reviewer", "A reviewer · Referee", REFEREE),
  state("long", "A long first line · Game systems", SYSTEMS),
  state("locked", "May not change the crew · Lead", LEAD, { mayChange: false }),
  state("work", "Its finished work · Clients and creation", CLIENTS),
  state("seams", "A seam on top · Server and world", SERVER, {
    seams: [
      {
        id: "seam-stint",
        seam: { seam: "stint", previousThreadId: ThreadId.make("thread-crew-server-0") },
        words: "You cleared its conversation",
      },
    ],
  }),
  state("previous", "A later conversation, no seam · Lead", LEAD, { stints: LEAD_STINTS }),
  state("unread", "The crew not read yet · Clients and creation", CLIENTS, { read: false }),
  state("fen", "Fen's own empty conversation", null),
];

/* ------------------------------------------------------------ the conversation */

const noop = () => {};

/** The conversation's line, as `ChatHeader` draws it: Fen, then its crew, the one on screen a pill. */
function LineHeader({ current }: { readonly current: Seat | null }) {
  const crew = SEATS.map((seat): LineCrewmate => ({
    handle: seat.handle,
    name: seat.displayName,
    tint: seat.tint,
    face: "idle",
    lead: seat.kind === "lead",
    open: seat.handle === current?.handle,
    known: true,
    threadId: threadIdOf(seat.handle),
    role: crewmateRoleWords(FEN.name, seat.kind === "lead"),
    job:
      seat.kind === "lead" ? null : crewJobSentence(firstLine(seat.job), seat.displayName) || null,
    status: null,
  }));
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <ConversationStripView
        chats={null}
        crew={crew}
        mate={{
          name: FEN.name,
          tint: FEN.tint,
          shape: FEN.shape,
          face: "idle",
          open: current === null,
          threadId: FEN_THREAD,
          tooltip: current === null ? null : mateOwnChatWord(FEN.name),
        }}
        onCloseChat={noop}
        onOpen={noop}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
    </div>
  );
}

/** The composer's overlay at rest, measured in the app: what the pane's foot keeps clear. */
const COMPOSER_HEIGHT = 136;

/** Someone else signed the crew's agent in: the lock notice stands where the composer would. */
const LOCKED = {
  notice: "Signed in by another project member — only they can run this agent.",
  waitingLabel: "Waiting for the agent's owner",
};

/**
 * Where the composer is: a stand-in in the composer's own glass shell and at its resting height —
 * or, for a viewer who may not run the agent, the real lock notice.
 */
function ComposerSlot({ current }: { readonly current: HarnessState }) {
  const locked = !current.mayChange && LOCKED !== null;
  const seat = current.seat;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
      data-harness-composer
    >
      <div className="w-full ps-(--workspace-gutter-start) pe-(--workspace-gutter-end) pb-4">
        <div className="pointer-events-auto chat-composer-glass-shell relative mx-auto w-full max-w-3xl">
          <div className="chat-composer-glass-host relative z-10 w-full">
            {locked && LOCKED !== null ? (
              <ZeropsReadOnlyConversationFooter
                onSignIn={noop}
                pendingApprovals={[]}
                pendingUserInputs={[]}
                readOnly={LOCKED}
              />
            ) : (
              <div
                className="relative z-10 flex h-28 flex-col justify-between px-4 pt-3.5 pb-3"
                data-chat-composer-main-surface="true"
              >
                <span className="text-placeholder text-sm">
                  {seat === null
                    ? `Ask ${FEN.name} anything…`
                    : crewMessagePlaceholder(seat.displayName)}
                </span>
                {seat === null ? null : (
                  <span className="text-muted-foreground text-xs">
                    {crewRunsOnWord({ login: "Claude Code", model: null, effort: null })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Pane({
  current,
  onChangeJob,
}: {
  readonly current: HarnessState;
  readonly onChangeJob: (handle: string) => void;
}) {
  const seat = current.seat;
  const read =
    seat === null || !current.read
      ? null
      : (SNAPSHOT.crewmates.find((mate) => mate.handle === seat.handle) ?? null);
  const profile =
    read === null || current.stints === null ? read : { ...read, stints: current.stints };
  const change = current.mayChange && seat !== null ? () => onChangeJob(seat.handle) : null;
  // As ChatView: why this conversation began, where no seam of its own says so.
  const timeline: CrewTimeline | null =
    seat === null
      ? null
      : {
          firstCardId: null,
          origin: crewCardOrigin({
            stints: profile?.stints ?? [],
            threadId: threadIdOf(seat.handle),
            seamed: current.seams.some((row) => row.seam.seam === "stint"),
          }),
          tasks: SNAPSHOT.board.tasks,
          crewmate: { handle: seat.handle, profile },
          mateName: FEN.name,
          onOpenThread: noop,
          onChangeJob: change,
        };
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col" data-harness-pane>
        {timeline === null ? (
          <MateEmptyStateView
            mate={FEN}
            phase={null}
            signIn={null}
            signInRequired={false}
            unknown={null}
          />
        ) : (
          <CrewTimelineContext value={timeline}>
            <CrewmateEmptyState
              bottomInset={COMPOSER_HEIGHT}
              crew={timeline}
              environmentId={ENVIRONMENT}
              mateFace={FEN}
              seams={current.seams}
            />
          </CrewTimelineContext>
        )}
      </div>
      <ComposerSlot current={current} />
    </div>
  );
}

/* ------------------------------------------------------------ the panel */

/** The column beside the conversation, open: the empty state's own lock is what this page shows. */
const OPEN_CREW = crewAccess({
  snapshot: CREW.snapshot,
  lockOf: (): CrewLock | null => null,
  defaultLogin: "claudeAgent",
  reading: false,
});

function Panel({
  job,
  onCloseJob,
}: {
  readonly job: string | null;
  readonly onCloseJob: () => void;
}) {
  return (
    <RightPanelTabs
      activeSurfaceId="crew"
      availability={resolveRightPanelAvailability({
        projectOpen: true,
        gitRepo: true,
        serverThread: true,
        zeropsPanel: "available",
        crewStatus: "applied",
      })}
      defaultWidth={540}
      liveAgentCount={0}
      maximized={false}
      mode="inline"
      onActivate={noop}
      onAdd={noop}
      onAddTerminal={noop}
      onCloseAllSurfaces={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurface={noop}
      onCloseSurfacesToRight={noop}
      onCopyFilePath={noop}
      pendingSurfaceIds={new Set()}
      surfaces={[
        { id: "zerops", kind: "zerops" },
        { id: "crew", kind: "crew" },
      ]}
      terminalLabelsById={new Map()}
      widthStorageKey="mate:design-crewmate:panel-width"
    >
      {job === null ? (
        <CrewPanelBody
          access={OPEN_CREW}
          askLock={null}
          crew={CREW}
          environmentId={ENVIRONMENT}
          mate={FEN}
          onAskMate={noop}
          onSignIn={noop}
          treeCwd={null}
        />
      ) : (
        // What _Change its job_ opens, as the conversation's press does in the Crew tab.
        <CrewPanelFrame status="applied">
          <div className="crew-view flex flex-1 flex-col">
            <CrewmateJob
              applied={new Set(SEATS.map((seat) => seat.handle))}
              commands={FILES}
              crewPort={null}
              devHosts={[{ host: "appdev", database: false }]}
              key={job}
              mateName={FEN.name}
              mateTint={FEN.tint}
              onClose={onCloseJob}
              onRemove={noop}
              providers={undefined}
              target={{ handle: job, lead: false }}
            />
          </div>
        </CrewPanelFrame>
      )}
    </RightPanelTabs>
  );
}

/* ------------------------------------------------------------ the page */

function Harness() {
  const [currentId, setCurrentId] = useState(
    () => STATES.find((each) => each.id === params.get("state"))?.id ?? "lead",
  );
  const [job, setJob] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as { __crewmateHarness: unknown }).__crewmateHarness = {
      go: (id: string) => setCurrentId(id),
      states: STATES.map((each) => each.id),
    };
  }, []);
  const current = STATES.find((each) => each.id === currentId) ?? STATES[0]!;
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col gap-1 border-border border-e bg-sidebar p-4"
        style={{ width: MENU }}
      >
        <p className="pb-2 text-muted-foreground text-xs">A crewmate's empty conversation</p>
        {STATES.map((each) => (
          <button
            aria-current={each.id === current.id ? "true" : undefined}
            className="rounded-lg px-3 py-2 text-left text-sm aria-[current=true]:bg-accent"
            data-harness-state={each.id}
            key={each.id}
            onClick={() => {
              setCurrentId(each.id);
              setJob(null);
            }}
            type="button"
          >
            {each.label}
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {/* The app's own top bar, so the conversation under it stands where ChatView's does. */}
        <WorkspacePageHeader className="relative bg-background" data-chat-header>
          <LineHeader current={current.seat} />
        </WorkspacePageHeader>
        <Pane current={current} onChangeJob={setJob} />
      </main>
      {PANEL ? <Panel job={job} onCloseJob={() => setJob(null)} /> : null}
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
