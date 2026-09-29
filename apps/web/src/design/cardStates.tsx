/**
 * The run's card in the states pass 16's plan draws it, on the plan's own run
 * — Nova building a /status page: the now line in each of its states (a step,
 * a long step, several at once, thinking, waiting on the person, writing),
 * the run finished while the person watched, the same run come back to —
 * closed, and opened — and a failure that still stands beside one a retry
 * undid. Each card is drawn as the conversation draws it: its record on the
 * tray's top, its result in the band under the now line, its bottom edge.
 *
 * Fixtures only: the run, its hosts and its words are invented.
 */
import { MessageId, TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { useState, type ReactNode } from "react";

import {
  checksStrip,
  type OutcomeLater,
  type OutcomeModel,
  type OutcomeService,
} from "~/components/chat/conversation.logic";
import type {
  MessagesTimelineRow,
  RecordItem,
  RunStatus,
  TurnHeaderActivity,
} from "~/components/chat/MessagesTimeline.logic";
import { setRunFold } from "~/components/chat/runCard.logic";
import type { ResultFacts } from "~/components/chat/runResult.logic";
import { RunChat } from "~/components/chat/RunChat";
import { TurnReport } from "~/components/chat/TurnReport";
import { Button } from "~/components/ui/button";
import { foldSteps, stepOf } from "~/components/chat/workSteps.logic";
import type { WorkLogEntry } from "~/session-logic";
import type { ChatMessage } from "~/types";

/** The harness's conversation (`SHARED.routeThreadKey`): the runs it watched or opened. */
const CONVERSATION = "harness";

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();
const TURN = TurnId.make("status-run");

const ASK = "Add a /status page that lists the app's uptime and its last deploy.";

function said(id: string, role: "assistant" | "reasoning", text: string, at: number): ChatMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId: TURN,
    streaming: false,
    createdAt: ago(at),
    updatedAt: ago(at),
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

/** A command it ran, `took` seconds long, ending `at` seconds ago. */
function command(
  id: string,
  text: string,
  description: string | null,
  at: number,
  took: number,
  extra: Partial<WorkLogEntry> = {},
): WorkLogEntry {
  return call({
    id,
    label: "Command run",
    itemType: "command_execution",
    command: text,
    ...(description === null ? {} : { callInput: { description } }),
    startedAt: ago(at + took),
    createdAt: ago(at + took),
    updatedAt: ago(at),
    ...extra,
  });
}

const read = (id: string, file: string, at: number) =>
  call({ id, detail: `Read: {"file_path":"/var/www/app/src/${file}"}`, createdAt: ago(at) });

const step = (entry: WorkLogEntry, at: number): RecordItem => ({
  kind: "step",
  key: `step:${entry.id}`,
  at: ago(at),
  step: stepOf(entry, undefined, false),
});

const edits = foldSteps(
  [
    call({
      id: "e2",
      itemType: "file_change",
      label: "File change",
      detail: 'Edit: {"file_path":"/var/www/app/src/index.ts"}',
      createdAt: ago(47),
    }),
    call({
      id: "e3",
      itemType: "file_change",
      label: "File change",
      detail: 'Edit: {"file_path":"/var/www/app/.nvmrc"}',
      createdAt: ago(46),
    }),
  ],
  undefined,
  false,
)[0]!;

const APPDEV = "https://appdev-1f3c-3000.prg1.example.app";

/** The page it checked in the browser, taken 5 s long. */
const CHECK: ZeropsOperation = {
  key: "op:status-check",
  kind: "browser",
  phase: "done",
  anchorAt: ago(11),
  anchorActivityId: "status-check",
  settledAt: ago(6),
  turnId: "status-run",
  subject: `${APPDEV}/status`,
  kicker: `Browser · ${APPDEV}/status`,
  voice: `Checking ${APPDEV}/status`,
  voiceSource: "mate",
  statusWord: "Checked",
  steps: [],
  links: [],
  callIds: ["status-check"],
  hasResult: true,
};

/** What the build printed: past twelve lines, its output folds. */
const BUILD_LOG = [
  "> app@0.2.0 build /var/www/app",
  "> tsc -p . && vite build",
  "",
  "vite v7.1.3 building for production...",
  ...Array.from({ length: 22 }, (_, index) => `✓ src/routes/module-${index + 1}.ts transformed`),
  "dist/index.html    0.46 kB",
  "dist/assets/index.js  48.20 kB │ gzip: 15.12 kB",
  "✓ built in 3.41s",
].join("\n");

/** Everything the /status run said and did, in order. */
const RUN: ReadonlyArray<RecordItem> = [
  {
    kind: "thought",
    key: "thought:r1",
    at: ago(78),
    messages: [
      said(
        "r1",
        "reasoning",
        "The admin pages all render on the server, so the status page joins them as one more route behind the same sign-in.",
        78,
      ),
    ],
    durationMs: 3000,
  },
  step(read("w1", "index.ts", 74), 74),
  step(command("w2", "node --version", "Check the Node version", 73, 1), 73),
  {
    kind: "question",
    key: "question:q1",
    at: ago(72),
    questions: ["Should /status be reachable without signing in?"],
  },
  {
    kind: "person",
    key: "person:a1",
    at: ago(54),
    words: "Yes, but show no secrets",
    imageOnly: false,
  },
  step(
    call({
      id: "e1",
      itemType: "file_change",
      label: "File change",
      detail: 'Write: {"file_path":"/var/www/app/src/status.ts"}',
      createdAt: ago(50),
    }),
    50,
  ),
  { kind: "step", key: "step:e2", at: ago(46), step: edits },
  {
    kind: "note",
    key: "note:n1",
    at: ago(45),
    message: said(
      "n1",
      "assistant",
      "The build needs Node 22, so I moved .nvmrc from 20 to 22.",
      45,
    ),
  },
  step(
    command("w3", "cd /var/www/app && pnpm build", "Build the app", 11, 34, { detail: BUILD_LOG }),
    11,
  ),
  {
    kind: "strip",
    key: "operation:op:status-check",
    at: ago(6),
    strip: checksStrip([CHECK], false),
  },
];

/** The run up to the item keyed `key`, not including it. */
const upTo = (key: string) =>
  RUN.slice(
    0,
    RUN.findIndex((item) => item.key === key),
  );

function status(overrides: Partial<RunStatus>): RunStatus {
  return {
    live: true,
    face: "working",
    startedAt: ago(80),
    endedAt: null,
    waitedMs: 0,
    waitingSince: null,
    worked: true,
    ...overrides,
  };
}

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

function record(turnKey: string, overrides: Partial<RecordRow>): RecordRow {
  return {
    kind: "record",
    id: `record:${turnKey}`,
    createdAt: ago(80),
    turnKey,
    live: true,
    items: RUN,
    now: null,
    answering: false,
    status: status({}),
    outcome: null,
    ...overrides,
  };
}

const running = (entry: WorkLogEntry): WorkLogEntry => ({
  ...entry,
  toolLifecycleStatus: "inProgress",
  sourceActivityKind: "tool.updated",
  updatedAt: undefined as never,
});

const NOTHING_LATER: OutcomeLater = {
  services: [],
  changes: [],
  tasks: [],
  pages: [],
  files: [],
  answered: false,
};

const APPDEV_RUNNING: OutcomeService = {
  hostname: "appdev",
  tone: "ok",
  word: "Dev server running",
  version: null,
  url: APPDEV,
  at: ago(6),
  failure: null,
};

/** What the /status run came to: its change waiting for review, appdev running with /status checked. */
const OUTCOME: OutcomeModel = {
  key: "outcome:status-run",
  turnKey: "status-run",
  live: [APPDEV_RUNNING],
  landed: [],
  files: { count: 3, additions: 42, deletions: 3, turnId: TURN },
  checks: { count: 1, views: 1, failures: 0, takes: [CHECK] },
  pictures: [],
  created: [],
  notDone: [],
  planLeft: [],
  change: { repository: "app", number: 2 },
  crewTask: null,
  activity: [
    { kind: "edit", count: 3 },
    { kind: "command", count: 2 },
    { kind: "read", count: 1 },
  ],
  later: NOTHING_LATER,
};

/** The facts its result follows now: #2 still open, appdev up. */
const FACTS: ResultFacts = {
  changes: {
    groupId: "group-snap",
    open: [{ repository: "app", number: 2, title: "Add a /status page" }],
    merged: [],
    known: true,
  },
};

/** The run as the conversation draws it: the person's words, the card's slices, the answer. */
function Turn({
  row,
  result = false,
  answer = null,
}: {
  readonly row: RecordRow;
  /** Its result, in the band under its worked line. */
  readonly result?: boolean;
  readonly answer?: string | null;
}) {
  return (
    <div className="grid gap-6">
      <p className="ms-auto max-w-4/5 rounded-2xl bg-message px-3.5 py-2.5 text-message-foreground text-prose">
        {ASK}
      </p>
      <div>
        <div className="run-tray run-tray-top">
          <RunChat row={row} />
        </div>
        {result ? (
          <div className="run-tray run-tray-middle pt-1">
            <div className="run-band">
              <TurnReport
                facts={FACTS}
                onOpenImage={() => undefined}
                onOpenTurnDiff={() => undefined}
                outcome={OUTCOME}
              />
            </div>
          </div>
        ) : null}
        <div className="run-tray run-tray-bottom" />
      </div>
      {answer === null ? null : <p className="px-4 text-foreground text-prose">{answer}</p>}
    </div>
  );
}

function CardState({
  label,
  note,
  children,
}: {
  readonly label: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-3" data-harness-state={label}>
      <div>
        <h2 className="font-medium text-foreground text-sm">{label}</h2>
        <p className="text-muted-foreground text-xs">{note}</p>
      </div>
      {children}
    </section>
  );
}

const ANSWER =
  "The /status page is live on appdev: it lists the uptime and the last deploy, and it sits behind the sign-in like the other admin pages.";

const settled = status({ live: false, face: "produced", endedAt: ago(0), waitedMs: 18_000 });

const THINKING: TurnHeaderActivity = {
  kind: "thinking",
  key: "thought:r9",
  messages: [
    {
      ...said(
        "r9",
        "reasoning",
        "The admin pages all render on the server. So the status page joins them as one more route behind the same sign-in",
        2,
      ),
      streaming: true,
    },
  ],
};

// A run come back to is closed to its summary line, and opened once they ask
// for the work.
setRunFold(CONVERSATION, "status-shown", "shown");

/**
 * A run the person watches to its end: it writes its answer until End the
 * run, then its work folds into its line as its result arrives under it.
 * Run it again starts it over.
 */
function WatchedToItsEnd() {
  const [round, setRound] = useState(0);
  const [ended, setEnded] = useState(false);
  const run = `status-watched-${round}`;
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <Button data-harness-end disabled={ended} onClick={() => setEnded(true)} size="sm">
          End the run
        </Button>
        <Button
          data-harness-again
          onClick={() => {
            setEnded(false);
            setRound((value) => value + 1);
          }}
          size="sm"
          variant="outline"
        >
          Run it again
        </Button>
      </div>
      <Turn
        answer={ANSWER}
        result={ended}
        row={
          ended
            ? record(run, { live: false, status: settled, outcome: OUTCOME })
            : record(run, { answering: true })
        }
      />
    </div>
  );
}

