/**
 * The Crew tab — the crew's one home — in the right panel as the app lays it
 * out at the owner's size: 1786 wide, the left menu at 435 (`?menu=` for
 * another), the panel at its default 540 beside the conversation, or
 * maximized over it with `?max=1`.
 *
 * One `?state=` per artboard of the "Mate Crew Tab" board, so each can be put
 * side by side with it (`prototype-is-the-floor`) — Fen's crew on Letopis:
 * `none` (no crew yet), `setup-start` (*Let Fen suggest a crew* there brings
 * Fen's draft with the setup's next read), `setup-draft`, `idle` (the default),
 * `plan`, `working`, `needs`, `stuck`, `own` (the plan, its run dialog opened
 * from *Change*), `outoftime`, `goal`, `job`; `off` is a tab kept open after
 * crew mode went off. The board's menus (`RowMenu`, `CrewMenu`) are `idle`
 * with its ··· pressed. `?theme=dark` for the dark theme.
 *
 * `&viewer=other` draws every state for a viewer who may not run the crew's
 * agent — signed in by another project member (D6) — so each can be put
 * beside its open twin; `&viewer=unrecorded` for the other reason. A view
 * (setup, goal, job) is not the viewer's to open then, and the tab draws what
 * the app does in its place: the column.
 *
 * The column is the real `CrewPanelBody` in the real `RightPanelTabs`, over a
 * fixture crew; a view (setup, goal, job) is the real view in the same frame,
 * over fixture crew files.
 *
 * Served by the dev server at `/design-crew.html`. Fixtures only: nothing here
 * ships, and no route imports this module.
 */
import {
  crewAccess,
  type CrewLock,
  type CrewLockOwnership,
} from "@t3tools/client-runtime/zerops/crew/crewAccess";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CrewAttention,
  type CrewFiles,
  type CrewRun,
  type CrewSnapshot,
  type CrewTask,
  type Crewmate,
  type ThreadLiveStep,
} from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import { renderCrewHome, parseBrief, type CrewDefinition } from "@t3tools/shared/crewHome";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RightPanelTabs } from "~/components/RightPanelTabs";
import { CrewGoal } from "~/components/zerops/crew/CrewGoal";
import { crewGoalMarkdown } from "~/components/zerops/crew/CrewGoal.logic";
import { CrewmateJob } from "~/components/zerops/crew/CrewmateJob";
import { CrewPanelBody, CrewPanelFrame } from "~/components/zerops/crew/CrewPanel";
import { CrewSetup } from "~/components/zerops/crew/CrewSetup";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { readCrewThread, type CrewRead } from "~/zerops/crew/useCrew";
import type { UseCrewCommand } from "~/zerops/crew/useCrewCommand";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const STATE = params.get("state") ?? "idle";

/** Who looks: the person who runs the crew's agent, or — `&viewer=` — somebody who may not. */
const VIEWERS: Readonly<Record<string, CrewLockOwnership>> = {
  other: "someone-else",
  unrecorded: "unrecorded",
};
const CLOSED = VIEWERS[params.get("viewer") ?? ""] ?? null;
/** Every login of Fen's is closed to such a viewer: Fen's own chat, and each crewmate's. */
const lockOf = (login: string): CrewLock | null =>
  CLOSED === null ? null : { login, agentId: "claude-code", ownership: CLOSED };

const ENVIRONMENT = EnvironmentId.make("environment-crew-harness");
const PROJECT = ProjectId.make("project-crew-harness");
const FEN = { name: "Fen", tint: "amber" as MateTintId };

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const YESTERDAY = minutesAgo(26 * 60);

/* ------------------------------------------------------------ Fen's crew on Letopis */

interface Seat {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  readonly kind: Crewmate["kind"];
  readonly job: string;
}

