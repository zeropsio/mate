/**
 * A run's card in every state it reaches: its heading, its record in one
 * scroll with the Mate's face beside what it is on, what runs alongside it,
 * and the result it settles into.
 *
 * Served by the dev server at `/design-working.html` (`?theme=dark` for the
 * dark theme). The card's parts take what they show as props, so a batch
 * deploy, a question that waits and a helper still at it all stand side by
 * side without a Mate doing any of them.
 *
 * Fixtures only. Nothing here ships — `design-working.html` is not
 * `index.html`, and no route imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";

import { ConversationAfterWork, ConversationWorking } from "~/components/chat/ConversationWorking";
import {
  ElapsedSince,
  WorkLine,
  type ConversationSpeaker,
} from "~/components/chat/ConversationRows";
import {
  activityPills,
  splitBatchDeploy,
  type OutcomeModel,
} from "~/components/chat/conversation.logic";
import type { DockModel } from "~/components/chat/conversationDock.logic";
import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import {
  MATE_NOTE_CLASS,
  RECORD_GUTTER,
  RECORD_TEXT_INSET,
  RecordLine,
  RecordScroll,
  ThoughtTail,
  TIME_COLUMN,
  TypingDots,
} from "~/components/chat/RunRecord";
import { BrowserStrip } from "~/components/chat/BrowserStrip";
import { TurnReport } from "~/components/chat/TurnReport";
import { MateFace } from "~/components/zerops/primitives";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import "../index.css";

const SPEAKER: ConversationSpeaker = { name: "Nova", tint: "sky" };
const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

type WorkLineRow = Extract<MessagesTimelineRow, { kind: "work-line" }>;

function heading(overrides: Partial<WorkLineRow>): WorkLineRow {
  return {
    kind: "work-line",
    id: "work-line:turn-1",
    createdAt: ago(134),
    stretchKey: "turn-1",
    turnId: TurnId.make("turn-1"),
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
      recovered: null,
    },
    {
      hostname: "apistage",
      tone: "ok",
      word: "Deployed",
      version: null,
      url: null,
      recovered: null,
    },
    {
      hostname: "webstage",
      tone: "failed",
      word: "Failed",
      version: null,
      url: null,
      recovered: null,
    },
  ],
  landed: [],
  files: { count: 3, additions: 42, deletions: 7, turnId: TurnId.make("turn-1") },
  checks: { count: 5, views: 2, failures: 0, takes: [] },
  created: [],
  removed: [],
  notDone: [],
  activity: [],
};

/** The record's lines as the card draws them some way into a run. */
function RecordSoFar() {
  return (
    <>
      <RecordLine
        italic
        state="done"
        time="6s"
        words="The readiness check asks for /status, but the router only registers /health."
      />
      <RecordLine
        code="grep -rn status src/routes.ts"
        state="done"
        time="1s"
        words="Find where the route is registered"
      />
      <div className={`${RECORD_TEXT_INSET} py-1`}>
        <div className={MATE_NOTE_CLASS}>
          <p className="text-sm leading-relaxed">
            Found it: the check and the route disagree on the path.
          </p>
        </div>
      </div>
      <RecordLine state="done" suffix="2 edits" words="Edited routes.ts and status.test.ts" />
      <RecordLine
        detail="Review the copy · Check accessibility · Write a test"
        state="running"
        words="Started 3 helpers"
      />
      <RecordLine code="npm run build" state="done" time="24s" words="Run the production build" />
      <RecordLine detail="v0.1.1" state="done" time="1m 12s" words="Deployed appdev" />
      <RecordLine
        code="npm test -- status"
        state="failed"
        time="6s"
        words="Run the tests for the page"
      />
      <RecordLine
        detail="in the background"
        state="done"
        words="Watch the pull request's checks finished"
      />
    </>
  );
}

function Face({ state = "working" }: { readonly state?: "working" | "needs" }) {
  return (
    <span className={RECORD_GUTTER}>
      <MateFace size="md" state={state} tint={SPEAKER.tint} />
    </span>
  );
}

