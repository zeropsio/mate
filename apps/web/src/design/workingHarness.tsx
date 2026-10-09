import { assembleRecordCard } from "../components/chat/MessagesTimeline.logic";
/**
 * A run's card in every state it reaches: its heading, its chat in one
 * scroll with the Mate's face beside what it is on, what runs alongside it,
 * and the result it settles into.
 *
 * Served by the dev server at `/design-working.html` (`?theme=dark` for the
 * dark theme). The card's parts take what they show as rows and props, so a
 * batch deploy, a question that waits and a helper still at it all stand side
 * by side without a Mate doing any of them.
 *
 * Fixtures only. Nothing here ships — `design-working.html` is not
 * `index.html`, and no route imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import { enrollmentRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";

import { ConversationAfterWork, ConversationWorking } from "~/components/chat/ConversationWorking";
import type { ConversationSpeaker } from "~/components/chat/ConversationRows";
import {
  activityCounts,
  splitBatchDeploy,
  type OutcomeModel,
} from "~/components/chat/conversation.logic";
import type { DockModel } from "~/components/chat/conversationDock.logic";
import type {
  MessagesTimelineRow,
  RunStatus,
  RecordItem,
  TurnHeaderActivity,
} from "~/components/chat/MessagesTimeline.logic";
import { BrowserStrip } from "~/components/chat/BrowserStrip";
import { RunChat } from "~/components/chat/RunChat";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "~/components/chat/timelineContext";
import { TurnReport } from "~/components/chat/TurnReport";
import { CardStates } from "./cardStates";
import { ResultStates } from "./resultFixtures";
import { foldSteps, stepOf } from "~/components/chat/workSteps.logic";
import type { WorkLogEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import { StandupReadings } from "~/zerops/activity/useStandupReading";
import {
  standupReadingOf,
  type StandupReading,
  type StandupServiceRow,
} from "@t3tools/client-runtime/zerops/activity/standupReading";
import "../index.css";

const SPEAKER: ConversationSpeaker = { name: "Nova", tint: "sky" };
const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function status(overrides: Partial<RunStatus>): RunStatus {
  return {
    live: true,
    face: "working",
    startedAt: ago(134),
    endedAt: null,
    waitedMs: 0,
    waitingSince: null,
    worked: true,
    ...overrides,
  };
}

function deploy(overrides: Partial<ZeropsOperation>): ZeropsOperation {
  return {
    key: "op:deploy",
    kind: "deploy",
    phase: "running",
    anchorAt: ago(48),
    anchorActivityId: "deploy",
    turnId: "turn-1",
    subject: "appdev",
    kicker: "Deploy · appdev",
    voice: "Deploying appdev.",
    voiceSource: "mate",
    statusWord: "Deploying",
    steps: [],
    links: [],
    callIds: ["deploy"],
    target: { hostname: "appdev" },
    hasResult: false,
    ...overrides,
  };
}

/** A settled browser check with no picture, as a real one reads. */
function readCheck(
  key: string,
  subject: string,
  overrides: Partial<ZeropsOperation>,
): ZeropsOperation {
  return {
    key,
    kind: "browser",
    phase: "done",
    anchorAt: ago(40),
    anchorActivityId: key,
    settledAt: ago(29),
    turnId: "turn-1",
    subject,
    kicker: `Browser · ${subject}`,
    voice: `Checking ${subject}`,
    voiceSource: "mate",
    statusWord: "Checked",
    steps: [],
    links: [],
    callIds: [key],
    hasResult: true,
    viewport: { width: 1640, height: 1000 },
    browserSummary: { stepCount: 3, errorCount: 0, failedRequestCount: 0, line: "" },
    ...overrides,
  };
}

/** Takes that read the page, asked it how many of a thing it had, and read only its errors. */
const READ_CHECKS = [
  readCheck("op:read-page", "https://shop.example.dev/status", {
    browserRead: {
      page: {
        kind: "tree",
        text: [
          "- banner",
          '  - link "Snap"',
          '  - link "Docs"',
          '- heading "Service status" [level=1]',
          "- paragraph",
          '  - StaticText "Everything runs as it should."',
          "- list",
          "  - listitem",
          '    - StaticText "Hostname: app"',
          "  - listitem",
          '    - StaticText "Node v22.22.3"',
          "  - listitem",
          '    - StaticText "Uptime 3 days"',
          '- img "Requests over the last hour"',
          '- textbox "Email for updates"',
          '- button "Subscribe"',
        ].join("\n"),
      },
      answers: [],
    },
  }),
  readCheck("op:read-answers", "https://shop.example.dev/cz", {
    browserRead: {
      answers: [
        { asked: "main h3", answer: "6 found" },
        { asked: "main section[aria-label] ol li", answer: "3 found" },
      ],
    },
  }),
  readCheck("op:read-findings", "https://shop.example.dev/cz/kosik", {}),
];