/** A command longer than its line: a route written with a heredoc. */
const ROUTE_SCRIPT = [
  "cat > src/routes/status.ts <<'EOF'",
  'import { Hono } from "hono";',
  "",
  'export const status = new Hono().get("/status", (c) =>',
  "  c.html(`<p>${process.version} · ${new Date().toISOString()}</p>`),",
  ");",
  "EOF",
].join("\n");

const FAILED = command("f1", "npm test -- status", "Run the tests for the page", 30, 6, {
  toolLifecycleStatus: "failed",
  detail:
    "FAIL src/status.test.ts\n  ✕ answers 200 with the build number\n    Expected: 200\n    Received: 503",
});
const RETRIED = command("f2", "npm test -- status", "Run the tests for the page", 12, 7);

export function CardStates() {
  return (
    <>
      <CardState
        label="Thinking"
        note="Thinking, and the latest of its thought on the same line; the face looks up."
      >
        <Turn row={record("status-thinking", { items: upTo("step:w1"), now: THINKING })} />
      </CardState>
      <CardState
        label="Running a step"
        note="The step itself on the now line, sweeping; it lands in the chat above once it ends."
      >
        <Turn
          row={record("status-reading", {
            items: upTo("step:w1"),
            now: { kind: "step", step: stepOf(running(read("w1", "index.ts", 74))) },
          })}
        />
      </CardState>
      <CardState
        label="A long step"
        note="Past 30 s the step says how long in words on its line; the run keeps its one clock."
      >
        <Turn
          row={record("status-building", {
            items: upTo("step:w3"),
            now: {
              kind: "step",
              step: stepOf(
                running(command("w3", "cd /var/www/app && pnpm build", "Build the app", 0, 31)),
              ),
            },
            status: status({ startedAt: ago(66) }),
          })}
        />
      </CardState>
      <CardState
        label="A whole command"
        note="A command longer than its line: a click on the line shows every line of it in place; the run keeps its one clock."
      >
        <Turn
          row={record("status-writing", {
            items: upTo("step:w3"),
            now: {
              kind: "step",
              step: stepOf(running(command("w5", ROUTE_SCRIPT, "Write the status route", 0, 3))),
            },
          })}
        />
      </CardState>
      <CardState
        label="Several at once"
        note="How many, and a line each under it; each lands in the chat as it ends."
      >
        <Turn
          row={record("status-several", {
            items: upTo("step:w3"),
            now: {
              kind: "step",
              step: stepOf(running(command("s3", "pnpm lint", null, 0, 4))),
              others: [
                stepOf(running(command("s1", "pnpm build", "Build the app", 0, 9))),
                stepOf(running(command("s2", "pnpm test -- status", null, 0, 8))),
              ],
            },
          })}
        />
      </CardState>
      <CardState
        label="Waiting for you"
        note="Its question in the chat, in its tint; the now line waits, its clock standing still."
      >
        <Turn
          row={record("status-waiting", {
            items: upTo("person:a1"),
            now: { kind: "waiting", on: "answer" },
            status: status({ waitingSince: ago(58) }),
          })}
        />
      </CardState>
      <CardState label="Writing" note="Its answer on its way, under the card.">
        <Turn row={record("status-writing", { answering: true })} />
      </CardState>
      <CardState
        label="Finished while you watch"
        note="As the run ends its work folds into the line, which keeps its place; the result stands under it."
      >
        <WatchedToItsEnd />
      </CardState>
      <CardState
        label="You come back later"
        note="Closed: the summary line alone, with Show work; the result stands under it."
      >
        <Turn
          answer={ANSWER}
          result
          row={record("status-folded", { live: false, status: settled, outcome: OUTCOME })}
        />
      </CardState>
      <CardState
        label="Show work, opened"
        note="The whole run opens in its scroll under the line clicked; Hide work closes it again."
      >
        <Turn
          result
          row={record("status-shown", { live: false, status: settled, outcome: OUTCOME })}
        />
      </CardState>
      <CardState
        label="A failure that stands"
        note="A red mark and Failed on the right edge, never a pink row."
      >
        <Turn
          row={record("status-failed", {
            items: [...upTo("step:w3"), step(FAILED, 30)],
            now: null,
            status: status({ startedAt: ago(40) }),
          })}
        />
      </CardState>
      <CardState
        label="A failure a retry undid"
        note="The same command passed on its retry: the failure turns quiet."
      >
        <Turn
          row={record("status-retried", {
            items: [...upTo("step:w3"), step(FAILED, 30), step(RETRIED, 12)],
            now: null,
            status: status({ startedAt: ago(40) }),
          })}
        />
      </CardState>
    </>
  );
}
