/**
 * The Mate at work in every state it reaches, and the report it settles into.
 *
 * Served by the dev server at `/design-working.html` (`?theme=dark` for the
 * dark theme). The panel takes what it shows as props — the conversation's
 * rows hold the reads — so a batch deploy, a question that waits, a failure
 * that came back and a helper still at it all stand side by side without a
 * Mate doing any of them.
 *
 * Fixtures only. Nothing here ships — `design-working.html` is not
 * `index.html`, and no route imports this module.
 */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";

import {
  ConversationAfterWork,
  ConversationWorking,
  type WorkingActivity,
  type WorkingBubble,
} from "~/components/chat/ConversationWorking";
import type { ConversationSpeaker } from "~/components/chat/ConversationRows";
import { splitBatchDeploy, type OutcomeModel } from "~/components/chat/conversation.logic";
import type { DockModel } from "~/components/chat/conversationDock.logic";
import { TurnReport } from "~/components/chat/TurnReport";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import "../index.css";

const SPEAKER: ConversationSpeaker = { name: "Nova", tint: "sky" };
const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

const note = (key: string, words: string): WorkingBubble => ({
  kind: "note",
  key,
  body: <p className="text-sm leading-relaxed">{words}</p>,
});

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
};

function Working({
  bubbles,
  activity,
  dock = EMPTY_DOCK,
}: {
  readonly bubbles: ReadonlyArray<WorkingBubble>;
  readonly activity: WorkingActivity | null;
  readonly dock?: DockModel;
}) {
  return (
    <ConversationWorking
      activity={activity}
      browser={null}
      bubbles={bubbles}
      dock={dock}
      environmentId={null}
      incidents={[]}
      onOpenAgents={() => undefined}
      speaker={SPEAKER}
      threadRef={null}
    />
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

function Harness() {
  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto grid w-full max-w-3xl gap-10">
        <State label="Thinking" note="Nothing said yet: the dots beside the face.">
          <Working activity={{ kind: "thinking" }} bubbles={[]} />
        </State>
        <State
          label="Doing"
          note="Its words above, what its hands are on under the newest — never the call's arguments."
        >
          <Working
            activity={{ kind: "doing", words: "Reading package.json" }}
            bubbles={[
              note("a1", "Reading the package manifest first."),
              note("a2", "A small web app with a server; checking the server next."),
            ]}
          />
        </State>
        <State
          label="Waiting for the person"
          note="Its question is its newest bubble; the amber says who is next."
        >
          <Working
            activity={{ kind: "waiting" }}
            bubbles={[
              note("a1", "One question before the long part."),
              { kind: "question", key: "q1", questions: ["Shall I go on?"] },
            ]}
          />
        </State>
        <State
          label="A failure, and one that came back"
          note="Red where it failed; amber once a later attempt passed."
        >
          <Working
            activity={{ kind: "doing", words: "Running pnpm" }}
            bubbles={[
              {
                kind: "failure",
                key: "f1",
                failure: {
                  subject: null,
                  words: "Run the type check failed",
                  recovered: "then passed",
                },
              },
              note("a1", "Fixed the types; re-running the checks."),
              {
                kind: "failure",
                key: "f2",
                failure: { subject: "appdev", words: "Unhealthy", recovered: null },
              },
            ]}
          />
        </State>
        <State
          label="Everything running at once"
          note="A batch deploy is a bar per service; helpers and background tasks their own."
        >
          <Working
            activity={null}
            bubbles={[note("a1", "Deploying both stages together, then the smoke tests.")]}
            dock={BUSY_DOCK}
          />
        </State>
        <State
          label="Settled bars, before the report"
          note="A deploy that landed is whole; a batch service that failed stops where it failed."
        >
          <Working
            activity={{ kind: "thinking" }}
            bubbles={[note("a1", "apistage is live; webstage failed its build.")]}
            dock={SETTLED_DOCK}
          />
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
        <State label="The report" note="What the turn left, each service once.">
          <TurnReport
            onOpenImage={() => undefined}
            onOpenTurnDiff={() => undefined}
            outcome={REPORT}
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
// harness does the same rather than nesting a `.dark` wrapper the tokens never reach.
document.documentElement.classList.toggle(
  "dark",
  new URLSearchParams(location.search).get("theme") === "dark",
);

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