const BATCH = splitBatchDeploy(
  deploy({
    key: "op:batch",
    batch: true,
    subject: "apistage, webstage",
    anchorAt: ago(28),
    steps: [
      { id: "apistage", label: "apistage", state: "running", stateLabel: "Running" },
      { id: "webstage", label: "webstage", state: "queued", stateLabel: "Waiting" },
    ],
  }),
);

/** An import of a pair whose dev half the platform refused, with its reason. */
const IMPORT_ONE_FAILED: ZeropsOperation = {
  ...deploy({}),
  key: "op:import",
  kind: "import",
  phase: "failed",
  anchorAt: ago(70),
  settledAt: ago(9),
  subject: "appdev, appstage",
  kicker: "Import · appdev, appstage",
  voice: "Importing appdev and appstage.",
  statusWord: "Import failed",
  closing: "Failed.",
  target: { hostname: "appdev" },
  steps: [
    {
      id: "appdev",
      label: "appdev",
      state: "failed",
      stateLabel: "Failed",
      note: "serviceStackCreateFailed: the project's disk quota is used up",
    },
    { id: "appstage", label: "appstage", state: "done", stateLabel: "Done" },
  ],
};

/** A deploy that landed. */
const DEPLOY_DONE = deploy({
  key: "op:deploy-done",
  phase: "done",
  statusWord: "Deployed",
  settledAt: ago(2),
  closing: "appdev is live.",
});

/** An operation of no single service: a check of every one. */
function withoutTarget(overrides: Partial<ZeropsOperation>): ZeropsOperation {
  const { target: _target, ...rest } = deploy(overrides);
  return rest;
}

/** A made-up Mate's own working branch, as zcp names its pushes. */
const MATE_BRANCH_VERSION = "mate/mate-Pq7Zr0TestProject0000A 227b804";

/** What the owner's guestbook run did, made up: a deploy, a check of every service, a dev server found down. */
const GUESTBOOK: ReadonlyArray<RecordItem> = [
  {
    kind: "operation",
    key: "operation:op:gb-deploy",
    at: ago(90),
    operation: deploy({
      key: "op:gb-deploy",
      subject: "appstage",
      target: { hostname: "appstage" },
      phase: "done",
      statusWord: "Deployed",
      anchorAt: ago(168),
      settledAt: ago(90),
      version: { name: MATE_BRANCH_VERSION },
      steps: ["Build container", "Build", "Prepare", "Deploy", "Run"].map((label) => ({
        id: label,
        label,
        state: "done" as const,
        stateLabel: "Done",
      })),
    }),
  },
  {
    kind: "operation",
    key: "operation:op:gb-verify",
    at: ago(80),
    operation: withoutTarget({
      key: "op:gb-verify",
      kind: "verify",
      subject: "all services",
      phase: "done",
      statusWord: "Healthy",
      voice: "Checking all services.",
      anchorAt: ago(82),
      settledAt: ago(80),
      steps: ["appdev", "appstage", "db", "cache"].map((label) => ({
        id: label,
        label,
        state: "done" as const,
        stateLabel: "Done",
      })),
    }),
  },
  {
    kind: "operation",
    key: "operation:op:gb-dev",
    at: ago(60),
    operation: deploy({
      key: "op:gb-dev",
      kind: "devServer",
      subject: "appdev",
      target: { hostname: "appdev" },
      phase: "done",
      statusWord: "Not running",
      voice: "Checking the dev server on appdev.",
      anchorAt: ago(61),
      settledAt: ago(60),
      steps: [{ id: "dev-server", label: "Status", state: "failed", stateLabel: "Failed" }],
    }),
  },
];

/** Thinking, between steps. */
const THINKING_NOW: TurnHeaderActivity = { kind: "thinking", key: null, messages: [] };

const EMPTY_DOCK: DockModel = {
  operations: [],
  helpers: null,
  tasks: null,
  background: null,
  afterTurn: null,
  pause: null,
};

const BUSY_DOCK: DockModel = {
  ...EMPTY_DOCK,
  operations: BATCH,
  helpers: {
    rows: [
      {
        id: "h1",
        title: "Summarize the docs in one line",
        tone: "ok",
        word: "Done",
        startedAt: ago(40),
        endedAt: ago(22),
      },
      {
        id: "h2",
        title: "List the top-level files",
        tone: "busy",
        word: "Working",
        startedAt: ago(40),
        endedAt: null,
      },
    ],
    working: 1,
    done: 1,
    failed: 0,
  },
  background: {
    tasks: [
      {
        id: "b1",
        title: "Run the smoke tests",
        state: "running",
        watch: false,
        turnId: "turn-1",
        startedAt: ago(12),
        endedAt: null,
      },
    ],
    running: 1,
    done: 0,
    failed: 0,
  },
};