const LEAD: Seat = {
  handle: "lead",
  displayName: "Lead",
  tint: "violet",
  kind: "lead",
  job: "Plans the work and splits it between the crew.",
};
const SERVER: Seat = {
  handle: "server-and-world",
  displayName: "Server and world",
  tint: "sky",
  kind: "writer",
  job: "The authoritative server: the world's state, saving it, and the public API.",
};
const SYSTEMS: Seat = {
  handle: "game-systems",
  displayName: "Game systems",
  tint: "amber",
  kind: "writer",
  job: "How life in the Letopis world works.",
};
const CLIENTS: Seat = {
  handle: "clients-and-creation",
  displayName: "Clients and creation",
  tint: "olive",
  kind: "writer",
  job: "How people and authoring agents see, create and share the world.",
};

/** The board's OutOfTime artboard has the lead's job as it was written to it. */
const SEATS: ReadonlyArray<Seat> =
  STATE === "outoftime"
    ? [
        {
          ...LEAD,
          job: "You lead the Letopis crew: plans the work and splits it between the three.",
        },
        {
          ...SERVER,
          job: "The whole authoritative backend: the world's state, saving it, and the public API.",
        },
        SYSTEMS,
        CLIENTS,
      ]
    : [LEAD, SERVER, SYSTEMS, CLIENTS];

const GOAL = {
  title: "Letopis — shared persistent world",
  body: "Letopis is a persistent, gradually expanding 3D world built by players and their agents: an authoritative server, a web game client, an editor, and a public API.\n\nSeasons come next: the world should look and behave differently in winter than in summer.",
  rules:
    "The server is the only source of truth: clients never decide what happens.\nNothing in the world resets. Every change is saved.",
  doneWhen: "A player walks from one season into the next without a reload.",
};

const task = (
  fields: Pick<CrewTask, "id" | "number" | "title" | "owner" | "state"> & Partial<CrewTask>,
): CrewTask => ({
  source: "lead",
  createdBy: "user-harness",
  createdAt: minutesAgo(90),
  dependsOn: [],
  fresh: false,
  brief: fields.title,
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
  landedCommit: null,
  landedAt: null,
  delivered: false,
  ...fields,
});

const CLOCK = "task-clock";
const WEATHER = "task-weather";
const SKY = "task-sky";
const SNOW = "task-snow";

const LANDED: ReadonlyArray<CrewTask> = [
  task({
    id: "task-days",
    number: 3,
    title: "Day and night cycle",
    owner: SYSTEMS.handle,
    state: "landed",
    landedCommit: "5e1a2b7",
    landedAt: YESTERDAY,
  }),
  task({
    id: "task-persistence",
    number: 2,
    title: "World persistence",
    owner: SERVER.handle,
    state: "landed",
    landedCommit: "c4d9e02",
    landedAt: minutesAgo(27 * 60),
  }),
];

const planned = (state: CrewTask["state"]): ReadonlyArray<CrewTask> => [
  task({ id: CLOCK, number: 7, title: "Season clock on the server", owner: SERVER.handle, state }),
  task({
    id: WEATHER,
    number: 8,
    title: "Seasons change weather and growth",
    owner: SYSTEMS.handle,
    state,
  }),
  task({
    id: SKY,
    number: 9,
    title: "Seasons in the sky and in the editor",
    owner: CLIENTS.handle,
    state,
    dependsOn: [CLOCK],
  }),
];

