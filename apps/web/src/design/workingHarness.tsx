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
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import * as Stream from "effect/Stream";

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
import { foldSteps, stepOf } from "~/components/chat/workSteps.logic";
import type { WorkLogEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
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
  files: { count: 3, additions: 42, deletions: 7, turnId: TurnId.make("turn-1") },
  checks: { count: 5, views: 2, failures: 0, takes: [] },
  created: [],
  notDone: [],
  planLeft: [],
  change: null,
  crewTask: null,
  activity: [],
  later: { services: [], changes: [], tasks: [], pages: [], answered: false },
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
  return {
    kind: "record",
    id: "record:turn-1",
    createdAt: ago(134),
    turnKey: "turn-1",
    live: true,
    items: SO_FAR,
    now: null,
    answering: false,
    status: status({}),
    ...overrides,
  };
}

const THINKING: TurnHeaderActivity = {
  kind: "thinking",
  key: "thought:r9",
  messages: [
    said(
      "r9",
      "reasoning",
      "The test fails with 503, so the database didn't answer inside the test. The test database isn't seeded in CI — the pool connects to nothing and the route says \"down\", which is right. The test should start the database the same way the other route tests do, with the shared fixture, rather than the route learning to lie about it.\n\nThe users tests already do this with `withDatabase()`: it starts a throwaway database, runs the migrations and hands the pool to the test. Reusing it keeps one way of starting a database in the suite.\n\nThe catch is time: every test file that calls it pays for a migration run, about two seconds. Four files use it today; a fifth is fine, but the fixture should cache the migrated template if this grows.\n\nI'll reuse `withDatabase()` from the users tests, run the suite again, and only then deploy.",
      9,
      true,
    ),
  ],
};

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
};

const WORKING: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: null,
  workingStepLabel: null,
  stoppingBackgroundWork: false,
};

/** A run's card as the conversation draws it: its slices on the tray, its bottom edge a slice of its own. */
function Card({ children }: { readonly children: ReactNode }) {
  return (
    <div>
      <div className="run-tray run-tray-top">{children}</div>
      <div className="run-tray run-tray-bottom" />
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
      <div className="mx-auto grid w-full max-w-3xl gap-10">
        <State
          label="Thinking"
          note="The thought it is thinking, whole, beside its face; the bubbles before it folded where long."
        >
          <Card>
            <RunChat row={record({ now: THINKING })} />
          </Card>
        </State>
        <State
          label="Doing, with work alongside"
          note="The call it is making, its clock in the busy blue; the bars under the chat."
        >
          <Card>
            <RunChat row={record({ now: RUNNING_STEP })} />
            <ConversationWorking
              dock={BUSY_DOCK}
              environmentId={null}
              incidents={[]}
              onOpenAgents={() => undefined}
              threadRef={null}
            />
          </Card>
        </State>
        <State label="Waiting for you" note="A question stops the clock; its face waits.">
          <Card>
            <RunChat
              row={record({ now: { kind: "waiting" }, status: status({ waitingSince: ago(30) }) })}
            />
          </Card>
        </State>
        <State label="Writing" note="Words on their way, not placed yet.">
          <Card>
            <RunChat row={record({ now: { kind: "writing" } })} />
          </Card>
        </State>
        <State
          label="Finished"
          note="The chat stays, in the same scroll; the result under it, its pills opening in place."
        >
          <Card>
            <RunChat
              row={record({
                live: false,
                status: status({ live: false, face: "produced", endedAt: ago(2) }),
              })}
            />
            <div className="-mx-4 border-border/60 border-t px-4 pt-2.5">
              <TurnReport
                onOpenImage={() => undefined}
                onOpenTurnDiff={() => undefined}
                outcome={REPORT_WITH_ACTIVITY}
              />
            </div>
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
      </div>
    </div>
  );
}

/** The panel's deploy bars read the platform's pipeline: stand-ins that answer nothing. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    services: new Map(),
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    account: { kind: "authorized" },
    lost: new Set(),
  };
  const data: ZeropsDataContextValue = {
    // The markdown's commands ask the account's grant what they may do: a
    // grant that never answers, since nothing here is run.
    runtime: { access: { changes: Stream.empty } } as unknown as ManagedZeropsDataRuntime,
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