const SETTLED_DOCK: DockModel = {
  ...EMPTY_DOCK,
  operations: [
    deploy({ phase: "done", statusWord: "Deployed", settledAt: ago(2) }),
    ...splitBatchDeploy(
      deploy({
        key: "op:batch-settled",
        batch: true,
        phase: "failed",
        statusWord: "Failed",
        subject: "apistage, webstage",
        settledAt: ago(1),
        steps: [
          { id: "apistage", label: "apistage", state: "done", stateLabel: "Done" },
          {
            id: "webstage",
            label: "webstage",
            state: "failed",
            stateLabel: "Failed",
            note: "Build failed",
          },
        ],
      }),
    ),
  ],
};

const AFTER_DOCK: DockModel = {
  ...EMPTY_DOCK,
  afterTurn: "monitoring",
  background: {
    tasks: [
      {
        id: "w1",
        title: "Watch the pull request's checks",
        state: "running",
        watch: true,
        turnId: "turn-1",
        startedAt: ago(95),
        endedAt: null,
      },
    ],
    running: 1,
    done: 0,
    failed: 0,
  },
};

const REPORT: OutcomeModel = {
  key: "outcome:turn-1",
  turnKey: "turn-1",
  live: [
    {
      hostname: "appdev",
      tone: "ok",
      word: "Healthy",
      version: "11ea406",
      url: "https://example.dev",
      at: ago(20),
      failure: null,
    },
    {
      hostname: "apistage",
      tone: "ok",
      word: "Deployed",
      version: null,
      url: null,
      at: ago(20),
      failure: null,
    },
    {
      hostname: "webstage",
      tone: "failed",
      word: "Failed",
      version: null,
      url: null,
      at: ago(20),
      failure: null,
    },
  ],
  landed: [],
  files: { count: 3, additions: 42, deletions: 7, turnId: TurnId.make("turn-1"), fromTurnId: null },
  checks: { count: 5, views: 2, failures: 0, takes: [] },
  pictures: [],
  created: [],
  notDone: [],
  planLeft: [],
  change: null,
  crewTask: null,
  activity: [],
  later: { services: [], changes: [], tasks: [], pages: [], views: [], files: [], answered: false },
};

const TURN = TurnId.make("turn-1");

function said(
  id: string,
  role: "assistant" | "reasoning",
  text: string,
  seconds: number,
  streaming = false,
): ChatMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: TURN,
    streaming,
    createdAt: ago(seconds),
    updatedAt: ago(seconds),
  };
}

function call(partial: Partial<WorkLogEntry> & { readonly id: string }): WorkLogEntry {
  return {
    createdAt: ago(100),
    label: "Tool call",
    tone: "tool",
    sourceActivityKind: "tool.completed",
    toolLifecycleStatus: "completed",
    ...partial,
  };
}

function run(
  id: string,
  command: string,
  description: string | null,
  seconds: number,
  took: number,
  extra: Partial<WorkLogEntry> = {},
): WorkLogEntry {
  return call({
    id,
    label: "Command run",
    itemType: "command_execution",
    command,
    ...(description === null ? {} : { callInput: { description } }),
    startedAt: ago(seconds + took),
    createdAt: ago(seconds + took),
    updatedAt: ago(seconds),
    ...extra,
  });
}

const HEALTH_SCRIPT = [
  "cat > src/routes/status.ts <<'EOF'",
  'import { Router } from "express";',
  'import { pool } from "../db";',
  "",
  "export const status = Router();",
  "",
  'status.get("/status", async (_request, response) => {',
  "  const started = Date.now();",
  "  try {",
  '    await pool.query("select 1");',
  "    response.json({",
  '      build: process.env.BUILD_NUMBER ?? "dev",',
  '      database: "up",',
  "      ms: Date.now() - started,",
  "    });",
  "  } catch (error) {",
  '    response.status(503).json({ database: "down", error: String(error) });',
  "  }",
  "});",
  "EOF",
].join("\n");

const LONG_THOUGHT = [
  "**Planning the check**",
  "",
  "The build takes about two minutes. While it runs I'll plan the check: /status should show the build number in its first row and the database in its second, green when it answers and red after two seconds without one.",
  "",
  "On a phone the number must not wrap onto a second line, so I'll look at an iPhone 13 first, then a desktop at 1280. If the number reads \"dev\", the pipeline didn't pass BUILD_NUMBER, which would mean the variable in zerops.yml sits under run instead of build — I'd move it and push again before saying it's done.",
].join("\n");

const edits = foldSteps(
  [
    call({
      id: "e1",
      itemType: "file_change",
      label: "File change",
      detail: 'Edit: {"file_path":"/var/www/app/src/routes.ts"}',
      createdAt: ago(80),
    }),
    call({
      id: "e2",
      itemType: "file_change",
      label: "File change",
      detail: 'Edit: {"file_path":"/var/www/app/src/status.test.ts"}',
      createdAt: ago(79),
    }),
  ],
  undefined,
  false,
)[0]!;