const RUN_OPTIONS: CrewRun["options"] = {
  budgetUsd: 20,
  timeLimitHours: 8,
  stopAtUsagePercent: 80,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

const run = (fields: Partial<CrewRun>): CrewRun => ({
  id: "run-harness",
  state: "running",
  reason: null,
  reasonDetail: null,
  startedBy: "user-harness",
  startedAt: minutesAgo(200),
  elapsedMs: 72 * 60_000,
  spentUsd: 6.4,
  usagePercent: 41,
  options: RUN_OPTIONS,
  ...fields,
});

const need = (
  kind: CrewAttention["kind"],
  handle: string,
  taskId: string | null,
  fields: Partial<CrewAttention> = {},
): CrewAttention => ({
  id: `${kind}:${taskId ?? handle}`,
  kind,
  handle,
  taskId,
  text: null,
  paths: [],
  host: null,
  at: minutesAgo(4),
  ...fields,
});

/** Each crewmate's thread: at rest since `ago` minutes, or at work on `step`. */
interface ThreadState {
  readonly ago: number;
  readonly step?: ThreadLiveStep;
  readonly asked?: string;
  readonly said?: string;
}

const STEP_SINCE = minutesAgo(1);
const read = (file: string): ThreadLiveStep => ({
  kind: "calls",
  since: STEP_SINCE,
  calls: [
    {
      id: `call-read-${file}`,
      activityKind: "tool.updated",
      itemType: "dynamic_tool_call",
      title: "Tool call",
      detail: `Read: {"file_path":"${file}"}`,
      toolName: "Read",
      input: { file_path: file },
      startedAt: STEP_SINCE,
    },
  ],
});
const edit = (file: string): ThreadLiveStep => ({
  kind: "calls",
  since: STEP_SINCE,
  calls: [
    {
      id: `call-edit-${file}`,
      activityKind: "tool.updated",
      itemType: "file_change",
      title: "File change",
      detail: `Edit: {"file_path":"${file}"}`,
      toolName: "Edit",
      input: { file_path: file },
      startedAt: STEP_SINCE,
    },
  ],
});
const command = (line: string): ThreadLiveStep => ({
  kind: "calls",
  since: STEP_SINCE,
  calls: [
    {
      id: `call-run-${line}`,
      activityKind: "tool.updated",
      itemType: "command_execution",
      title: "Command run",
      detail: `Bash: ${line}`,
      toolName: "Bash",
      command: line,
      startedAt: STEP_SINCE,
    },
  ],
});

const threadIdOf = (handle: string) => ThreadId.make(`thread-crew-${handle}`);

function shellOf(seat: Seat, state: ThreadState): EnvironmentThreadShell {
  const working = state.step !== undefined;
  const at = minutesAgo(state.ago);
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
      state: working ? "running" : "completed",
      requestedAt: at,
      startedAt: at,
      completedAt: working ? null : at,
      assistantMessageId: null,
    },
    createdAt: YESTERDAY,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: working
      ? {
          threadId: threadIdOf(seat.handle),
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make(`turn-${seat.handle}`),
          lastError: null,
          updatedAt: at,
        }
      : null,
    latestUserMessageAt: at,
    ...(state.asked === undefined
      ? {}
      : { latestUserMessagePreview: { role: "user", text: state.asked, createdAt: at } }),
    ...(state.said === undefined
      ? {}
      : { latestMessagePreview: { role: "assistant", text: state.said, createdAt: at } }),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...(state.step === undefined ? {} : { liveStep: state.step }),
    crew: { crew: "main", crewmate: seat.handle, stint: 1 },
  } as EnvironmentThreadShell;
}

function crewmateOf(seat: Seat, tasks: ReadonlyArray<CrewTask>): Crewmate {
  const mine = tasks.filter((entry) => entry.owner === seat.handle);
  const open = mine.find((entry) =>
    [
      "working",
      "rework",
      "blocked",
      "merging",
      "checking",
      "review",
      "ready",
      "landing",
      "waiting-on-you",
    ].includes(entry.state),
  );
  const writer = seat.kind === "writer";
  return {
    handle: seat.handle,
    displayName: seat.displayName,
    tint: seat.tint,
    kind: seat.kind,
    jobFirstLine: seat.job,
    jobVersion: 1,
    promptVersions: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 1 } },
    login: { id: "claudeAgent", label: "Claude Code", agent: "claude-code" },
    model: null,
    effort: null,
    readOnly: !writer,
    host: writer ? "appdev" : null,
    currentThreadId: threadIdOf(seat.handle),
    stints: [
      {
        stint: 1,
        threadId: threadIdOf(seat.handle),
        state: "active",
        reason: null,
        lastCompactSummary: null,
        startedAt: YESTERDAY,
        retiredAt: null,
      },
    ],
    context: null,
    compactions: 0,
    memory: { entries: 0, unfiled: 0 },
    openTaskId: open?.id ?? null,
    queuedTaskIds: mine.filter((entry) => entry.state === "queued").map((entry) => entry.id),
    lane: writer
      ? {
          branch: `crew/${seat.handle}`,
          ahead: 0,
          insertions: 0,
          deletions: 0,
          dirty: false,
          check: null,
          state: open?.state === "rework" && open.id === SKY ? "conflicts" : "ready",
          detail: null,
        }
      : null,
    app: writer ? { state: "stopped", port: null, url: null } : null,
  };
}