/** A run's card: its heading, its record, what runs alongside, its result. */
function Card({ children }: { readonly children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card px-4 pt-2 pb-3">{children}</div>
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
    <section className="grid gap-2">
      <div>
        <h2 className="font-medium text-foreground text-sm">{label}</h2>
        <p className="text-muted-foreground text-xs">{caption}</p>
      </div>
      {/* The conversation's column: 768 px, the Mate's side inset by its gutter. */}
      <div className="ps-5">{children}</div>
    </section>
  );
}

// Its edits are the files pill's: the report's own diff counts them.
const REPORT_WITH_ACTIVITY: OutcomeModel = {
  ...REPORT,
  activity: activityPills(
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
          note="The record so far; the thought it is thinking beside its face."
        >
          <Card>
            <WorkLine row={heading({})} speaker={SPEAKER} timestampFormat="24-hour" />
            <RecordScroll live>
              <RecordSoFar />
              <div className="flex min-w-0 items-end gap-2.5 py-0.5">
                <Face />
                <div className="min-w-0 flex-1">
                  <ThoughtTail>
                    <p className="text-line text-muted-foreground italic">
                      If the deploy passes, the check should turn healthy within a minute. The route
                      and the config now agree, so the next thing is the smoke tests on the stage
                      and a screenshot of the page on a phone.
                    </p>
                  </ThoughtTail>
                </div>
                <span className={TIME_COLUMN}>
                  <ElapsedSince since={ago(9)} />
                </span>
              </div>
            </RecordScroll>
          </Card>
        </State>
        <State
          label="Doing, with work alongside"
          note="The call it is making beside its face; the bars under the record."
        >
          <Card>
            <WorkLine row={heading({})} speaker={SPEAKER} timestampFormat="24-hour" />
            <RecordScroll live>
              <RecordSoFar />
              <div className="py-0.5">
                <RecordLine
                  code="npm run lint"
                  mark={<Face />}
                  state="running"
                  time={<ElapsedSince since={ago(4)} />}
                  words="Lint the page"
                />
              </div>
            </RecordScroll>
            <ConversationWorking
              browser={null}
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
            <WorkLine
              row={heading({ waitingSince: ago(30) })}
              speaker={SPEAKER}
              timestampFormat="24-hour"
            />
            <RecordScroll live>
              <RecordSoFar />
              <div className="flex min-h-9 min-w-0 items-center gap-2.5 text-line">
                <Face state="needs" />
                <span className="text-status-attention-text">Waiting for your answer</span>
              </div>
            </RecordScroll>
          </Card>
        </State>
        <State label="Writing" note="Words on their way, not placed yet.">
          <Card>
            <WorkLine row={heading({})} speaker={SPEAKER} timestampFormat="24-hour" />
            <RecordScroll live>
              <RecordSoFar />
              <div className="flex min-h-9 min-w-0 items-center gap-2.5 text-line">
                <Face />
                <span className="flex h-8 items-center rounded-2xl rounded-es-md bg-foreground/8 px-3.5">
                  <TypingDots />
                </span>
              </div>
            </RecordScroll>
          </Card>
        </State>
        <State label="Finished" note="The record stays, in the same scroll; the result under it.">
          <Card>
            <WorkLine
              row={heading({ live: false, face: "produced", endedAt: ago(2) })}
              speaker={SPEAKER}
              timestampFormat="24-hour"
            />
            <RecordScroll live={false}>
              <RecordSoFar />
            </RecordScroll>
            <TurnReport
              onOpenActivity={() => undefined}
              onOpenImage={() => undefined}
              onOpenTurnDiff={() => undefined}
              outcome={REPORT_WITH_ACTIVITY}
            />
          </Card>
        </State>
        <State
          label="Settled bars"
          note="A deploy that landed and a batch that failed, as the bars say it."
        >
          <Card>
            <ConversationWorking
              browser={null}
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
    runtime: {} as ManagedZeropsDataRuntime,
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
        <Harness />
      </Standins>
    </StrictMode>,
  );
}