/** The run's chat some way in: each kind of bubble once. */
const SO_FAR: ReadonlyArray<RecordItem> = [
  {
    kind: "thought",
    key: "thought:r1",
    at: ago(130),
    messages: [
      said(
        "r1",
        "reasoning",
        "The readiness check asks for /status, but the router only registers /health. Either the route or zerops.yml is wrong.",
        130,
      ),
    ],
    durationMs: 6000,
  },
  {
    kind: "step",
    key: "step:w1",
    at: ago(124),
    step: stepOf(
      call({ id: "w1", detail: 'Read: {"file_path":"/var/www/app/src/routes.ts"}' }),
      undefined,
      false,
    ),
  },
  {
    kind: "step",
    key: "step:w2",
    at: ago(122),
    step: stepOf(
      call({
        id: "w2",
        detail: 'Grep: {"pattern":"readinessCheck"}',
        callInput: { pattern: "readinessCheck" },
      }),
      undefined,
      false,
    ),
  },
  {
    kind: "step",
    key: "step:w3",
    at: ago(118),
    step: stepOf(
      run(
        "w3",
        "cd /var/www/app && grep -rn status src/routes.ts",
        "Find where the route is registered",
        118,
        1,
        {
          detail:
            'src/routes.ts:14:  app.get("/health", health);\nsrc/routes.ts:22:  // status lives on the dashboard',
        },
      ),
      undefined,
      false,
    ),
  },
  {
    kind: "note",
    key: "note:a1",
    at: ago(110),
    message: said(
      "a1",
      "assistant",
      "Found it: the check asks for `/status` and the router only has `/health`. I'll add `/status` and keep `/health` for the load balancer.",
      110,
    ),
  },
  {
    kind: "person",
    key: "person:u2",
    at: ago(90),
    message: {
      id: MessageId.make("u2"),
      role: "user",
      text: "Keep /health working too, the load balancer still calls it",
      turnId: TURN,
      streaming: false,
      createdAt: ago(90),
    } as ChatMessage,
    imageOnly: false,
  },
  { kind: "step", key: "step:e1", at: ago(79), step: edits },
  {
    kind: "step",
    key: "step:w4",
    at: ago(76),
    step: stepOf(run("w4", HEALTH_SCRIPT, "Write the status route", 76, 1), undefined, false),
  },
  {
    kind: "thought",
    key: "thought:r2",
    at: ago(74),
    messages: [said("r2", "reasoning", LONG_THOUGHT, 74)],
    durationMs: 21_000,
  },
  {
    kind: "step",
    key: "step:w5",
    at: ago(50),
    step: stepOf(
      run("w5", "cd /var/www/app && npm run build", "Run the production build", 50, 24, {
        detail:
          "> app@0.1.1 build\n> tsc -p . && vite build\n\n✓ 214 modules transformed.\ndist/index.js  48.2 kB",
      }),
      undefined,
      false,
    ),
  },
  {
    kind: "operation",
    key: "operation:op:deploy-done",
    at: ago(40),
    operation: deploy({
      key: "op:deploy-done",
      phase: "done",
      statusWord: "Deployed",
      anchorAt: ago(112),
      settledAt: ago(40),
      version: { name: "v0.1.1" },
      steps: [
        { id: "build", label: "Build", state: "done", stateLabel: "Done" },
        { id: "deploy", label: "Deploy", state: "done", stateLabel: "Done" },
        { id: "run", label: "Run", state: "done", stateLabel: "Done" },
      ],
    } as Partial<ZeropsOperation>),
  },
  {
    kind: "step",
    key: "step:w6",
    at: ago(33),
    step: stepOf(
      run("w6", "npm test -- status", "Run the tests for the page", 33, 6, {
        toolLifecycleStatus: "failed",
        detail:
          "FAIL src/status.test.ts\n  ✕ answers 200 with the build number (12 ms)\n    Expected: 200\n    Received: 503",
      }),
      undefined,
      false,
    ),
  },
  {
    kind: "event",
    key: "event:c1",
    at: ago(30),
    event: { type: "compaction", label: "Context compacted" },
  },
  {
    kind: "step",
    key: "step:w7",
    at: ago(24),
    step: stepOf(
      call({
        id: "w7",
        itemType: "web_search",
        toolTitle: "WebFetch",
        callInput: { url: "https://docs.example.dev/zerops-yml#readiness" },
      }),
      undefined,
      false,
    ),
  },
  {
    kind: "task",
    key: "task:k1",
    at: ago(18),
    entry: call({
      id: "k1",
      label: "Watch the pull request's checks",
      toolTitle: "Watch the pull request's checks",
      tone: "info",
      sourceActivityKind: "task.completed",
      taskId: "bk1",
      detail: "checks: 3 passed, 0 failed\nmerge: allowed",
    }),
  },
];

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

function record(overrides: Partial<RecordRow>): RecordRow {
  const row = {
    kind: "record" as const,
    id: "record:turn-1",
    createdAt: ago(134),
    turnKey: "turn-1",
    live: true,
    items: SO_FAR,
    now: null,
    answering: false,
    status: status({}),
    outcome: null,
    ...overrides,
  };
  return { ...row, ...assembleRecordCard(row) };
}