interface CrewState {
  readonly tasks: ReadonlyArray<CrewTask>;
  readonly run: CrewRun | null;
  readonly attention: ReadonlyArray<CrewAttention>;
  readonly threads: Readonly<Record<string, ThreadState>>;
  readonly notShipped: number;
}

const AT_REST = (ago: number): Readonly<Record<string, ThreadState>> =>
  Object.fromEntries(SEATS.map((seat) => [seat.handle, { ago }]));

const STATES: Readonly<Record<string, CrewState>> = {
  idle: {
    tasks: LANDED,
    run: null,
    attention: [],
    threads: AT_REST(26 * 60),
    notShipped: 2,
  },
  plan: {
    tasks: [...LANDED, ...planned("proposed")],
    run: run({ state: "finished", elapsedMs: 5 * 3_600_000, spentUsd: 14.2 }),
    attention: [need("plan", LEAD.handle, null)],
    threads: {
      ...AT_REST(26 * 60),
      [LEAD.handle]: {
        ago: 1,
        asked: "Add seasons to the world",
        said: "Three parts, one for each of them. The sky waits for the season clock.",
      },
    },
    notShipped: 2,
  },
  working: {
    tasks: [
      ...LANDED,
      task({
        id: CLOCK,
        number: 7,
        title: "Season clock on the server",
        owner: SERVER.handle,
        state: "review",
      }),
      task({
        id: WEATHER,
        number: 8,
        title: "Seasons change weather and growth",
        owner: SYSTEMS.handle,
        state: "working",
      }),
      task({
        id: SKY,
        number: 9,
        title: "Seasons in the sky and in the editor",
        owner: CLIENTS.handle,
        state: "working",
      }),
      task({
        id: SNOW,
        number: 10,
        title: "Snow on the ground in winter",
        owner: CLIENTS.handle,
        state: "queued",
      }),
    ],
    run: run({}),
    attention: [],
    threads: {
      [LEAD.handle]: { ago: 2, step: read("/var/www/server/world/seasonClock.ts") },
      [SERVER.handle]: { ago: 5 },
      [SYSTEMS.handle]: { ago: 24, step: command("npm test") },
      [CLIENTS.handle]: { ago: 9, step: edit("/var/www/client/sky/seasonTint.ts") },
    },
    notShipped: 2,
  },
  needs: {
    tasks: [
      ...LANDED,
      task({
        id: CLOCK,
        number: 7,
        title: "Season clock on the server",
        owner: SERVER.handle,
        state: "blocked",
        question: "Should worlds made before today get seasons too, or only new ones?",
      }),
      task({
        id: WEATHER,
        number: 8,
        title: "Seasons change weather and growth",
        owner: SYSTEMS.handle,
        state: "ready",
        diffStat: { insertions: 312, deletions: 40 },
      }),
      task({
        id: SKY,
        number: 9,
        title: "Seasons in the sky and in the editor",
        owner: CLIENTS.handle,
        state: "working",
      }),
    ],
    run: run({ spentUsd: 9.1, elapsedMs: 160 * 60_000 }),
    attention: [
      need("question", SERVER.handle, CLOCK, {
        text: "Should worlds made before today get seasons too, or only new ones?",
      }),
      need("ready-to-land", SYSTEMS.handle, WEATHER),
    ],
    threads: {
      [LEAD.handle]: { ago: 40 },
      [SERVER.handle]: { ago: 4 },
      [SYSTEMS.handle]: { ago: 12 },
      [CLIENTS.handle]: { ago: 9, step: edit("/var/www/client/sky/seasonTint.ts") },
    },
    notShipped: 2,
  },
  stuck: {
    tasks: [
      ...LANDED,
      task({
        id: CLOCK,
        number: 7,
        title: "Season clock on the server",
        owner: SERVER.handle,
        state: "working",
      }),
      task({
        id: WEATHER,
        number: 8,
        title: "Seasons change weather and growth",
        owner: SYSTEMS.handle,
        state: "rework",
        reason: "rain falls upward on slopes",
        review: { verdict: "reject", note: "rain falls upward on slopes", by: LEAD.handle },
      }),
      task({
        id: SKY,
        number: 9,
        title: "Seasons in the sky and in the editor",
        owner: CLIENTS.handle,
        state: "rework",
      }),
    ],
    run: run({ state: "paused", reason: "budget", spentUsd: 20, elapsedMs: 5 * 3_600_000 }),
    attention: [
      need("stalled", SERVER.handle, CLOCK, { text: "when the $20 ran out", at: minutesAgo(8) }),
      need("sent-back", SYSTEMS.handle, WEATHER, { text: "rain falls upward on slopes" }),
      need("conflict", CLIENTS.handle, SKY, { paths: ["client/sky/sky.ts"] }),
    ],
    threads: {
      [LEAD.handle]: { ago: 20 },
      [SERVER.handle]: { ago: 8 },
      [SYSTEMS.handle]: { ago: 15 },
      [CLIENTS.handle]: { ago: 3 },
    },
    notShipped: 2,
  },
  outoftime: {
    tasks: [],
    run: run({ state: "paused", reason: "time", spentUsd: 0, elapsedMs: 8 * 3_600_000 }),
    attention: [],
    threads: AT_REST(8 * 60),
    notShipped: 0,
  },
};