const RUNNING_STEP: TurnHeaderActivity = {
  kind: "step",
  step: stepOf(
    call({
      id: "w9",
      label: "Command run",
      itemType: "command_execution",
      command: "npm run lint",
      callInput: { description: "Lint the page" },
      toolLifecycleStatus: "inProgress",
      sourceActivityKind: "tool.started",
      startedAt: ago(4),
      createdAt: ago(4),
    }),
  ),
};

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "harness",
  threadRef: null,
  markdownCwd: undefined,
  resolvedTheme: "light",
  workspaceRoot: undefined,
  skills: [],
  activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
  onRevertToTurnCount: () => undefined,
  onRunShellCommand: undefined,
  onImageExpand: () => undefined,
  onOpenTurnDiff: () => undefined,
  speaker: SPEAKER,
  standUpAsk: null,
  livePauseId: null,
  usagePause: null,
  onUsageAutoResumeChange: null,
  agentPanelModel: emptyAgentPanelModel(),
  onOpenAgents: () => undefined,
  onStopBackgroundWork: () => undefined,
  onSteerQueuedMessage: () => undefined,
  steerQueuedMessageShortcutLabel: null,
  onRemoveQueuedMessage: () => undefined,
  arrivedAfter: null,
  syncing: false,
  onHoldReading: () => undefined,
};

const WORKING: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: null,
  workingStepLabel: null,
  stoppingBackgroundWork: false,
};

/**
 * A run's card as the conversation draws it: its slices on the tray — its
 * record on top, its result in the band under the worked line — and its
 * bottom edge a slice of its own.
 */
function Card({
  result = null,
  children,
}: {
  readonly result?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <div className="run-tray run-tray-top">{children}</div>
      {result === null ? null : (
        <div className="run-tray run-tray-middle pt-1">
          <div className="run-band">{result}</div>
        </div>
      )}
      <div className="run-tray run-tray-bottom" />
    </div>
  );
}

// A stand-up call's bar in each state its builds reach: made-up services, a
// reading per state in place of the platform's.
function standupOp(key: string, subject: "development" | "stage"): ZeropsOperation {
  return {
    key,
    kind: "standup",
    phase: "running",
    anchorAt: ago(420),
    anchorActivityId: key,
    turnId: "turn-1",
    subject,
    kicker: `Stand-up · ${subject}`,
    voice: `Standing ${subject} up.`,
    voiceSource: "mate",
    statusWord: "Standing up",
    steps: [],
    links: [],
    callIds: [key],
    hasResult: false,
  };
}

/** What development stands up around its runtimes: the data, up since the arrival, and a mail catcher. */
const DEV_AROUND: ReadonlyArray<StandupServiceRow> = [
  { hostname: "db", state: "up" },
  { hostname: "cache", state: "up" },
  { hostname: "storage", state: "up" },
  { hostname: "search", state: "up" },
  { hostname: "mailer", state: "up" },
];

/** What the stages share: the data. */
const STAGE_AROUND = DEV_AROUND.filter((row) => row.hostname !== "mailer");

const STANDUP_STATES: ReadonlyArray<{
  readonly label: string;
  readonly subject: "development" | "stage";
  readonly rows: ReadonlyArray<StandupServiceRow>;
}> = [
  {
    label: "Just started: the data and the mail catcher up, the runtimes queued",
    subject: "development",
    rows: [
      ...DEV_AROUND,
      { hostname: "apidev", state: "waits" },
      { hostname: "shopdev", state: "waits" },
    ],
  },
  {
    label: "One building",
    subject: "development",
    rows: [
      ...DEV_AROUND,
      {
        hostname: "apidev",
        state: "building",
        startedAt: ago(130),
        sentence: "Running build commands from zerops.yml",
      },
      { hostname: "shopdev", state: "waits" },
    ],
  },
  {
    label: "Several building, one of the data still starting",
    subject: "development",
    rows: [
      { hostname: "db", state: "up" },
      { hostname: "cache", state: "up" },
      { hostname: "storage", state: "building", sentence: "Starting" },
      { hostname: "search", state: "up" },
      { hostname: "mailer", state: "up" },
      { hostname: "apidev", state: "building", startedAt: ago(130), sentence: "Deploying" },
      {
        hostname: "shopdev",
        state: "building",
        startedAt: ago(128),
        sentence: "Running build commands from zerops.yml",
      },
    ],
  },
  {
    label: "One runtime up",
    subject: "development",
    rows: [
      ...DEV_AROUND,
      { hostname: "apidev", state: "up", startedAt: ago(400), endedAt: ago(90) },
      {
        hostname: "shopdev",
        state: "building",
        startedAt: ago(80),
        sentence: "Running build commands from zerops.yml",
      },
    ],
  },
  {
    label: "All up",
    subject: "development",
    rows: [
      ...DEV_AROUND,
      { hostname: "apidev", state: "up", startedAt: ago(400), endedAt: ago(90) },
      { hostname: "shopdev", state: "up", startedAt: ago(398), endedAt: ago(4) },
    ],
  },
  {
    label: "The stages: one failed, the rest go on",
    subject: "stage",
    rows: [
      ...STAGE_AROUND,
      { hostname: "apistage", state: "failed", startedAt: ago(400), endedAt: ago(200) },
      { hostname: "shopstage", state: "building", startedAt: ago(150) },
    ],
  },
];