function snapshotOf(state: CrewState): CrewSnapshot {
  return {
    status: "applied",
    seq: 1,
    crew: {
      name: "crew",
      briefTitle: GOAL.title,
      briefVersion: 1,
      briefExcerpt: GOAL.body.split("\n")[0] ?? "",
    },
    crewmates: SEATS.map((seat) => crewmateOf(seat, state.tasks)),
    hosts: [
      {
        host: "appdev",
        integration: null,
        crewPorts: [],
        served: { by: "tree" },
        claim: { state: "none", handle: null, grantWaiting: false },
      },
    ],
    board: { tasks: state.tasks },
    run: state.run,
    attention: state.attention,
    devHosts: [{ host: "appdev", database: false }],
    landedNotDelivered: state.notShipped,
    lastError: null,
  };
}

/* ------------------------------------------------------------ the crew home, for the views */

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
      job:
        seat.handle === SYSTEMS.handle
          ? "How life in the Letopis world works: seasons, weather, growth, and the creatures and what they need. Its code is src/systems, with its tests.\n"
          : `${seat.job}\n`,
    })),
  };
})();

/** The crew home as the setup drafts it: the goal's first paragraph, and the crew Fen suggested. */
const DRAFT: CrewDefinition = {
  ...DEFINITION,
  brief: parseBrief("Letopis — shared persistent world", `${GOAL.body.split("\n")[0]}\n`),
};

/**
 * Whether *Let Fen suggest a crew* was pressed: `setup-start` has the goal and
 * nobody on the crew, and after the press the next read brings Fen's draft,
 * as the Mate writing it would.
 */
let suggested = false;

const homeOf = (): CrewFiles => {
  if (STATE === "setup-start" && !suggested)
    return { files: renderCrewHome({ ...DRAFT, members: [] }) };
  return { files: renderCrewHome(STATE.startsWith("setup") ? DRAFT : DEFINITION) };
};

const readFiles = async () => homeOf();
const FILES: UseCrewCommand = {
  files: {
    state: "known",
    value: homeOf(),
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "settled" },
  },
  send: async () => ({ _tag: "done" }),
  readFiles,
  writeFiles: async () => true,
  pending: false,
  isPending: () => false,
  error: null,
  errorAt: () => null,
  lastRefusal: () => null,
  clearError: () => undefined,
};

/* ------------------------------------------------------------ the tab */

const noop = () => {};

const MAXIMIZED = params.get("max") === "1";
/** The left menu's width: the owner's 435 by default, `?menu=` for another. */
const MENU = Number(params.get("menu") ?? 435);

const COLUMN = STATES[STATE === "own" ? "plan" : STATE] ?? STATES.idle!;
const SNAPSHOT = snapshotOf(COLUMN);
const SHELLS: ReadonlyArray<EnvironmentThreadShell> = SEATS.map((seat) =>
  shellOf(seat, COLUMN.threads[seat.handle] ?? { ago: 60 }),
);

const NONE: CrewSnapshot = {
  ...SNAPSHOT,
  status: "none",
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  landedNotDelivered: 0,
};

/** A view is not a closed viewer's to open: the tab draws the column in its place, as the app does. */
const VIEWS = ["goal", "job", "setup-start", "setup-draft"];
const COLUMN_IN_PLACE = CLOSED !== null && VIEWS.includes(STATE);

function crewRead(): CrewRead {
  if (STATE === "off") return { status: "off", snapshot: null, view: null, current: false };
  if (STATE === "none" || (COLUMN_IN_PLACE && STATE.startsWith("setup"))) {
    return { status: "none", snapshot: NONE, view: null, current: true };
  }
  const view = deriveCrewView(SNAPSHOT, SHELLS, readCrewThread);
  return { status: "applied", snapshot: SNAPSHOT, view, current: true };
}

function Tab() {
  if (COLUMN_IN_PLACE) return <Column />;
  if (STATE === "goal") {
    return (
      <CrewPanelFrame status="applied">
        <div className="crew-view flex flex-1 flex-col">
          <CrewGoal applied commands={FILES} onClose={noop} />
        </div>
      </CrewPanelFrame>
    );
  }
  if (STATE === "job") {
    return (
      <CrewPanelFrame status="applied">
        <div className="crew-view flex flex-1 flex-col">
          <CrewmateJob
            applied={new Set(SEATS.map((seat) => seat.handle))}
            commands={FILES}
            crewPort={null}
            devHosts={[{ host: "appdev", database: false }]}
            mateName={FEN.name}
            mateTint={FEN.tint}
            onClose={noop}
            onRemove={noop}
            providers={undefined}
            target={{ handle: SYSTEMS.handle, lead: false }}
          />
        </div>
      </CrewPanelFrame>
    );
  }
  if (STATE === "setup-start" || STATE === "setup-draft") {
    return (
      <CrewPanelFrame status="none">
        <div className="crew-view flex flex-1 flex-col">
          <CrewSetup
            applied={false}
            commands={FILES}
            crewmates={[]}
            devHosts={["appdev"]}
            hosts={[]}
            mate={FEN}
            onAsk={() => {
              suggested = true;
            }}
            onAskPorts={noop}
            onClose={noop}
            onEditCrewmate={noop}
          />
        </div>
      </CrewPanelFrame>
    );
  }
  return <Column />;
}

/** The tab's column over the fixture crew, as the viewer the harness was asked for sees it. */
function Column() {
  const crew = crewRead();
  const access = crewAccess({
    snapshot: crew.snapshot,
    lockOf,
    defaultLogin: "claudeAgent",
    reading: false,
  });
  return (
    <CrewPanelBody
      access={access}
      askLock={lockOf("claudeAgent")}
      crew={crew}
      environmentId={ENVIRONMENT}
      mate={FEN}
      onAskMate={noop}
      onSignIn={noop}
      treeCwd={null}
    />
  );
}

/**
 * The app's row: the left menu, the conversation's column, and the panel with
 * the Zerops and Crew tabs — which, maximized, takes the conversation's room.
 */
function Harness() {
  const status =
    STATE === "off" ? "off" : STATE === "none" || STATE.startsWith("setup") ? "none" : "applied";
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className={MAXIMIZED ? "w-0 flex-none" : "min-w-0 flex-1"} />
      <RightPanelTabs
        activeSurfaceId="crew"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: status,
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={MAXIMIZED}
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
        widthStorageKey="mate:design-crew:panel-width"
      >
        <Tab />
      </RightPanelTabs>
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