const STANDUP_READINGS: ReadonlyMap<string, StandupReading> = new Map(
  STANDUP_STATES.map((state, index) => [`op:standup-${index}`, standupReadingOf(state.rows)]),
);

function StandupStates() {
  return (
    <StandupReadings value={STANDUP_READINGS}>
      <State
        label="Standing up"
        note="A stand-up call's bar: a segment per service of the environment, the build that runs, how many are up."
      >
        {STANDUP_STATES.map((state, index) => {
          const operation = standupOp(`op:standup-${index}`, state.subject);
          return (
            <div className="grid gap-1" data-standup-state={state.label} key={operation.key}>
              <p className="text-muted-foreground text-xs">{state.label}</p>
              <Card>
                <RunChat
                  row={record({
                    turnKey: `standup-${index}`,
                    items: [],
                    now: { kind: "operation", operation },
                  })}
                />
                <ConversationWorking
                  dock={{ ...EMPTY_DOCK, operations: [operation] }}
                  environmentId={null}
                  incidents={[]}
                  onOpenAgents={() => undefined}
                  threadRef={null}
                />
              </Card>
            </div>
          );
        })}
        <RelayedStandup />
      </State>
    </StandupReadings>
  );
}

/** A stand-up whose Mate relays zcp's progress: the card reads it, no fixture reading. */
function RelayedStandup() {
  const operation: ZeropsOperation = {
    ...standupOp("op:standup-relayed", "development"),
    standUpProgress: {
      phase: "development",
      state: "running",
      services: [
        { hostname: "db", step: "verify", state: "done", processId: "", at: ago(300) },
        { hostname: "apidev", step: "deploy", state: "running", processId: "p-2", at: ago(70) },
        { hostname: "shopdev", step: "build", state: "running", processId: "p-3", at: ago(40) },
        { hostname: "workerdev", step: "build", state: "pending", processId: "", at: "" },
      ],
    },
  };
  return (
    <div className="grid gap-1" data-standup-state="Relayed by its Mate">
      <p className="text-muted-foreground text-xs">Relayed by its Mate, from zcp's status file</p>
      <Card>
        <RunChat
          row={record({
            turnKey: "standup-relayed",
            items: [],
            now: { kind: "operation", operation },
          })}
        />
        <ConversationWorking
          dock={{ ...EMPTY_DOCK, operations: [operation] }}
          environmentId={null}
          incidents={[]}
          onOpenAgents={() => undefined}
          threadRef={null}
        />
      </Card>
    </div>
  );
}

function State({
  label,
  note: caption,
  children,
}: {
  readonly label: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-2" data-harness-state={label}>
      <div>
        <h2 className="font-medium text-foreground text-sm">{label}</h2>
        <p className="text-muted-foreground text-xs">{caption}</p>
      </div>
      {children}
    </section>
  );
}

/** A made-up screenshot: a page's shape, drawn, in place of a real take. */
function shot(width: number, height: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f4f1ea"/><rect x="6%" y="6%" width="88%" height="10%" rx="8" fill="#d9d2c3"/><text x="50%" y="55%" font-family="sans-serif" font-size="${Math.round(width / 12)}" text-anchor="middle" fill="#6b6456">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const STAGE_URL = "https://appstage-2b7d.prg1.example.app";

/** The guestbook's stage checked on a desktop and on a phone. */
const STAGE_TAKES = [
  { key: "op:gb-desktop", device: undefined, width: 1440, height: 900, label: "Guestbook" },
  { key: "op:gb-phone", device: "iPhone 16", width: 393, height: 852, label: "Guestbook" },
].map(({ key, device, width, height, label }) =>
  deploy({
    key,
    kind: "browser",
    subject: `${STAGE_URL}/`,
    target: { hostname: "appstage" },
    phase: "done",
    statusWord: "Checked",
    anchorAt: ago(40),
    settledAt: ago(30),
    screenshot: { src: shot(width, height, label), width, height },
    ...(device === undefined ? {} : { deviceName: device }),
  }),
);

/** What the guestbook run left: its stage deployed and checked twice, its dev server running. */
const GUESTBOOK_RESULT: OutcomeModel = {
  ...REPORT,
  key: "outcome:guestbook",
  turnKey: "guestbook",
  live: [
    {
      hostname: "appstage",
      tone: "ok",
      word: "Deployed",
      version: "227b804",
      url: STAGE_URL,
      at: ago(90),
      failure: null,
    },
    {
      hostname: "appdev",
      tone: "ok",
      word: "Dev server running",
      version: null,
      url: null,
      at: ago(20),
      failure: null,
    },
  ],
  files: null,
  change: null,
  checks: { count: 2, views: 2, failures: 0, takes: STAGE_TAKES },
  pictures: STAGE_TAKES.map((take) => ({
    kind: "check" as const,
    key: take.key,
    src: take.screenshot!.src,
    caption: "/",
    page: "appstage-2b7d.prg1.example.app/",
    device: take.deviceName ?? null,
    failed: false,
    ratio: take.screenshot!.width! / take.screenshot!.height!,
  })),
};

// What its calls came to: the worked line's effort, never a row.
const REPORT_WITH_ACTIVITY: OutcomeModel = {
  ...REPORT,
  activity: activityCounts(
    [
      {
        id: "c1",
        createdAt: ago(90),
        label: "Ran command",
        tone: "tool",
        command: "npm run build",
      },
      { id: "c2", createdAt: ago(60), label: "Ran command", tone: "tool", command: "npm test" },
    ],
    [
      {
        id: "s1",
        createdAt: ago(80),
        label: "Review the change",
        tone: "tool",
        agentSpawn: { workflowId: null, agentTaskIds: ["h1", "h2", "h3"] },
      },
    ],
  ),
};

function Harness() {
  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto grid w-full max-w-3xl gap-16">
        <StandupStates />
        <CardStates />
        <State
          label="Doing, with work alongside"
          note="Every kind of line the chat holds; the call it makes on the now line; the bars under it."
        >
          <Card>
            <RunChat row={record({ turnKey: "busy-run", now: RUNNING_STEP })} />
            <ConversationWorking
              dock={BUSY_DOCK}
              environmentId={null}
              incidents={[]}
              onOpenAgents={() => undefined}
              threadRef={null}
            />
          </Card>
        </State>
        <State
          label="A long run, come back to"
          note="Closed to its summary line, Show work on its right edge; the result under it."
        >
          <Card
            result={
              <TurnReport
                onOpenImage={() => undefined}
                onOpenTurnDiff={() => undefined}
                outcome={REPORT_WITH_ACTIVITY}
              />
            }
          >
            <RunChat
              row={record({
                turnKey: "long-run",
                live: false,
                status: status({ live: false, face: "produced", endedAt: ago(2) }),
                outcome: REPORT_WITH_ACTIVITY,
              })}
            />
          </Card>
        </State>
        {[
          { label: "An import, one failed", operation: IMPORT_ONE_FAILED },
          { label: "A deploy, done", operation: DEPLOY_DONE },
          {
            label: "A deploy of a long name",
            operation: deploy({
              key: "op:deploy-long",
              subject: "storefrontpreviewdevhost",
              target: { hostname: "storefrontpreviewdevhost" },
              statusWord: "Deploying",
            }),
          },
        ].map(({ label, operation }) => (
          <State
            key={label}
            label={label}
            note="Its name, a segment per service, its state once; opened, a line per service."
          >
            <Card>
              <RunChat
                row={record({ turnKey: `dock-${operation.key}`, items: [], now: RUNNING_STEP })}
              />
              <ConversationWorking
                dock={{ ...EMPTY_DOCK, operations: [operation] }}
                environmentId={null}
                incidents={[]}
                onOpenAgents={() => undefined}
                threadRef={null}
              />
            </Card>
          </State>
        ))}
        <State
          label="The guestbook card"
          note="A deploy from the Mate's branch, a check of every service, a dev server found down: the dock waits while that is the latest line."
        >
          <Card>
            <RunChat row={record({ turnKey: "guestbook", items: GUESTBOOK, now: THINKING_NOW })} />
            <ConversationWorking
              dock={EMPTY_DOCK}
              environmentId={null}
              incidents={[]}
              onOpenAgents={() => undefined}
              threadRef={null}
            />
          </Card>
        </State>
        <State
          label="A result with long words"
          note="A dirty push's version, a long page checked twice, a long reason: the checked words keep their room."
        >
          <Card
            result={
              <TurnReport
                facts={{}}
                onOpenImage={() => undefined}
                onOpenTurnDiff={() => undefined}
                outcome={{
                  ...GUESTBOOK_RESULT,
                  pictures: [],
                  checks: {
                    count: 2,
                    views: 2,
                    failures: 0,
                    takes: STAGE_TAKES.map((take) => ({
                      ...take,
                      subject: `${STAGE_URL}/api/health`,
                    })),
                  },
                  live: [
                    { ...GUESTBOOK_RESULT.live[0]!, version: "227b804 · uncommitted" },
                    {
                      ...GUESTBOOK_RESULT.live[1]!,
                      tone: "failed",
                      word: "Build failing",
                      failure: {
                        reason:
                          "3 type errors in src/routes/guestbook/entries.ts: Property 'author' does not exist on type 'Entry'",
                        at: ago(20),
                        logLines: [],
                      },
                    },
                  ],
                }}
              />
            }
          >
            <RunChat
              row={record({
                turnKey: "guestbook-long",
                items: GUESTBOOK,
                live: false,
                status: status({ live: false, face: "produced", endedAt: ago(2) }),
                outcome: GUESTBOOK_RESULT,
              })}
            />
          </Card>
        </State>
        <State
          label="The guestbook result"
          note="Its stage deployed from the Mate's branch and checked on a desktop and a phone; its dev server running."
        >
          <Card
            result={
              <TurnReport
                facts={{}}
                onOpenImage={() => undefined}
                onOpenTurnDiff={() => undefined}
                outcome={GUESTBOOK_RESULT}
              />
            }
          >
            <RunChat
              row={record({
                turnKey: "guestbook-settled",
                items: GUESTBOOK,
                live: false,
                status: status({ live: false, face: "produced", endedAt: ago(2) }),
                outcome: GUESTBOOK_RESULT,
              })}
            />
          </Card>
        </State>
        {[
          {
            label: "A stand-up that failed before any service, its reason cut short",
            reason: enrollmentRefusalWords("not_this_projects_mate"),
          },
          {
            label: "A stand-up that failed before any service, its reason whole",
            reason: enrollmentRefusalWords("project_gone"),
          },
        ].map(({ label, reason }) => (
          <State key={label} label={label} note="Opening adds only what its line cut short.">
            <Card>
              <RunChat
                row={record({
                  turnKey: `standup-failed-${reason.length}`,
                  now: THINKING_NOW,
                  items: [
                    {
                      kind: "operation",
                      key: `operation:op:standup-failed-${reason.length}`,
                      at: ago(10),
                      operation: {
                        ...standupOp(`op:standup-failed-${reason.length}`, "development"),
                        phase: "failed",
                        statusWord: "Failed",
                        settledAt: ago(10),
                        anchorAt: ago(190),
                        explanation: { reason },
                      },
                    },
                  ],
                })}
              />
            </Card>
          </State>
        ))}
        <State
          label="A message with a picture sent into the run"
          note="Its first line on the person's side, never a picture's label, its picture small under it, opening the viewer."
        >
          <Card>
            <RunChat
              row={record({
                turnKey: "echo-picture",
                now: THINKING_NOW,
                items: [
                  ...SO_FAR.slice(0, 2),
                  {
                    kind: "person",
                    key: "person:echo",
                    at: ago(20),
                    imageOnly: false,
                    message: {
                      ...said(
                        "echo",
                        "assistant",
                        "[Picture 1]\nmake the map larger and let people pick a district on it",
                        20,
                      ),
                      role: "user",
                      attachments: [
                        {
                          type: "image",
                          id: "echo-shot",
                          name: "landing.png",
                          mimeType: "image/png",
                          sizeBytes: 1200,
                          previewUrl: shot(1440, 900, "Landing"),
                        },
                      ],
                    },
                  },
                ],
              })}
            />
          </Card>
        </State>
        <State
          label="Settled bars"
          note="A deploy that landed and a batch that failed, as the bars say it."
        >
          <Card>
            <ConversationWorking
              dock={SETTLED_DOCK}
              environmentId={null}
              incidents={[]}
              onOpenAgents={() => undefined}
              threadRef={null}
            />
          </Card>
        </State>
        <State
          label="Checked without a picture"
          note="The frame draws what the check read: the page, else its answers, else its findings."
        >
          {READ_CHECKS.map((check) => (
            <Card key={check.key}>
              <BrowserStrip
                environmentId={null}
                onOpenImage={() => undefined}
                strip={{
                  key: `strip:${check.key}`,
                  checks: [check],
                  views: 1,
                  failures: 0,
                  live: false,
                }}
                threadRef={null}
              />
            </Card>
          ))}
        </State>
        <State
          label="After the turn"
          note="Work that outlived the turn: the face, what still runs, and Stop."
        >
          <ConversationAfterWork
            dock={AFTER_DOCK}
            environmentId={null}
            onOpenAgents={() => undefined}
            onStop={() => undefined}
            speaker={SPEAKER}
            state="monitoring"
            stopping={false}
            threadRef={null}
          />
        </State>
        <ResultStates />
      </div>
    </div>
  );
}

/** The panel's deploy bars read the platform's pipeline: stand-ins that answer nothing. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    lost: new Set(),
  };
  const data: ZeropsDataContextValue = {
    // The markdown's commands ask the account's grant what they may do: a
    // grant that never answers, since nothing here is run.
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

// The app sets the theme on the document element (`themePalette.ts`), so the
// harness does the same rather than nesting a `.dark` wrapper the tokens never
// reach — in the Zerops palette a fresh install wears, whose card and muted
// fill sit closer than the fallback tokens'.
const appearance = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Standins>
        <TimelineRowCtx value={{ ...SHARED, resolvedTheme: appearance }}>
          <TimelineRowActivityCtx value={WORKING}>
            <Harness />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>
      </Standins>
    </StrictMode>,
  );
}
