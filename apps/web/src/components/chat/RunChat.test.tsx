import { RegistryContext } from "@effect/atom-react";
import { useEngineCardSnapshots } from "../../zerops/useEngineCardPaging";
import { useEngineLiveStructure } from "../../zerops/useEngineLiveMessage";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import {
  cardAccount,
  CARD_KEY,
  CARD_RUN,
  CARD_THREAD,
  CARD_RECORDS,
  useCardTimelineInput,
} from "./engineCard.test-fixtures";
import { assembleRecordCard } from "./MessagesTimeline.logic";
import { markupDom } from "../../../test/markupDom";
import { ApprovalRequestId, EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  emptyAgentPanelModel,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { act, StrictMode, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { foldsLikeAMessage, RunChat } from "./RunChat";
import { MateFace } from "../zerops/primitives";
import { useHelperFocus } from "./helperFocus";
import { SLOT_HOLD_MS, SLOT_MIN_SHOW_MS } from "./liveSlot.logic";
import { forgetRunFolds, setRunFold } from "./runCard.logic";
import { foldWork } from "./foldWork";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";
import { checksStrip, formatWorkDuration, type OutcomeModel } from "./conversation.logic";
import { operation } from "./conversationFixtures";
import { stepOf } from "./workSteps.logic";

// An operation in the live slot reads the platform through its card's hook;
// the account store it reads is not drawn here, so it reads nothing.
vi.mock("../../zerops/activity/useOperationCard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../zerops/activity/useOperationCard")>()),
  useOperationCard: () => ({}),
}));

// Measured execution is held until the test supplies its completion receipt.
vi.mock("./foldWork", () => ({ foldWork: vi.fn(() => () => undefined) }));

const at = (second: number) => new Date(Date.UTC(2026, 8, 27, 10, 0, second)).toISOString();
const turnId = TurnId.make("turn-1");

const SHARED: TimelineRowSharedState = {
  timestampFormat: "24-hour",
  routeThreadKey: "environment-local:thread-1",
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
  speaker: { name: "Nova", tint: "sky" },
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

const ACTIVITY: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  latestTurnId: null,
  workingStepLabel: null,
  stoppingBackgroundWork: false,
};

function Rows({ children }: { readonly children: ReactNode }) {
  return (
    <TimelineRowCtx value={SHARED}>
      <TimelineRowActivityCtx value={ACTIVITY}>{children}</TimelineRowActivityCtx>
    </TimelineRowCtx>
  );
}

function message(id: string, role: "assistant" | "reasoning", text: string): ChatMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId,
    streaming: false,
    createdAt: at(1),
    updatedAt: at(1),
  };
}

function command(id: string, text: string, extra: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id,
    createdAt: at(2),
    startedAt: at(2),
    updatedAt: at(9),
    label: "Command run",
    tone: "tool",
    itemType: "command_execution",
    command: text,
    sourceActivityKind: "tool.completed",
    toolLifecycleStatus: "completed",
    ...extra,
  };
}

/** A call that says no command: an edit, or a command whose input has not streamed in yet. */
function withoutCommand(entry: WorkLogEntry): WorkLogEntry {
  const { command: _command, ...rest } = entry;
  return rest;
}

const LONG = Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of what it thought.`).join(
  "\n",
);
/** A thought past its four lines at any width. */
const LONG_THOUGHT = Array.from(
  { length: 16 },
  (_, index) => `Line ${index + 1} of what it thought, and why it matters here.`,
).join("\n");
const SCRIPT = [
  "cat > status.ts <<'EOF'",
  ...Array.from({ length: 14 }, (_, i) => `line ${i}`),
  "EOF",
].join("\n");

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

function record(items: ReadonlyArray<RecordItem>, overrides: Partial<RecordRow> = {}): RecordRow {
  const row = {
    kind: "record" as const,
    id: "record:turn-1",
    createdAt: at(0),
    turnKey: "turn-1",
    live: false,
    items,
    now: null,
    answering: false,
    status: null,
    outcome: null,
    ...overrides,
  };
  return { ...row, ...assembleRecordCard(row) };
}

const thought = (id: string, text: string): RecordItem => ({
  kind: "thought",
  key: `thought:${id}`,
  at: at(1),
  messages: [message(id, "reasoning", text)],
  durationMs: 4000,
});

const questionItem: RecordItem = {
  kind: "question",
  key: "question:q1",
  at: at(2),
  questions: ["Which specification should I use?"],
};

const attachmentAnswer: RecordItem = {
  kind: "call",
  key: "call:answer",
  at: at(3),
  entry: command("answer", "", {
    questionAnswer: {
      requestId: ApprovalRequestId.make("q1"),
      answers: {},
      attachmentsByQuestionId: {
        q1: [{ type: "file", id: "spec", name: "spec.txt", mimeType: "text/plain", sizeBytes: 42 }],
      },
    },
  }),
};

const step = (entry: WorkLogEntry): RecordItem => ({
  kind: "step",
  key: `step:${entry.id}`,
  at: at(9),
  step: stepOf(entry, undefined, false),
});

/** What a run came to, by its calls alone: what its worked line counts. */
const outcomeOf = (activity: OutcomeModel["activity"]): OutcomeModel => ({
  key: "outcome:turn-1",
  turnKey: "turn-1",
  live: [],
  landed: [],
  files: null,
  checks: null,
  pictures: [],
  created: [],
  notDone: [],
  planLeft: [],
  change: null,
  crewTask: null,
  activity,
  later: { services: [], changes: [], tasks: [], pages: [], views: [], files: [], answered: false },
});

/** A run's status: live and working by default. */
const status = (overrides: Partial<RunStatus> = {}): RunStatus => ({
  live: true,
  face: "working",
  startedAt: at(0),
  endedAt: null,
  waitedMs: 0,
  waitingSince: null,
  worked: true,
  ...overrides,
});

const draw = (row: RecordRow) =>
  renderToStaticMarkup(
    <Rows>
      <RunChat row={row} />
    </Rows>,
  );

/** Each bubble's opening tag, in the chat's order. */
const bubbles = (markup: string) =>
  [
    ...markup.matchAll(/<div[^>]*data-chat-bubble="([^"]*)"[^>]*data-chat-kind="([^"]*)"[^>]*>/g),
  ].map(([tag, tone, kind]) => ({ tag, tone, kind }));

describe("foldsLikeAMessage", () => {
  it.each([
    { name: "a line", text: "Found it.", folds: false },
    { name: "eight lines", text: Array.from({ length: 8 }, () => "x").join("\n"), folds: false },
    { name: "nine lines", text: Array.from({ length: 9 }, () => "x").join("\n"), folds: true },
    { name: "600 characters", text: "x".repeat(600), folds: false },
    { name: "601 characters", text: "x".repeat(601), folds: true },
    { name: "nothing", text: "   ", folds: false },
  ])("$name: $folds — the person's own rule", ({ text, folds }) => {
    expect(foldsLikeAMessage(text)).toBe(folds);
  });
});

describe("RunChat", () => {
  // Each kind in its own voice (the owner, 2026-09-27: "different font style
  // / bubble color / special components depending on what kind of call it
  // is").
  it("draws each thing the Mate said or did in its own voice", () => {
    const markup = draw(
      record([
        thought("r1", "The route and the check disagree."),
        step(
          command("w1", "grep -rn status src", { callInput: { description: "Find the route" } }),
        ),
        {
          kind: "note",
          key: "note:a1",
          at: at(10),
          message: message("a1", "assistant", "Found it."),
        },
        step(command("w2", "npm test", { toolLifecycleStatus: "failed" })),
        {
          kind: "event",
          key: "event:c1",
          at: at(12),
          event: { type: "compaction", label: "Context compacted" },
        },
      ]),
    );
    expect(bubbles(markup).map(({ tone, kind }) => `${tone}:${kind}`)).toEqual([
      "thought:thought",
      "tool:step:command",
      "speech:note",
      "failed:step:command",
    ]);
    // What merely happened is no one's bubble: a caption across the chat.
    expect(markup).toMatch(/<div[^>]*data-chat-kind="event"[^>]*>/);
    expect(markup).toContain("Context condensed");
  });

  // Open, the card is one scroll holding everything the run said and did
  // (the owner, 2026-09-29: "open with scroll and all events"): the scroll is
  // the card's own, a region the keyboard reaches, and every line stands in it.
  it("holds the whole run in one scroll of its own", () => {
    const markup = draw(
      record([
        step(
          command("w1", "npm run build", {
            callInput: { description: "Build" },
            detail: Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"),
          }),
        ),
        thought("r1", LONG),
      ]),
    );
    const region = markupDom(markup).querySelector('[role="region"][aria-label="Nova\'s work"]');
    expect(region?.getAttribute("tabindex")).toBe("0");
    expect(region?.textContent).toContain("Build");
    expect(region?.textContent).toContain("Line 1 of what it thought.");
    const scroll = markup.slice(markup.indexOf("data-run-scroll"));
    expect(scroll).toContain("Build");
    expect(scroll).toContain("Line 1 of what it thought.");
  });

  it("gathers each run of calls into one card, and breaks it where anything else stands", () => {
    const markup = draw(
      record([
        step(command("w1", "ls")),
        step(command("w2", "cat package.json")),
        thought("r1", "The build script is missing."),
        step(command("w3", "npm run build")),
      ]),
    );
    const cards = markup.split("data-chat-calls").slice(1);
    expect(cards).toHaveLength(2);
    expect(cards[0]?.match(/data-chat-kind="step:command"/g)).toHaveLength(2);
    expect(cards[1]?.match(/data-chat-kind="step:command"/g)).toHaveLength(1);
    // A hairline between the calls of a card, not a gap.
  });

  // The now line is the card's foot, never a heading over it: its face, what
  // the Mate is doing in words, its one clock — the one face in the chat. The
  // face does what the words say: it looks up and aside while it thinks, down
  // along its line while it writes, and simply works otherwise.
  it.each([
    { name: "thinking", now: null, says: ">Thinking<", face: "working", gaze: "up" },
    {
      name: "writing",
      now: { kind: "writing" },
      says: ">Writing<",
      face: "working",
      gaze: "down",
    },
    {
      name: "waiting on the person",
      now: { kind: "waiting", on: "answer" },
      says: ">Waiting for your answer<",
      face: "needs",
      gaze: null,
    },
  ] as const)("says under its chat what the Mate is doing: $name", ({ now, says, face, gaze }) => {
    const markup = draw(record([thought("r1", "One.")], { live: true, now, status: status() }));
    expect(markup.match(/data-mate-face-state="[a-z]+"/g)).toEqual([
      `data-mate-face-state="${face}"`,
    ]);
    expect(markup.match(/data-mate-face-gaze="[a-z]+"/g)).toEqual(
      gaze === null ? null : [`data-mate-face-gaze="${gaze}"`],
    );
    // What it opened onto is simply there: only words that change while
    // watched rise in.
    expect(markup).not.toContain("data-run-now-change");
    expect(markup).toContain(says);
    // It stands under the chat, never in it.
    expect(markup.indexOf(says)).toBeGreaterThan(markup.lastIndexOf("data-chat-row"));
    // No bubble stands in for what the status line says.
    expect(markup).not.toContain('data-chat-kind="typing');
    expect(markup).not.toContain('data-chat-kind="waiting"');
  });

  // Finished, the now line becomes the worked line: who, how long, and what
  // the effort came to — the time in its words, no second clock.
  it("says who worked, how long and what it came to once the run is over", () => {
    const markup = draw(
      record([thought("r1", "One.")], {
        status: status({ live: false, face: "produced", endedAt: at(72) }),
        outcome: outcomeOf([
          { kind: "command", count: 2 },
          { kind: "read", count: 1 },
        ]),
      }),
    );
    expect(markupDom(markup).body.textContent).toContain("Nova worked 1m 12s");
    expect(markupDom(markup).body.textContent).toContain("2 commands · 1 file read");
    expect(markup).not.toContain("data-work-line-clock");
    expect(markup).toContain('data-mate-face-state="done"');
    expect(draw(record([thought("r1", "One.")]))).not.toContain("data-mate-face-state");
  });

  // A command's title says what it does (K4): with no description from the
  // agent — Codex never gives one — it is the command itself, in mono, out of
  // the shell the runtime ran it in; a script's other lines a click away.
  it("titles a command that said nothing of itself with the command, out of its shell", () => {
    const one = draw(
      record([
        step(
          command("w1", "cd /var/www/app && npm run build", {
            rawCommand: '/usr/bin/zsh -lc "cd /var/www/app && npm run build"',
          }),
        ),
      ]),
    );
    expect(one).not.toContain("Ran a command");
    expect(one).not.toContain("zsh");
    expect(markupDom(one).body.textContent).toContain("npm run build");
    expect(one.match(/npm run build/g)).toHaveLength(1);
    const script = draw(record([step(command("w2", SCRIPT))]));
    expect(markupDom(script).body.textContent).toContain("cat > status.ts <<'EOF'");
    // Its lines stand in its item's box, the rest a scroll away: no control.
    expect(script).toContain('data-capped="item"');
    expect(script).not.toContain("Show all");
  });

  // Failures belong to the work, and red always means still broken (K9): a
  // failed call wears a red mark and "Failed" on the right, never a pink row;
  // once a later step undid it — the same command passing on a retry — it
  // turns quiet.
  it("marks a failure red while it stands, and quiet once a retry passed", () => {
    const failed = command("w1", "npm test", { toolLifecycleStatus: "failed" });
    const alone = draw(record([step(failed)]));
    const standing = /data-chat-failed="broken"/u;
    expect(alone).toMatch(standing);

    expect(markupDom(alone).body.textContent).toContain("Failed");

    const retried = draw(
      record([step(failed), { ...step(command("w2", "npm test")), key: "step:w2", at: at(20) }]),
    );
    expect(retried).not.toMatch(standing);
    expect(retried).toContain('data-chat-failed="undone"');
  });

  // A question and the person's answer are a pair (K14): the question in the
  // Mate's tint with its face, the answer whole in the person's bubble 6 px
  // under it — not the 12 px between other lines.
  it("pairs the person's answer with the question above it, 6 px under it", () => {
    const markup = draw(
      record([
        {
          kind: "question",
          key: "question:q1",
          at: at(2),
          questions: ["Should /status be public?"],
        },
        {
          kind: "person",
          key: "person:a1",
          at: at(3),
          words: "Yes, but show no secrets — and keep /health for the load balancer",
          imageOnly: false,
        },
      ]),
    );
    expect(markup).toMatch(
      /data-chat-bubble="speech" data-chat-kind="question"><div[^>]*><div[^>]*data-capped="item"[^>]*><div[^>]*><p[^>]*>Should \/status be public\?</u,
    );
    // Its answer stands nowhere else: whole, never cut to a line.
    expect(markupDom(markup).querySelector('[data-chat-kind="person"]')?.textContent).toBe(
      "Yes, but show no secrets — and keep /health for the load balancer",
    );
  });

  // A screen reader hears the now line when its words change, never its
  // ticking parts: the thought's latest words, the long-step time.
  it("tells a screen reader the now line's words alone, as they change", () => {
    const markup = draw(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "thinking",
          key: "thought:r9",
          messages: [message("r9", "reasoning", "The build needs Node 22. So I bump it")],
        },
      }),
    );
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markupDom(markup).querySelector('[role="status"]')?.textContent).toBe("Thinking");
  });

  // Several at once (pass 35): a row each in the live slot, three at most,
  // then how many more run.
  it("draws several steps at once as a row each, three at most, then how many more", () => {
    const runningCommand = (id: string, text: string) =>
      stepOf(
        command(id, text, { toolLifecycleStatus: "inProgress", updatedAt: undefined as never }),
      );
    const markup = draw(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "step",
          step: runningCommand("w4", "pnpm typecheck"),
          others: [
            { kind: "step", step: runningCommand("w1", "pnpm build") },
            { kind: "step", step: runningCommand("w2", "pnpm test") },
            { kind: "step", step: runningCommand("w3", "pnpm lint") },
          ],
        },
      }),
    );
    expect(bubbles(markup).map(({ kind }) => kind)).toEqual([
      "step:command",
      "step:command",
      "step:command",
    ]);
    expect(markup).toContain(">+1 more running<");
    // Each one running sweeps; none wears a chevron or a time of its own.
    expect(markup.match(/data-run-shimmer/g)).toHaveLength(3);
    expect(markup).not.toContain("data-chat-disclose");
  });

  // Blue means something to click (S3): the run's clock counts in ink, and a
  // call running beside it counts in the calls' quiet ink.
  // One ticking time for each thing that runs (K3): a command left running in
  // the background ticks in its bar, never again in the chat; a deploy ticks
  // in its bar, never again as the now line's long-step words.
  it("ticks each running thing once: the run's one clock, never a step's own (K3)", () => {
    const background: RecordItem = {
      kind: "step",
      key: "step:w1",
      at: at(9),
      step: stepOf(
        command("w1", "pnpm dev", {
          callInput: { description: "Serve the app on port 3000" },
          toolLifecycleStatus: "inProgress",
          updatedAt: undefined as never,
        }),
      ),
    };
    const serving = draw(record([background], { live: true, status: status() }));

    expect(markupDom(serving).body.textContent).toContain("Running");
    expect(
      markupDom(serving).querySelector('[data-chat-kind="step:command"]')?.textContent,
    ).not.toMatch(/\d+:\d\d/u);
    const since = new Date(Date.now() - 45_000).toISOString();
    const running = (kind: "deploy" | "browser") => {
      const entry = operation("o1", "turn-1", 1, {
        kind,
        phase: "running",
        anchorAt: since,
        subject: kind === "deploy" ? "appdev" : "https://shop.dev/status",
        voice: kind === "deploy" ? "Deploying appdev." : "Checking /status",
      });
      if (entry.kind !== "operation") throw new Error("an operation");
      const { settledAt: _settled, ...taking } = entry.operation;
      return draw(
        record([], { live: true, now: { kind: "operation", operation: taking }, status: status() }),
      );
    };
    // A step past 30 s still says what runs, with no clock of its own beside the run's.
    for (const kind of ["deploy", "browser"] as const) {
      expect(running(kind)).not.toMatch(/· 0:4\d/u);
    }
    expect(running("browser")).toMatch(/Checking [^<]*in the browser/u);
  });

  it("counts the run's time in ink, never in the busy blue", () => {
    const markup = draw(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "step",
          step: stepOf(
            command("w9", "npm run lint", {
              toolLifecycleStatus: "inProgress",
              updatedAt: undefined as never,
            }),
          ),
        },
      }),
    );
    // One clock (K3), m:ss, in ink: the step's own time is words on its line.
    expect(markup.match(/data-work-line-clock/g)).toHaveLength(1);
    expect(markupDom(markup).querySelector("[data-work-line-clock]")?.textContent).toMatch(
      /^(?:\d+:)?\d+:\d\d$/u,
    );
  });

  // One box for every item (run 11): a thought, a note, a command's code —
  // at most four of the card's lines, the rest scrolling inside it, live and
  // in the history alike. No toggle, and a thought keeps its one size.
  it("stands every item in its box, with nothing to open", () => {
    const markup = draw(
      record([
        thought("r1", LONG_THOUGHT),
        thought("r2", "Short."),
        { kind: "note", key: "note:a1", at: at(10), message: message("a1", "assistant", LONG) },
        step(command("w1", SCRIPT, { callInput: { description: "Write the status route" } })),
      ]),
    );
    expect(markup.match(/data-capped="item"/g)).toHaveLength(4);
    expect(markup).not.toContain("Show full");
    expect(markup).not.toContain("Show all");
    expect(markup).not.toContain("Show less");
    expect(markup).toContain("Short.");
  });

  it("stands a running command's code in its box in the slot, as it lands", () => {
    const running = (described: boolean) =>
      draw(
        record([], {
          live: true,
          status: status(),
          now: {
            kind: "step",
            step: stepOf(
              command("w9", SCRIPT, {
                ...(described ? { callInput: { description: "Write the status route" } } : {}),
                toolLifecycleStatus: "inProgress",
                sourceActivityKind: "tool.started",
              }),
              undefined,
              false,
            ),
          },
        }),
      );
    // Running, the command stands in the live slot as the row it becomes:
    // its code in its box, said or bare.
    for (const described of [true, false]) {
      const markup = running(described);
      expect(bubbles(markup).map(({ kind }) => kind)).toEqual(["step:command"]);
      expect(markup).toContain('data-capped="item"');
      expect(markup).not.toContain("Show all");
    }
  });

  // The call running now is the card's "this, now": a light sweeps across
  // its words until it returns — and across nothing else.
  it("sweeps a light across the words of the call running now, and only that one", () => {
    const running = draw(
      record([step(command("w1", "ls"))], {
        live: true,
        status: status(),
        now: {
          kind: "step",
          step: stepOf(
            command("w9", "npm run build", {
              toolLifecycleStatus: "inProgress",
              sourceActivityKind: "tool.started",
            }),
            undefined,
            true,
          ),
        },
      }),
    );
    expect(running.match(/data-run-shimmer/g)).toHaveLength(1);
    expect(running.indexOf("data-run-shimmer")).toBeGreaterThan(running.indexOf(">ls<"));
    expect(draw(record([step(command("w1", "ls"))]))).not.toContain("data-run-shimmer");
  });

  // The person's words stand on the page above the card; the chat marks, in
  // short and on their side, where they reached the Mate (the owner,
  // 2026-09-28: "shown the user message in short inside the working group").
  const personItem = {
    kind: "person",
    key: "person:u2",
    at: at(5),
    message: {
      ...message("u2", "assistant", "Keep /health working too\nThe load balancer calls it."),
      role: "user",
    },
    imageOnly: false,
  } as const;
  it("marks where the person's words reached the Mate, in one line on their side", () => {
    const markup = draw(record([step(command("w1", "ls")), personItem]));
    expect(markup).toMatch(
      /justify-end[^>]*><div[^>]*data-chat-kind="person"[^>]*><p[^>]*>Keep \/health working too</u,
    );
    expect(markup).not.toContain("The load balancer calls it.");
  });

  // A message with a picture read only "[Picture 1]" there (the owner,
  // 2026-10-01: "it also swallows the text it had"): its one line is the
  // first line of its words, never a label, and its pictures are drawn.

  it("draws a message's pictures under the first line of its words, never a label", () => {
    const withPicture = {
      ...personItem,
      message: {
        ...personItem.message,
        text: "[Picture 1]\nmake the map larger and let people pick a district\nthe dropdown can stay",
        attachments: [
          {
            type: "image",
            id: "img-1",
            name: "landing.png",
            mimeType: "image/png",
            sizeBytes: 10,
            previewUrl: "data:image/png;base64,AAAA",
          },
        ],
      },
    } as unknown as typeof personItem;
    const markup = draw(record([step(command("w1", "ls")), withPicture]));
    expect(markup).toContain(">make the map larger and let people pick a district<");
    expect(markup).not.toContain("the dropdown can stay");
    expect(markup).not.toContain("[Picture 1]");
    expect(markup).toMatch(/<img[^>]*alt="landing.png"[^>]*src="data:image\/png;base64,AAAA"/u);
  });

  // A mark says where in the run the person spoke. Before anything the Mate
  // did it marks nothing: their words (an answer to its question, as a rule)
  // stand on the page right above the card, and the card opened on a second
  // copy of them (Nova, 2026-09-29).
  it("drops a mark that would open the chat, before anything the Mate did", () => {
    const markup = draw(record([personItem, step(command("w1", "ls"))]));
    expect(markup).not.toContain('data-chat-kind="person"');
    expect(markup).toContain(">ls<");
    expect(draw(record([personItem]))).not.toContain('data-chat-kind="person"');
  });

  // A two-hour run drew nine hundred bubbles as its conversation opened and
  // froze the page for 0.7 s (Juno, 2026-09-27): it opens at its newest.
  it("opens a long chat at its newest bubbles, the ones before them drawn as the scroll nears them", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      step(command(`w${index}`, `echo ${index}`)),
    );
    const markup = draw(record(many));
    expect(bubbles(markup)).toHaveLength(40);
    expect(markup).toContain(">echo 59<");
    expect(markup).not.toContain(">echo 19<");
    // No button stands for them: the scroll draws them (`reachesEarlier`).
    expect(markup).not.toContain("earlier<");
    expect(bubbles(draw(record(many.slice(0, 40))))).toHaveLength(40);
  });

  // A check is its row from its start: while it runs, what it checks and the
  // page as the browser streams it, in the frame its picture will stand in —
  // never a line of its own beside the face as well (Nova, 2026-09-28: the
  // checks stood in a drawer under the chat until the run was over).
  // A check being taken is the now line's step (K10); taken, it lands as its
  // row with its picture, in the words the now line said it in.
  it("says a check being taken on the now line, and draws it taken as its row", () => {
    const check = (id: string, phase: "running" | "done") => {
      const entry = operation(id, "turn-1", 1, {
        kind: "browser",
        subject: "https://shop.dev/health",
        phase,
        ...(phase === "done"
          ? { screenshot: { src: `/shots/${id}.png`, width: 1280, height: 800 } }
          : {}),
      });
      if (entry.kind !== "operation") throw new Error("an operation");
      if (phase === "done") return entry.operation;
      // Still being taken: it has not settled.
      const { settledAt: _settled, ...taking } = entry.operation;
      return taking;
    };
    const running = check("b1", "running");
    const live = draw(
      record([], { live: true, now: { kind: "operation", operation: running }, status: status() }),
    );
    // Being taken, it stands in the live slot as the row it becomes.
    expect(bubbles(live).map(({ kind }) => kind)).toEqual(["checks"]);
    expect(live).toContain(">Checking /health in the browser<");
    const done = draw(
      record([
        {
          kind: "strip",
          key: "operation:op:b1",
          at: at(1),
          strip: checksStrip([check("b1", "done")], false),
        },
      ]),
    );
    expect(done).toContain(">Checked /health in the browser<");
    expect(done).not.toContain("passed");
    expect(done).not.toContain("data-report-take-live");
    expect(done).toMatch(/<button[^>]*data-report-take="desktop"/);
  });

  // An operation whose call never returned is behind the newer batch: it says
  // what was asked, never "Running"; once the run is over, "No result" (D3).
  it.each([
    { noResult: "stale" as const, time: null },
    { noResult: "closed" as const, time: "No result" },
  ])("draws an operation whose call never returned: $noResult", ({ noResult, time }) => {
    const entry = operation("d1", "turn-1", 1, {
      kind: "deploy",
      subject: "appdev",
      phase: "running",
      voice: "Deploying appdev.",
    });
    if (entry.kind !== "operation") throw new Error("an operation");
    const html = draw(
      record([
        {
          kind: "operation",
          key: "operation:op:d1",
          at: at(1),
          operation: entry.operation,
          noResult,
        },
      ]),
    );
    expect(html).toContain(">Deploy appdev<");
    expect(html).not.toContain("Deploying appdev");
    expect(html).not.toContain(">Running<");
    if (time === null) expect(html).not.toContain("No result");
    else expect(html).toContain(`>${time}<`);
  });

  // Before anything is in the chat the card is its status line alone, the
  // first thing seen after every message: the face as far from the card's
  // top as from its foot, where the empty list's room stood it 31 px down
  // and 22 px up (Nova, 2026-09-28).
  it("draws no scroll before anything is in the chat, so its status line stands alone", () => {
    const alone = draw(record([], { live: true, status: status() }));
    expect(alone).not.toContain("data-run-scroll");
    expect(alone).toContain(">Thinking<");
    const said = draw(record([thought("r1", "The route and the check disagree.")]));
    expect(said).toContain('data-run-scroll=""');
  });

  // Two pages of one host are said by name, as one is; more by their count,
  // and so are pages of two hosts, whose paths do not say which is which.
  it.each([
    { subjects: ["https://shop.dev/", "https://shop.dev/health"], words: "Checked / and /health" },
    { subjects: ["https://shop.dev/", "https://api.dev/"], words: "Checked 2 pages" },
    // A path names a page on one host only: "/" on another port is not the
    // app's front page (Nova, 2026-09-28: "/missing and /" for port 9's "/").
    { subjects: ["https://shop.dev/missing", "http://shop.dev:9/"], words: "Checked 2 pages" },
    {
      subjects: ["https://shop.dev/", "https://shop.dev/cart", "https://shop.dev/health"],
      words: "Checked 3 pages",
    },
  ])("names the pages a row of checks looked at: $words", ({ subjects, words }) => {
    const checks = subjects.map((subject, index) => {
      const entry = operation(`b${String(index)}`, "turn-1", 1, { kind: "browser", subject });
      if (entry.kind !== "operation") throw new Error("an operation");
      return entry.operation;
    });
    const markup = draw(
      record([
        { kind: "strip", key: "operation:op:b0", at: at(1), strip: checksStrip(checks, false) },
      ]),
    );
    expect(markup).toContain(`>${words} in the browser<`);
  });

  // A row saying a check failed showed only the pictures of the ones that
  // passed: a failed check took none (Nova, 2026-09-28, port 9 refused). Its
  // frame stands all the same, outlined red, saying what went wrong.
  it("keeps a failed check's frame among the takes, saying what went wrong", () => {
    const passed = operation("b1", "turn-1", 1, {
      kind: "browser",
      subject: "https://shop.dev/",
      screenshot: { src: "/shots/b1.png", width: 1280, height: 800 },
    });
    const refused = operation("b2", "turn-1", 2, {
      kind: "browser",
      subject: "http://shop.dev:9/",
      phase: "failed",
      browserSummary: {
        failedStep: { label: "open http://shop.dev:9/", note: "net::ERR_UNSAFE_PORT" },
      } as never,
    });
    const checks = [passed, refused].map((entry) => {
      if (entry.kind !== "operation") throw new Error("an operation");
      return entry.operation;
    });
    const markup = draw(
      record([
        { kind: "strip", key: "operation:op:b1", at: at(1), strip: checksStrip(checks, false) },
      ]),
    );
    expect(markup).toMatch(/<button[^>]*data-report-take="desktop"/u);
    expect(markup).toContain("data-report-take-failed");
    expect(markup).toContain("couldn&#x27;t open http://shop.dev:9/: net::ERR_UNSAFE_PORT");
  });

  // A row of checks says how long it took from its first check to its last;
  // one still being taken ticks nowhere in the chat — its time is the now
  // line's (K3).
  it("says a row of checks' time from its first check, and ticks none while one is taken", () => {
    const first = operation("b1", "turn-1", 1, {
      kind: "browser",
      subject: "https://shop.dev/",
      screenshot: { src: "/shots/b1.png", width: 1280, height: 800 },
    });
    const second = operation("b2", "turn-1", 3, {
      kind: "browser",
      subject: "https://shop.dev/",
      deviceName: "iPhone 16",
    });
    if (first.kind !== "operation" || second.kind !== "operation") throw new Error("operations");
    const strip = (checks: ReadonlyArray<ZeropsOperation>) =>
      draw(
        record([
          { kind: "strip", key: "operation:op:b1", at: at(1), strip: checksStrip(checks, false) },
        ]),
      );
    const took = formatWorkDuration(
      Date.parse(second.operation.settledAt!) - Date.parse(first.operation.anchorAt),
    );
    expect(strip([first.operation, second.operation])).toContain(`>${took}<`);
    const { settledAt: _settled, ...taking } = { ...second.operation, phase: "running" as const };
    const markup = strip([first.operation, taking]);
    expect(markup).toContain(">Running<");
    expect(markup).not.toContain(`>${took}<`);
  });

  it("opens nothing on a step that printed nothing", () => {
    const markup = draw(record([step(command("w1", "git status"))]));
    expect(markup).not.toContain("data-chat-disclose");
  });
});

describe("RunChat, as the person uses it", () => {
  const saved = {
    resize: globalThis.ResizeObserver,
    frame: globalThis.requestAnimationFrame,
  };
  beforeEach(() => {
    forgetRunFolds(SHARED.routeThreadKey);
    vi.mocked(foldWork).mockClear();
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
    // A thought's words are markdown, whose code blocks keep a wrap choice in
    // the page's storage: a window to subscribe on, where none is.
    if (typeof globalThis.window === "undefined") {
      vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
      });
    }
  });
  // Every card a test drew is taken down with it: a card left drawn keeps its
  // now line's dwell, its words' fade and its clock running past the test,
  // and their late renders logged while the worker closed (CI, 2026-10-01).
  const drawn: ReactTestRenderer[] = [];
  const nodeEvents = new WeakMap<object, EventTarget>();
  const mounted = (...args: Parameters<typeof create>): ReactTestRenderer => {
    const [element, options] = args;
    const renderer = create(element, {
      ...options,
      createNodeMock: (node) => {
        const target = options?.createNodeMock?.(node) ?? null;
        if (target !== null && typeof target === "object" && !nodeEvents.has(target)) {
          const events = new EventTarget();
          nodeEvents.set(target, events);
          target.addEventListener = events.addEventListener.bind(events);
          target.removeEventListener = events.removeEventListener.bind(events);
        }
        return target;
      },
    });
    drawn.push(renderer);
    return renderer;
  };
  afterEach(() => {
    act(() => {
      for (const renderer of drawn.splice(0)) renderer.unmount();
    });
    globalThis.ResizeObserver = saved.resize;
    globalThis.requestAnimationFrame = saved.frame;
    vi.unstubAllGlobals();
  });

  it("shows a partly loaded card's summary and work opener, then opens the first account page once", async () => {
    const read = vi.fn();
    const account = cardAccount(read);
    account.publish(CARD_RECORDS);
    const shared = { ...SHARED, threadRef: CARD_THREAD, syncing: true };
    function AccountRun() {
      const input = useCardTimelineInput(account);
      const cardPaging = useEngineCardSnapshots(CARD_THREAD);
      const liveLines = useEngineLiveStructure(CARD_THREAD, input.timelineEntries);
      const row = deriveMessagesTimelineRows({ ...input, cardPaging, liveLines }).find(
        (row) => row.kind === "record",
      );
      if (row?.kind !== "record") throw new Error("card missing");
      return <RunChat row={row} />;
    }
    let renderer: ReactTestRenderer | null = null;
    try {
      await act(async () => {
        renderer = mounted(
          <RegistryContext value={account.registry}>
            <TimelineRowCtx value={shared}>
              <TimelineRowActivityCtx value={ACTIVITY}>
                <AccountRun />
              </TimelineRowActivityCtx>
            </TimelineRowCtx>
          </RegistryContext>,
        );
      });
      const text = () => JSON.stringify(renderer!.toJSON());
      expect(text()).toContain("300 commands");
      expect(text()).not.toContain("inspect-service");
      expect(read).not.toHaveBeenCalled();
      await act(async () => button(renderer!, "Show work").props.onClick());
      expect(read).toHaveBeenCalledExactlyOnceWith(CARD_KEY, CARD_RUN, "later");
      expect(text()).not.toContain("inspect-service");
      await act(async () =>
        account.publish({
          ...CARD_RECORDS,
          spans: [{ runId: CARD_RUN, from: null, to: 0, reading: "later" }],
        }),
      );
      await act(async () =>
        account.publish({
          ...CARD_RECORDS,
          spans: [{ runId: CARD_RUN, from: null, to: 2, reading: null }],
        }),
      );
      expect(text()).toContain("inspect-service");
      expect(
        renderer!.root.findAll(
          (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
        ),
      ).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      if (renderer !== null) await act(async () => renderer!.unmount());
      account.close();
    }
  });

  it("Continue targets the interrupted turn and leaves when accepted evidence clears it", () => {
    const interruption = {
      turnId,
      restart: { cause: "replaced" as const, at: at(9) },
      continuation: "manual" as const,
    };
    const onRestartContinue = vi.fn();
    let row = record([step(command("cut", "inspect"))], {
      status: status({ live: false, face: "interrupted", endedAt: at(9), interruption }),
    });
    const view = (pending: typeof interruption | null) => (
      <TimelineRowCtx value={{ ...SHARED, interruption: pending, onRestartContinue }}>
        <TimelineRowActivityCtx value={ACTIVITY}>
          <RunChat row={row} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(view(interruption));
    });
    act(() => {
      button(renderer, "Continue").props.onClick();
    });
    expect(onRestartContinue).toHaveBeenCalledExactlyOnceWith(interruption);
    row = {
      ...row,
      status: status({
        ...row.status,
        interruption: { ...interruption, continuation: "requested" },
      }),
    };
    act(() => {
      renderer.update(view(null));
    });
    expect(
      renderer.root.findAll((node) => node.type === "button" && node.children.includes("Continue")),
    ).toHaveLength(0);
  });

  /** An item's own box (`data-capped`): a scroll of its own, never the run's. */
  const itemBox = () => ({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    toggleAttribute: () => undefined,
  });
  const isItemBox = (element: { props: unknown }) =>
    (element.props as Record<string, unknown> | null)?.["data-capped"] !== undefined;

  const mount = (row: RecordRow) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <Rows>
          <RunChat row={row} />
        </Rows>,
      );
    });
    return renderer;
  };
  const button = (renderer: ReactTestRenderer, words: string) =>
    renderer.root.find(
      (node) =>
        node.type === "button" &&
        (String(node.props["aria-label"] ?? "").startsWith(words) ||
          node.findAll(
            (child) => typeof child.children[0] === "string" && child.children[0] === words,
          ).length > 0),
    );

  it.each([
    { now: null, words: "Thinking" },
    { now: { kind: "writing" as const }, words: "Writing" },
  ])("keeps $words visible when a wordless thought finishes during the run", ({ now, words }) => {
    vi.useFakeTimers();
    try {
      const running = (items: ReadonlyArray<RecordItem>) =>
        record(items, { live: true, status: status(), now });
      const renderer = mount(running([]));
      const says = () => renderer.root.findByProps({ role: "status" }).children.join("");
      expect(says()).toBe(words);
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={running([thought("blank", " \n\t ")])} />
          </Rows>,
        ),
      );
      expect(says()).toBe(words);
      expect(
        renderer.root.findAll(
          (node) => node.type === "li" && node.props["data-run-key"] === "thought:blank",
        ),
      ).toHaveLength(0);
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + SLOT_MIN_SHOW_MS + 100));
      expect(says()).toBe(words);
    } finally {
      vi.useRealTimers();
    }
  });

  // The Claude adapter starts a call before its input streams in: a bare
  // command's code stands in its box once it arrives, and lands so (E3).
  it("stands a bare command's code in its box once it streams in, and lands it so", () => {
    vi.useFakeTimers();
    try {
      const running = (text: string | undefined) =>
        record([], {
          live: true,
          status: status(),
          now: {
            kind: "step",
            step: stepOf(
              (text === undefined ? withoutCommand : (entry: WorkLogEntry) => entry)(
                command("w8", text ?? "", {
                  toolLifecycleStatus: "inProgress",
                  sourceActivityKind: "tool.started",
                }),
              ),
            ),
          },
        });
      const renderer = mount(running(undefined));
      const shown = () => JSON.stringify(renderer.toJSON());
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={running(SCRIPT)} />
          </Rows>,
        ),
      );
      expect(shown()).toContain('"data-capped":"item"');
      expect(shown()).not.toContain("Show all");
      // It returned: it lands in the history as it stood, in its box.
      act(() =>
        renderer.update(
          <Rows>
            <RunChat
              row={record([step(command("w8", SCRIPT))], { live: true, status: status() })}
            />
          </Rows>,
        ),
      );
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
      expect(shown()).toContain('"data-capped":"item"');
      expect(shown()).not.toContain("Show all");
    } finally {
      vi.useRealTimers();
    }
  });

  // Two edits in a row fold into one line: the second stands in the slot as
  // it ended, the first in the history on its own, and they fold once it
  // lands (E6).
  it("folds the second of two edits into the first only once it lands", () => {
    vi.useFakeTimers();
    try {
      const edit = (id: string, running: boolean) =>
        withoutCommand(
          command(id, "", {
            itemType: "file_change",
            label: "File change",
            detail: `Edit: {"file_path":"/srv/app/${id}.ts"}`,
            ...(running
              ? { toolLifecycleStatus: "inProgress", sourceActivityKind: "tool.started" }
              : {}),
          }),
        );
      const first = step(edit("e1", false));
      const renderer = mount(
        record([first], {
          live: true,
          status: status(),
          now: { kind: "step", step: stepOf(edit("e2", true)) },
        }),
      );
      const said = () => JSON.stringify(renderer.toJSON());
      // It returned: the record folds it into the line before it.
      const done = stepOf(edit("e2", false), undefined, false);
      const folded: RecordItem = {
        kind: "step",
        key: "step:e1",
        at: at(2),
        step: {
          ...(first.kind === "step" ? first.step : done),
          words: "Edited e1.ts and e2.ts",
          entries: [edit("e1", false), edit("e2", false)],
        },
        parts: [
          first as Extract<RecordItem, { kind: "step" }>,
          {
            kind: "step",
            key: "step:e2",
            at: at(2),
            step: done,
          },
        ],
      };
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={record([folded], { live: true, status: status() })} />
          </Rows>,
        ),
      );
      const rows = () =>
        renderer.root
          .findAll((node) => node.type === "li" && node.props["data-run-key"] !== undefined)
          .map((node) => String(node.props["data-run-key"]));
      // Each its own line, the second as it ended: never running, never gone.
      expect(rows().filter((key) => key.endsWith("step:e1"))).toHaveLength(1);
      expect(rows().filter((key) => key.endsWith("step:e2"))).toHaveLength(1);
      expect(said()).not.toContain("data-run-shimmer");
      expect(said()).not.toContain("2 edits");
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
      // Landed, it folds in.
      expect(rows().filter((key) => key.endsWith("step:e2"))).toHaveLength(0);
      expect(said()).toContain("2 edits");
    } finally {
      vi.useRealTimers();
    }
  });

  // A card of calls in the slot keeps the identity it formed with: its first
  // call leaving first never remounts the rest, and nothing rises in again
  // (B4); a new batch's card is a new card, and rises in (E5).
  it("keeps a slot card whole when its first call leaves first, and lets a new one rise in", () => {
    vi.useFakeTimers();
    try {
      const running = (id: string) =>
        stepOf(
          command(id, `pnpm ${id}`, {
            callInput: { description: `Run ${id}` },
            toolLifecycleStatus: "inProgress",
            sourceActivityKind: "tool.started",
          }),
        );
      const live = (items: ReadonlyArray<RecordItem>, ids: ReadonlyArray<string>) =>
        record(items, {
          live: true,
          status: status(),
          now:
            ids.length === 0
              ? null
              : {
                  kind: "step",
                  step: running(ids.at(-1)!),
                  ...(ids.length > 1
                    ? {
                        others: ids
                          .slice(0, -1)
                          .map((id) => ({ kind: "step" as const, step: running(id) })),
                      }
                    : {}),
                },
        });
      const draw = (row: RecordRow) =>
        act(() =>
          renderer.update(
            <Rows>
              <RunChat row={row} />
            </Rows>,
          ),
        );
      const renderer = mount(live([], ["w1", "w2", "w3"]));
      const card = () =>
        renderer.root.findAll(
          (node) =>
            node.type === "li" && String(node.props["data-run-key"] ?? "").startsWith("calls#"),
        );
      const rising = () =>
        renderer.root.findAll((node) => node.props["data-run-rises"] !== undefined).length;
      const before = card();
      expect(before.map((node) => node.props["data-run-key"])).toEqual(["calls#step:w1"]);
      const rows = (id: string) =>
        renderer.root.find(
          (node) =>
            node.props["data-chat-kind"] === "step:command" &&
            node.findAll((child) => child.children.includes(`Run ${id}`)).length > 0,
        );
      const w2 = rows("w2");
      const risingBefore = rising();
      // The first call returns and lands; the other two run on.
      draw(live([step(command("w1", "pnpm w1"))], ["w2", "w3"]));
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
      draw(live([step(command("w1", "pnpm w1"))], ["w2", "w3"]));
      expect(card().map((node) => node.props["data-run-key"])).toEqual(["calls#step:w1"]);
      expect(card()[0]).toBe(before[0]);
      expect(rows("w2")).toBe(w2);
      expect(rising()).toBeLessThanOrEqual(risingBefore);
      // They return; a new batch's card is a new card, and rises in.
      const landed = [
        step(command("w1", "pnpm w1")),
        step(command("w2", "pnpm w2")),
        step(command("w3", "pnpm w3")),
      ];
      draw(live(landed, []));
      // They hold the slot a moment for what comes next; then "Thinking" stands its minimum.
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + SLOT_MIN_SHOW_MS + 100));
      draw(live(landed, ["w4"]));
      expect(card().map((node) => node.props["data-run-key"])).toEqual(["calls#step:w4"]);
      expect(
        card()[0]!.findAll((node) => node.props["data-run-rises"] !== undefined).length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // A call that joins the slot while the person watches rises in (E5).
  it("lets a call joining the live slot rise in", () => {
    const rising = (renderer: ReactTestRenderer) =>
      renderer.root.findAll(
        (node) =>
          node.props["data-run-rises"] !== undefined &&
          node.findAll((child) => child.props["data-chat-kind"] === "step:command").length > 0,
      ).length;
    const running = (id: string, text: string) =>
      stepOf(
        command(id, text, {
          callInput: { description: `Run ${text}` },
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.started",
        }),
      );
    const renderer = mount(
      record([], {
        live: true,
        status: status(),
        now: { kind: "step", step: running("w1", "pnpm build") },
      }),
    );
    expect(rising(renderer)).toBe(0);
    act(() =>
      renderer.update(
        <Rows>
          <RunChat
            row={record([], {
              live: true,
              status: status(),
              now: {
                kind: "step",
                step: running("w2", "pnpm test"),
                others: [{ kind: "step", step: running("w1", "pnpm build") }],
              },
            })}
          />
        </Rows>,
      ),
    );
    expect(rising(renderer)).toBe(1);
  });

  // A resync brings what nobody watched happen: it is simply there, never a
  // rise-in, in the history or in the slot (E2).
  it("lets nothing a resync brings rise in", () => {
    const rising = (renderer: ReactTestRenderer) =>
      renderer.root.findAll((node) => node.props["data-run-rises"] !== undefined).length;
    const synced = (row: RecordRow, syncing: boolean) => (
      <TimelineRowCtx value={{ ...SHARED, syncing }}>
        <TimelineRowActivityCtx value={ACTIVITY}>
          <RunChat row={row} />
        </TimelineRowActivityCtx>
      </TimelineRowCtx>
    );
    const first = record([thought("r1", "The route is fine.")], {
      live: true,
      status: status(),
    });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(synced(first, false));
    });
    const caughtUp = record(
      [
        thought("r1", "The route is fine."),
        step(command("w2", "pnpm build")),
        thought("r3", "The build passed."),
        step(command("w4", "pnpm test")),
      ],
      { live: true, status: status() },
    );
    act(() => renderer.update(synced(caughtUp, true)));
    expect(rising(renderer)).toBe(0);
  });

  // A helper's row says what it came to, and opens its own card in the
  // helpers panel: its steps, its clock, its report whole.
  /** A helper the panel knows: done, its report in one line. */
  const helperAgent = (overrides: Partial<RuntimeSubagent> = {}): RuntimeSubagent => ({
    id: "a1",
    kind: "subagent" as const,
    title: "Check the schema",
    role: null,
    model: null,
    effort: null,
    status: "completed" as const,
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: "Wrote three tests for the schema and its migrations",
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    prompt: null,
    toolUseId: null,
    spawnedBy: null,
    liveCall: null,
    firstSeenAt: at(1),
    startedAt: at(1),
    completedAt: at(2),
    updatedAt: at(2),
    ...overrides,
  });
  const helpersOf = (agent: RuntimeSubagent) => ({
    ...emptyAgentPanelModel(),
    directAgents: [agent],
    hasAgents: true,
  });
  const helpersRow: RecordItem = {
    kind: "helpers",
    key: "helpers:h1",
    at: at(1),
    entry: {
      ...command("h1", ""),
      itemType: "collab_agent_tool_call",
      agentSpawn: { workflowId: null, agentTaskIds: ["a1"] },
    },
  };

  it("opens a helper's own card in the helpers panel", () => {
    const agent = helpersOf(helperAgent());
    const helpers = helpersRow;
    const onOpenAgents = vi.fn();
    const threadRef = {
      environmentId: EnvironmentId.make("environment-local"),
      threadId: ThreadId.make("thread-1"),
    };
    const seen: Array<string | null> = [];
    function Focus() {
      seen.push(useHelperFocus(scopedThreadKey(threadRef))?.helperId ?? null);
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <TimelineRowCtx value={{ ...SHARED, agentPanelModel: agent, threadRef, onOpenAgents }}>
          <TimelineRowActivityCtx value={ACTIVITY}>
            <RunChat row={record([helpers])} />
            <Focus />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
    });
    act(() =>
      button(renderer, "Started a helper").props.onClick({
        currentTarget: { closest: () => null },
      }),
    );
    expect(
      renderer.root.findAll(
        (node) =>
          typeof node.children[0] === "string" &&
          node.children[0] === "Wrote three tests for the schema and its migrations",
      ).length,
    ).toBeGreaterThan(0);
    act(() => button(renderer, "Check the schema: Done. Open its work").props.onClick());
    expect(onOpenAgents).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toBe("a1");
  });

  // Its state, and its time only where it has one: never a dot left hanging.
  it.each([
    {
      name: "an idle child with no end",
      agent: { status: "idle" as const, completedAt: null },
      state: "Idle",
    },
    {
      name: "a helper done within a second",
      agent: { completedAt: "2026-09-25T10:00:01.300Z", startedAt: "2026-09-25T10:00:01.000Z" },
      state: "Done",
    },
  ])("says $name's state alone", ({ agent, state }) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <TimelineRowCtx value={{ ...SHARED, agentPanelModel: helpersOf(helperAgent(agent)) }}>
          <TimelineRowActivityCtx value={ACTIVITY}>
            <RunChat row={record([helpersRow])} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
    });
    act(() =>
      button(renderer, "Started a helper").props.onClick({
        currentTarget: { closest: () => null },
      }),
    );
    const words = renderer.root
      .findAll((node) => node.type === "span" && node.children[0] === state)
      .map((node) => node.children.filter((child) => typeof child === "string").join(""));
    expect(words.length).toBeGreaterThan(0);
    for (const said of words) expect(said).toBe(state);
  });

  // A helper's own run, in its card: it works under the Mate and wears no
  // face of the Mate's, live or settled.
  it.each([
    { name: "at work", row: record([], { live: true, status: status() }) },
    {
      name: "settled",
      row: record([thought("t1", "Looked at the schema.")], {
        status: status({ live: false, endedAt: at(9), face: "idle" }),
      }),
    },
  ])("a helper's run $name wears no face of the Mate's", ({ row }) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <TimelineRowCtx value={{ ...SHARED, speaker: { ...SHARED.speaker, helper: true } }}>
          <TimelineRowActivityCtx value={ACTIVITY}>
            <RunChat row={row} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
    });
    expect(renderer.root.findAllByType(MateFace)).toEqual([]);
  });

  it("opens what a step printed under its words, in place, and closes it again", () => {
    const renderer = mount(
      record([
        step(
          command("w1", "npm run build", {
            callInput: { description: "Run the production build" },
            detail: "dist/index.js  48.2 kB",
          }),
        ),
      ]),
    );
    const details = () =>
      renderer.root.findAll(
        (node) => node.type === "div" && node.props["data-chat-detail"] !== undefined,
      );
    expect(details()).toHaveLength(0);
    act(() =>
      button(renderer, "Run the production build").props.onClick({
        currentTarget: { closest: () => null },
      }),
    );
    expect(button(renderer, "Run the production build").props["aria-expanded"]).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain("48.2 kB");
    act(() =>
      button(renderer, "Run the production build").props.onClick({
        currentTarget: { closest: () => null },
      }),
    );
    expect(details()).toHaveLength(0);
  });

  // What a call printed opens whole in the log, every line of it on the
  // page, with no box of its own to scroll (the owner, 2026-10-05: "on expand
  // it should show everything, no scroll inside").
  it("opens a long output whole, every line of it there", () => {
    const printed = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const renderer = mount(
      record([
        step(command("w1", "npm test", { callInput: { description: "Test" }, detail: printed })),
      ]),
    );
    act(() => button(renderer, "Test").props.onClick());
    const box = renderer.root.find((node) => node.props["data-capped"] === "detail");
    expect(JSON.stringify(box.findByType("pre").children)).toContain("line 30");
    expect(box.props["data-whole"]).toBe("");
    expect(box.props.onScroll).toBeUndefined();
  });

  describe("Decision: Aleš's direction; keep existing fold behaviour and titles otherwise.", () => {
    afterEach(() => forgetRunFolds(SHARED.routeThreadKey));
    it.each(["watched", "folded"] as const)(
      "a live run with no work rows renders just its status without a work toggle (%s)",
      (fold) => {
        setRunFold(SHARED.routeThreadKey, "turn-1", "watched");
        setRunFold(SHARED.routeThreadKey, "turn-1", fold);
        const dom = markupDom(draw(record([], { live: true, status: status() })));
        const card = dom.querySelector("[data-run-chat]")!;
        expect(
          card.querySelector("button[aria-expanded]"),
          "ASSERTION: an empty run has no work toggle",
        ).toBeNull();
        expect(card.querySelector('[role="region"]')).toBeNull();
        expect(card.querySelector(".run-above")).toBeNull();
      },
    );
    it.each(["watched", "folded"] as const)(
      "the first work row renders the toggle inline in the live status line (%s)",
      (fold) => {
        setRunFold(SHARED.routeThreadKey, "turn-1", "watched");
        setRunFold(SHARED.routeThreadKey, "turn-1", fold);
        const dom = markupDom(
          draw(
            record([step(command("first", "echo ready"))], {
              live: true,
              status: status(),
            }),
          ),
        );
        const card = dom.querySelector("[data-run-chat]")!;
        const controls = card.querySelectorAll("button.run-now-fold");
        expect(controls).toHaveLength(1);
        expect(
          controls[0]!.closest("[data-run-now]"),
          "ASSERTION: the work toggle belongs to the status line in either fold",
        ).not.toBeNull();
        expect(controls[0]!.textContent).toBe(fold === "folded" ? "Show work" : "Hide work");
      },
    );
  });

  describe("the log and its work opener", () => {
    const personItem: RecordItem = {
      kind: "person",
      key: "person:leading",
      at: at(1),
      words: "Keep /health working too",
      imageOnly: false,
    };
    afterEach(() => forgetRunFolds(SHARED.routeThreadKey));
    const settled = (items: ReadonlyArray<RecordItem>) =>
      record(items, {
        status: status({ live: false, face: "idle", endedAt: at(5), worked: false }),
      });

    // Compatibility controls: empty thoughts and leading person marks never make work.
    it.each([
      { name: "an empty thought", items: [thought("empty", "")] },
      { name: "a whitespace-only thought", items: [thought("blank", " \n\t ")] },
      {
        name: "leading person entries",
        items: [personItem, { ...personItem, key: "person:next" }],
      },
    ])("shows no line or empty-work opener for $name", ({ items }) => {
      const open = markupDom(draw(record(items)));
      expect(open.querySelector('[role="region"][aria-label="Nova\'s work"]')).toBeNull();
      expect(open.querySelector('[data-chat-kind="person"]')).toBeNull();
      expect(draw(settled(items))).not.toContain("Show work");
    });

    // Synthetic agreement witness; production reachability of this record is unproven.
    it("offers no empty work for a leading call answer", () => {
      const open = markupDom(draw(record([attachmentAnswer])));
      expect(open.querySelector('[role="region"][aria-label="Nova\'s work"]')).toBeNull();
      expect(open.body.textContent).not.toContain("spec.txt");
      expect(draw(settled([attachmentAnswer]))).not.toContain("Show work");
    });

    it.each([
      { name: "an ordinary command", prefix: [] },
      {
        name: "leading person entries",
        prefix: [personItem, { ...personItem, key: "person:next" }],
      },
      { name: "a leading call answer", prefix: [attachmentAnswer] },
    ])("keeps the command visible and available through Show work after $name", ({ prefix }) => {
      const items = [...prefix, step(command("work", "echo eligible"))];
      const open = markupDom(draw(record(items)));
      const work = open.querySelector('[role="region"][aria-label="Nova\'s work"]');
      expect(work?.textContent).toContain("echo eligible");
      expect(work?.querySelectorAll("ol > li")).toHaveLength(1);
      expect(work?.textContent).not.toContain("Keep /health");
      expect(work?.textContent).not.toContain("spec.txt");
      const renderer = mount(settled(items));
      expect(JSON.stringify(renderer.toJSON())).not.toContain("echo eligible");
      act(() => button(renderer, "Show work").props.onClick());
      expect(JSON.stringify(renderer.toJSON())).toContain("echo eligible");
      expect(button(renderer, "Hide work").props["aria-expanded"]).toBe(true);
    });

    it.each([
      {
        name: "the person's words",
        answer: {
          kind: "person",
          key: "person:reply",
          at: at(3),
          words: "Use the attached specification",
          imageOnly: false,
        } as RecordItem,
        content: "Use the attached specification",
      },
      { name: "an attachment answer", answer: attachmentAnswer, content: "spec.txt" },
    ])("keeps $name paired with its question and its content intact", ({ answer, content }) => {
      const items = [questionItem, thought("gap", " \n"), answer];
      const dom = markupDom(draw(record(items)));
      const work = dom.querySelector('[role="region"][aria-label="Nova\'s work"]');
      expect(work?.textContent).toContain("Which specification should I use?");
      expect(work?.textContent).toContain(content);
      expect(work?.querySelectorAll("ol > li")).toHaveLength(2);
      const renderer = mount(settled(items));
      act(() => button(renderer, "Show work").props.onClick());
      const answerRow = renderer.root.find(
        (node) => node.props.lineKey === answer.key && node.props.theirs === true,
      );
      expect(answerRow.props.pairs).toBe(true);
      expect(JSON.stringify(renderer.toJSON())).toContain(content);
    });
  });

  // A run the person comes back to opens closed (D3): its summary line alone
  // — who worked, how long, what it came to — and "Show work" opens the whole
  // run in its scroll under the line they clicked (K12; the owner,
  // 2026-09-29: "when close just the summary -> expand open the scroll with
  // everything").
  describe("a run the person comes back to", () => {
    const CONVERSATION = SHARED.routeThreadKey;
    afterEach(() => forgetRunFolds(CONVERSATION));
    const settledRun = (overrides: Partial<RecordRow> = {}) =>
      record(
        [
          thought("r1", "The route and the check disagree."),
          step(command("w1", "npm test", { callInput: { description: "Run the tests" } })),
          {
            kind: "note",
            key: "note:a1",
            at: at(10),
            message: message("a1", "assistant", "Should /status be public?"),
          },
          {
            kind: "person",
            key: "person:x1",
            at: at(11),
            words: "Yes, no secrets",
            imageOnly: false,
          },
          {
            kind: "error",
            key: "error:e1",
            at: at(12),
            entry: command("e1", "deploy", { tone: "error", label: "The deploy was refused" }),
          },
        ],
        {
          status: status({ live: false, face: "produced", endedAt: at(80) }),
          outcome: outcomeOf([{ kind: "command", count: 1 }]),
          ...overrides,
        },
      );
    const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON());

    it("opens closed to its summary line, everything else behind Show work", () => {
      const markup = draw(settledRun());
      expect(markup).toContain('data-run-fold="folded"');
      expect(markup).toContain("Nova worked 1m 20s");
      expect(markupDom(markup).querySelector('button[aria-expanded="false"]')?.textContent).toBe(
        "Show work",
      );
      for (const hidden of [
        "Should /status be public?",
        "Yes, no secrets",
        "The deploy was refused",
        "Run the tests",
        "The route and the check disagree.",
      ]) {
        expect(markup).not.toContain(hidden);
      }
      expect(markup).not.toContain("data-run-scroll");
    });

    // Mounted as the page draws it: a markdown note reads the page's storage.
    const workOnly = (overrides: Partial<RecordRow> = {}) =>
      settledRun({
        items: settledRun().items.filter((item) => item.kind !== "note"),
        ...overrides,
      });
    const scrollsOf = (renderer: ReactTestRenderer) =>
      renderer.root.findAll(
        (node) => node.type === "div" && node.props["data-run-scroll"] !== undefined,
      );
    const settle = (renderer: ReactTestRenderer) =>
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={workOnly()} />
          </Rows>,
        ),
      );

    const measuredRun = ({ visibilityState = "visible", reduced = false, live = true } = {}) => {
      vi.stubGlobal("window", {
        ...window,
        matchMedia: () => ({
          matches: reduced,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      });
      const document = markupDom(
        '<div><div class="run-now"><span class="run-now-words"></span></div></div>',
      );
      Object.defineProperty(document, "visibilityState", { value: visibilityState });
      vi.stubGlobal("document", document);
      const root = document.body.firstElementChild!;
      const above = document.createElement("div");
      const Rect = document.defaultView!.DOMRect;
      above.getBoundingClientRect = () => new Rect(0, 40, 300, 200);
      const words = root.querySelector(".run-now-words")!;
      words.getBoundingClientRect = () => new Rect(0, 240, 100, 20);
      const completions: Array<() => void> = [];
      const cancel = vi.fn();
      vi.mocked(foldWork).mockImplementation(({ done }) => {
        completions.push(done);
        return cancel;
      });
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(
          <StrictMode>
            <Rows>
              <RunChat row={workOnly({ live, status: live ? status() : workOnly().status })} />
            </Rows>
          </StrictMode>,
          {
            createNodeMock: (node) => {
              const props = node.props as Record<string, unknown>;
              if (props["data-run-chat"] !== undefined) return root;
              if (props.className === "run-above") return above;
              return null;
            },
          },
        );
      });
      const draw = (live: boolean) =>
        act(() =>
          renderer.update(
            <StrictMode>
              <Rows>
                <RunChat row={workOnly({ live, status: live ? status() : workOnly().status })} />
              </Rows>
            </StrictMode>,
          ),
        );
      return { renderer, draw, completions, cancel };
    };

    it.each([
      { name: "in a hidden tab", visibilityState: "hidden", reduced: false },
      { name: "under reduced motion", visibilityState: "visible", reduced: true },
    ])(
      "settles $name without a fold or summary entrance animation",
      ({ visibilityState, reduced }) => {
        const { renderer, draw } = measuredRun({ visibilityState, reduced });
        draw(false);
        expect(scrollsOf(renderer)).toHaveLength(0);
        expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
        const summary = renderer.root.findAll(
          (node) => node.type === "span" && node.props["data-run-now-change"] !== undefined,
        );
        expect(summary).toHaveLength(0);
        expect(foldWork).not.toHaveBeenCalled();
      },
    );

    it("folds a visible watched run once through effect replay and removes its work only on completion", () => {
      const { renderer, draw, completions } = measuredRun();
      draw(false);
      expect(scrollsOf(renderer)).toHaveLength(1);
      expect(foldWork).toHaveBeenCalledTimes(1);
      expect(
        renderer.root.findAll((node) => node.props["data-run-now-change"] !== undefined),
      ).toHaveLength(1);
      // An unchanged draw cannot launch the settlement again.
      draw(false);
      expect(foldWork).toHaveBeenCalledTimes(1);
      act(() => completions[0]!());
      expect(scrollsOf(renderer)).toHaveLength(0);
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
    });

    it.each(["Show work", "joined run"] as const)(
      "keeps a later %s choice when an obsolete fold completes",
      (choice) => {
        const { renderer, draw, completions, cancel } = measuredRun();
        draw(false);
        expect(foldWork).toHaveBeenCalledTimes(1);
        if (choice === "Show work") act(() => button(renderer, "Show work").props.onClick());
        else draw(true);
        expect(cancel).toHaveBeenCalledTimes(1);
        act(() => completions[0]!());
        expect(scrollsOf(renderer)).toHaveLength(1);
        expect(button(renderer, "Hide work").props["aria-expanded"]).toBe(true);
      },
    );

    it("finishes a remounted automatic fold without playing settlement again", () => {
      const { renderer, draw, completions, cancel } = measuredRun();
      draw(false);
      expect(foldWork).toHaveBeenCalledTimes(1);
      act(() => renderer.unmount());
      expect(cancel).toHaveBeenCalledTimes(1);
      const { renderer: returned } = measuredRun({ live: false });
      expect(scrollsOf(returned)).toHaveLength(0);
      expect(button(returned, "Show work").props["aria-expanded"]).toBe(false);
      act(() => completions[0]!());
      expect(foldWork).toHaveBeenCalledTimes(1);
      expect(scrollsOf(returned)).toHaveLength(0);
    });

    // The owner, 2026-09-29, on a run they watched to its end: "why didn't
    // this autocollapse at the end? in this state it looks stupid".
    it("folds a run the person watched to its summary line as it settles", () => {
      const renderer = mount(workOnly({ live: true, status: status() }));
      expect(scrollsOf(renderer)).toHaveLength(1);
      settle(renderer);
      expect(scrollsOf(renderer)).toHaveLength(0);
      expect(text(renderer)).not.toContain("Run the tests");
      expect(text(renderer)).toContain("Nova worked 1m 20s");
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
    });

    it("shows a new question when another run joins an automatically folded card", () => {
      const renderer = mount(workOnly({ live: true, status: status() }));
      settle(renderer);
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
      const question = "Which environment?";
      const answer = "Inspect the preview shown here";
      act(() =>
        renderer.update(
          <Rows>
            <RunChat
              row={record(
                [
                  { kind: "question", key: "question:next", at: at(81), questions: [question] },
                  {
                    kind: "person",
                    key: "person:answer",
                    at: at(82),
                    words: answer,
                    imageOnly: false,
                  },
                ],
                { live: true, status: status() },
              )}
            />
          </Rows>,
        ),
      );
      const visibleQuestions = renderer.root.findAll((node) => {
        if (node.type !== "p" || !node.children.includes(question)) return false;
        for (let parent = node.parent; parent !== null; parent = parent.parent) {
          if (parent.props.hidden || parent.props.style?.display === "none") return false;
        }
        return true;
      });
      expect(visibleQuestions).toHaveLength(1);
    });

    it("keeps a run open as it settles while the person reads its work, its line at the foot", () => {
      const renderer = mount(workOnly({ live: true, status: status() }));
      // They scrolled up in it to read.
      act(() =>
        scrollsOf(renderer)[0]!.props.onScroll({
          currentTarget: { scrollTop: 0, scrollHeight: 900, clientHeight: 440 },
        }),
      );
      settle(renderer);
      expect(scrollsOf(renderer)).toHaveLength(1);
      const markup = text(renderer);
      expect(markup.indexOf("Run the tests")).toBeLessThan(markup.indexOf("Nova worked 1m 20s"));
      expect(markup).not.toContain("Show work");
    });

    it("keeps work hidden on completion after the reader explicitly hides it", () => {
      const renderer = mount(workOnly({ live: true, status: status() }));
      act(() =>
        scrollsOf(renderer)[0]!.props.onScroll({
          currentTarget: { scrollTop: 0, scrollHeight: 900, clientHeight: 440 },
        }),
      );
      act(() => button(renderer, "Hide work").props.onClick());
      settle(renderer);
      expect(scrollsOf(renderer)).toHaveLength(0);
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
      act(() => button(renderer, "Show work").props.onClick());
      expect(scrollsOf(renderer)).toHaveLength(1);
      expect(text(renderer)).toContain("Run the tests");
    });

    it("folds a run left open once it is drawn again", () => {
      setRunFold(CONVERSATION, "turn-1", "watched");
      const renderer = mount(workOnly());
      expect(scrollsOf(renderer)).toHaveLength(0);
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
    });

    it("opens the whole run under its line with Show work, and closes it with Hide work", () => {
      const renderer = mount(workOnly());
      const scrolls = () =>
        renderer.root.findAll(
          (node) => node.type === "div" && node.props["data-run-scroll"] !== undefined,
        );
      expect(scrolls()).toHaveLength(0);
      act(() => button(renderer, "Show work").props.onClick());
      expect(scrolls()).toHaveLength(1);
      for (const shown of [
        "Run the tests",
        "The route and the check disagree.",
        "Yes, no secrets",
        "The deploy was refused",
      ]) {
        expect(text(renderer)).toContain(shown);
      }
      expect(button(renderer, "Hide work").props["aria-expanded"]).toBe(true);
      act(() => button(renderer, "Hide work").props.onClick());
      expect(scrolls()).toHaveLength(0);
      expect(text(renderer)).not.toContain("Run the tests");
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
    });

    // Bodhi's audit, 2026-10-04: a settled card opened at its end.
    it("opens a long run's work at its first line with Show work", () => {
      const steps = Array.from({ length: 60 }, (_, index) =>
        step(command(`long${index}`, `echo line-${index}-done`)),
      );
      const renderer = mount(settledRun({ items: steps }));
      act(() => button(renderer, "Show work").props.onClick());
      expect(text(renderer)).toContain("echo line-0-done");
      expect(text(renderer)).toContain("echo line-59-done");
    });

    // Bodhi: an opened card drew each picture in the step that looked at it
    // and again in the result's strip right under it.
    it.each([
      { name: "the result's strip holds it: the step leaves it there", inStrip: true, drawn: 0 },
      { name: "no strip holds it: the step draws it", inStrip: false, drawn: 1 },
    ])("draws a picture an opened card looked at once: $name", ({ inStrip, drawn }) => {
      setRunFold(CONVERSATION, "turn-1", "shown");
      const look = step({
        id: "v1",
        createdAt: at(5),
        label: "Viewed image",
        tone: "tool",
        itemType: "image_view",
        viewedImagePath: "/srv/shots/home.png",
        toolLifecycleStatus: "completed",
      });
      const outcome = {
        ...outcomeOf([]),
        pictures: inStrip
          ? [{ kind: "file" as const, key: "f1", path: "/srv/shots/home.png", name: "home.png" }]
          : [],
      };
      const markup = renderToStaticMarkup(
        <TimelineRowCtx
          value={{
            ...SHARED,
            threadRef: {
              environmentId: EnvironmentId.make("environment-local"),
              threadId: ThreadId.make("thread-1"),
            },
          }}
        >
          <TimelineRowActivityCtx value={ACTIVITY}>
            <RunChat
              row={record([look], {
                status: status({ live: false, face: "produced", endedAt: at(80) }),
                outcome,
              })}
            />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
      forgetRunFolds(CONVERSATION);
      // Its line names it either way; the picture itself is drawn (here, read as gone) once.
      expect(markup.replace(/<[^>]+>/gu, "")).toContain("Looked at home.png");
      expect(markup.match(/home\.png is not there any more|Open home\.png/gu)?.length ?? 0).toBe(
        drawn,
      );
    });

    it("keeps even a lone word of its behind Show work", () => {
      const markup = draw(
        record(
          [
            {
              kind: "note",
              key: "note:a1",
              at: at(10),
              message: message("a1", "assistant", "Nothing to do."),
            },
          ],
          { status: status({ live: false, face: "idle", endedAt: at(5), worked: false }) },
        ),
      );
      expect(markup).toContain("Show work");
      expect(markup).not.toContain("Nothing to do.");
    });

    it("offers no Show work where the run left nothing to show", () => {
      const markup = draw(
        record([], {
          status: status({ live: false, face: "idle", endedAt: at(5), worked: false }),
        }),
      );
      expect(markup).toContain("Nova thought");
      expect(markup).not.toContain("Show work");
    });
  });

  // An entry that ended with no line of its own in the record yet — a call
  // the record folds or files elsewhere — stands its minimum as it last
  // showed, never a gap that blocks what comes next (pass 35).
  it("draws a slot entry that ended with no record line as it ended", () => {
    vi.useFakeTimers();
    try {
      const running = stepOf(
        command("w1", "pnpm build", {
          toolLifecycleStatus: "inProgress",
          sourceActivityKind: "tool.started",
        }),
      );
      const renderer = mount(
        record([], { live: true, status: status(), now: { kind: "step", step: running } }),
      );
      const commands = () =>
        renderer.root.findAll(
          (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
        );
      expect(commands()).toHaveLength(1);
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={record([], { live: true, status: status(), now: null })} />
          </Rows>,
        ),
      );
      expect(commands()).toHaveLength(1);
      // Ended, never still running (E17).
      expect(JSON.stringify(renderer.toJSON())).not.toContain("data-run-shimmer");
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
      expect(commands()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // A box lands as it stood in the slot (run 11): code that streamed in, its
  // newest lines in view, lands with them in view — its plop moves it, never
  // its words.
  // The owner, 2026-10-05: in the log an item "should show the start and then
  // on expand it should show everything, no scroll inside in either case".
  it("lands a box that followed its end in the slot at its head, with no scroll of its own", () => {
    vi.useFakeTimers();
    try {
      const boxes: Array<{
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
        props: Record<string, unknown>;
      }> = [];
      const node = (element: { type: unknown; props: unknown }) => {
        const props = element.props as Record<string, unknown>;
        if (element.type === "div" && props["data-capped-held"] !== undefined) {
          return { offsetHeight: 200 };
        }
        if (element.type !== "div" || !isItemBox(element)) return itemBox();
        const box = {
          scrollTop: 0,
          scrollHeight: 200,
          clientHeight: 80,
          toggleAttribute: () => undefined,
          props,
        };
        boxes.push(box);
        return box;
      };
      const live = command("w9", SCRIPT, {
        callInput: { description: "Write the status route" },
        toolLifecycleStatus: "inProgress",
        sourceActivityKind: "tool.started",
      });
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(
          <Rows>
            <RunChat
              row={record([], {
                live: true,
                status: status(),
                now: { kind: "step", step: stepOf(live) },
              })}
            />
          </Rows>,
          { createNodeMock: node },
        );
      });
      // In the working row it follows the code to its end.
      expect(boxes.map((box) => box.scrollTop)).toEqual([120]);
      const landed = step(
        command("w9", SCRIPT, { callInput: { description: "Write the status route" } }),
      );
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={record([landed], { live: true, status: status(), now: null })} />
          </Rows>,
        ),
      );
      act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
      // In the log it stands at its head, never scrolled, the rest past its foot.
      expect(boxes.at(-1)?.scrollTop).toBe(0);
      const box = renderer.root.find(
        (found) => found.type === "div" && found.props["data-capped-at"] === "log",
      );
      expect(box.props["data-more-below"]).toBe("");
      expect(box.props["data-whole"]).toBeUndefined();
      expect(box.props.onScroll).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  /** The log's boxes, each holding more than its cap: 200 px of words in 80. */
  const cutBoxes = (element: { type: unknown; props: unknown }) => {
    const props = element.props as Record<string, unknown>;
    if (element.type === "div" && props["data-capped-held"] !== undefined) {
      return { offsetHeight: 200 };
    }
    if (element.type === "div" && isItemBox(element)) {
      return { ...itemBox(), scrollHeight: 200, clientHeight: 80 };
    }
    return itemBox();
  };
  const logBox = (renderer: ReactTestRenderer) =>
    renderer.root.find((found) => found.type === "div" && found.props["data-capped-at"] === "log");

  it("opens a command cut at its head onto all of its code, though it printed nothing", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <Rows>
          <RunChat
            row={record([
              step(command("w1", SCRIPT, { callInput: { description: "Write the status route" } })),
            ])}
          />
        </Rows>,
        { createNodeMock: cutBoxes },
      );
    });
    expect(logBox(renderer).props["data-whole"]).toBeUndefined();
    const press = () => button(renderer, "Write the status route. Show all of its code");
    act(() => press().props.onClick());
    expect(logBox(renderer).props["data-whole"]).toBe("");
    act(() => button(renderer, "Write the status route. Hide").props.onClick());
    expect(logBox(renderer).props["data-whole"]).toBeUndefined();
  });

  it("opens a thought cut at its head with Show all, and closes it with Show less", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = mounted(
        <Rows>
          <RunChat row={record([thought("t1", "Reading the catalogue first.")])} />
        </Rows>,
        { createNodeMock: cutBoxes },
      );
    });
    expect(logBox(renderer).props["data-more-below"]).toBe("");
    act(() => button(renderer, "Show all of the thought").props.onClick());
    expect(logBox(renderer).props["data-whole"]).toBe("");
    expect(logBox(renderer).props["data-more-below"]).toBeUndefined();
    const less = renderer.root.find(
      (found) => found.type === "button" && found.children.includes("Show less"),
    );
    const place = { isConnected: true, getBoundingClientRect: () => ({ top: 0, bottom: 0 }) };
    act(() =>
      less.props.onClick({ currentTarget: { ...place, closest: () => null, parentElement: null } }),
    );
    expect(logBox(renderer).props["data-whole"]).toBeUndefined();
    expect(button(renderer, "Show all of the thought")).toBeDefined();
  });

  // A live run's chat starts empty: its scroll must follow its foot from the
  // first line on, once the lines outgrow it (Nova, 2026-09-29: a run
  // mounted with nothing drew no box, the watch on its foot was never set,
  // and the scroll stood still as the run went on).
  it("follows its foot from the first line of a run that started empty", () => {
    vi.useFakeTimers();
    const saved = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const list = { lines: true };
    // What each observer watches: the scroll's is the one on its list.
    const heard: Array<() => void> = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(target: unknown) {
        if (target === list) heard.push(this.callback);
      }
      disconnect() {}
    };
    try {
      const box = {
        scrollTop: 0,
        scrollHeight: 60,
        clientHeight: 60,
        toggleAttribute: () => undefined,
      };
      const node = (element: { type: unknown; props: unknown }) =>
        element.type === "ol"
          ? list
          : element.type === "div"
            ? isItemBox(element)
              ? itemBox()
              : box
            : {};
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(
          <Rows>
            <RunChat row={record([], { live: true, status: status() })} />
          </Rows>,
          { createNodeMock: node },
        );
      });
      expect(heard).toHaveLength(0);
      act(() =>
        renderer.update(
          <Rows>
            <RunChat
              row={record([step(command("w1", "echo one"))], { live: true, status: status() })}
            />
          </Rows>,
        ),
      );
      // Seen only once it returned, it waits for "Thinking" to stand its
      // minimum, stands its own and its hold in the live slot, then plops
      // into the history: the scroll's first line.
      act(() => vi.advanceTimersByTime(SLOT_MIN_SHOW_MS));
      act(() => vi.advanceTimersByTime(SLOT_MIN_SHOW_MS + SLOT_HOLD_MS + 100));
      expect(heard).toHaveLength(1);
      box.scrollHeight = 900;
      box.clientHeight = 440;
      heard[0]!();
      expect(box.scrollTop).toBe(460);
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved;
      vi.useRealTimers();
    }
  });

  // While the run goes on, its scroll keeps its newest line in view through
  // every arrival; only the person scrolling up in it stops that, and nothing
  // that arrives then moves what they read, until they scroll back down.
  describe("its scroll, as lines arrive", () => {
    /**
     * A live run's scroll with its first line, `height` tall, and its growth
     * heard: the card grows with it up to its `cap`, and scrolls past it.
     */
    function liveScroll({
      height = 600,
      cap = 440,
      code = "echo one",
      items = [step(command("w1", code))],
    }: {
      height?: number;
      cap?: number;
      code?: string;
      items?: ReadonlyArray<RecordItem>;
    } = {}) {
      const list = { lines: true };
      const heard: Array<() => void> = [];
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe(target: unknown) {
          if (target === list) heard.push(this.callback);
        }
        disconnect() {}
      };
      // A browser's scroll: it never stands past its foot.
      let top = 0;
      const box = {
        get scrollTop() {
          return top;
        },
        set scrollTop(next: number) {
          top = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
        },
        scrollHeight: height,
        get clientHeight() {
          return Math.min(this.scrollHeight, cap);
        },
        toggleAttribute: () => undefined,
      };
      const node = (element: { type: unknown; props: unknown }) =>
        element.type === "ol"
          ? list
          : element.type === "div"
            ? isItemBox(element)
              ? itemBox()
              : box
            : null;
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = mounted(
          <Rows>
            <RunChat row={record(items, { live: true, status: status() })} />
          </Rows>,
          { createNodeMock: node },
        );
      });
      const scroll = () =>
        renderer.root.find(
          (found) => found.type === "div" && found.props["data-run-scroll"] !== undefined,
        );
      return {
        box,
        /** The run goes on: `shown` in its history, `now` in its live slot. */
        show: (shown: ReadonlyArray<RecordItem>, now?: RecordRow["now"]) => {
          act(() =>
            renderer.update(
              <Rows>
                <RunChat
                  row={record(shown, { live: true, status: status(), ...(now ? { now } : {}) })}
                />
              </Rows>,
            ),
          );
        },
        /** What it holds grows by `by`, as an arrival does. */
        grow: (by: number) => {
          box.scrollHeight += by;
          for (const callback of heard) callback();
        },
        /**
         * The person presses the button that says `words` in it; what it
         * closes above it rises it by `rises`, and the scroll keeps it under
         * their pointer (`keepInPlace`).
         */
        press: (words: string, rises = 0) => {
          let reads = 0;
          const pressed = {
            closest: () => null,
            isConnected: true,
            parentElement: null,
            ownerDocument: { scrollingElement: box },
            getBoundingClientRect: () => {
              const top = reads === 0 ? 0 : -rises;
              reads += 1;
              return { top, bottom: top };
            },
          };
          act(() => button(renderer, words).props.onClick({ currentTarget: pressed }));
        },
        /** The run settles. */
        settle: () => {
          act(() =>
            renderer.update(
              <Rows>
                <RunChat row={record(items, { status: status() })} />
              </Rows>,
            ),
          );
        },
        /** Whether its scroll stands: the run is open. */
        open: () =>
          renderer.root.findAll(
            (found) => found.type === "div" && found.props["data-run-scroll"] !== undefined,
          ).length === 1,
        /** Its scroll heard where it stands. */
        heard: () => {
          act(() => {
            scroll().props.onScroll({
              currentTarget: {
                scrollTop: box.scrollTop,
                scrollHeight: box.scrollHeight,
                clientHeight: box.clientHeight,
              },
            });
          });
        },
        /**
         * The person moves it to `top` — a wheel, keys, a drag — and it is heard: their input
         * first, as a browser gives it, then where it stands.
         */
        scrolled: (top: number, resizeBy = 0) => {
          box.scrollTop = top;
          act(() => {
            nodeEvents.get(box)!.dispatchEvent(new Event("wheel"));
            box.scrollHeight += resizeBy;
            scroll().props.onScroll({
              currentTarget: {
                scrollTop: box.scrollTop,
                scrollHeight: box.scrollHeight,
                clientHeight: box.clientHeight,
              },
            });
          });
        },
        fromFoot: () => box.scrollHeight - box.scrollTop - box.clientHeight,
      };
    }

    const saved = { resize: globalThis.ResizeObserver };
    afterEach(() => {
      globalThis.ResizeObserver = saved.resize;
    });

    it("keeps its foot in view through every arrival", () => {
      const run = liveScroll();
      for (const by of [65, 40, 120]) {
        run.grow(by);
        expect(run.fromFoot()).toBe(0);
      }
    });

    it("keeps following through a scroll nobody made, read after the next arrival", () => {
      const run = liveScroll();
      run.grow(65);
      // Its own move to the foot, heard once the next line already grew it.
      run.box.scrollHeight += 40;
      run.heard();
      run.grow(0);
      expect(run.fromFoot()).toBe(0);
    });

    // A find, a drag-select, middle-click autoscroll, focus moving into it:
    // the person moved it up with no wheel, key or touch on it.
    it("holds what the person scrolled up to with no wheel, key or touch, through three arrivals", () => {
      const run = liveScroll();
      run.grow(400);
      run.scrolled(120);
      for (const by of [65, 40, 120]) {
        run.grow(by);
        expect(run.box.scrollTop).toBe(120);
      }
      run.scrolled(run.box.scrollHeight - run.box.clientHeight - 2);
      run.grow(65);
      expect(run.fromFoot()).toBe(0);
    });

    it("a small wheel move during a resize holds the reader through later arrivals", () => {
      const run = liveScroll();
      const top = run.box.scrollTop - 3;
      run.scrolled(top, 65);
      run.grow(65);
      run.grow(65);
      expect(run.box.scrollTop).toBe(top);
    });

    // What it holds shrank (a line closed) and the browser clamped it onto its
    // new foot; the clamp is heard only after the next line grew it again.
    it("keeps following through a clamp onto a shorter foot", () => {
      const run = liveScroll();
      run.grow(400);
      run.box.scrollHeight -= 100;
      // The browser clamps it onto its new foot.
      run.box.scrollTop = Number.POSITIVE_INFINITY;
      run.grow(0);
      run.box.scrollHeight += 65;
      run.heard();
      run.grow(0);
      expect(run.fromFoot()).toBe(0);
    });

    // A card below its cap cannot scroll: it stands at its foot whatever
    // happens, and only the person's move down onto it follows again.
    it("keeps a call opened in a card below its cap in view as it grows and settles", () => {
      const run = liveScroll({
        height: 300,
        cap: 560,
        items: [
          step(
            command("w1", "npm test", {
              callInput: { description: "Run the tests" },
              detail: "ok",
            }),
          ),
        ],
      });
      run.press("Run the tests");
      // What it opened grows the card, still below its cap.
      run.grow(120);
      expect(run.box.scrollHeight).toBe(run.box.clientHeight);
      // Arrivals take it past its cap.
      run.grow(300);
      expect(run.box.scrollTop).toBe(0);
      run.settle();
      expect(run.open()).toBe(true);
    });

    // End glides to the foot as it stood at the press; a line arrived as it
    // glided.
    it("follows again once a move down reaches the foot it set out for", () => {
      const run = liveScroll();
      run.grow(400);
      run.scrolled(100);
      run.scrolled(300);
      run.grow(35);
      run.scrolled(560);
      expect(run.fromFoot()).toBe(0);
      run.grow(65);
      expect(run.fromFoot()).toBe(0);
    });

    // A browser that never says a move ended (Safari before `scrollend`; no
    // page here has one): the move ends once the scroll stands still a moment.
    it("sets out anew once a move down paused, where nothing says it ended", () => {
      vi.useFakeTimers();
      try {
        const run = liveScroll();
        run.grow(400);
        run.scrolled(100);
        run.scrolled(300);
        act(() => vi.advanceTimersByTime(200));
        run.grow(35);
        // Where the foot stood as it set out, short of the one it reads now.
        run.scrolled(560);
        run.grow(65);
        expect(run.box.scrollTop).toBe(560);
      } finally {
        vi.useRealTimers();
      }
    });

    // Run 12, 18:58:18: a row going in resized it and the browser set its top 14 px up, with
    // no input of the person's: it goes on following its foot (it stopped for 39 minutes,
    // until the person scrolled it down by hand).
    it("keeps following through a move its own box made, with no input of the person's", () => {
      const run = liveScroll();
      run.grow(400);
      expect(run.fromFoot()).toBe(0);
      // Its lines re-measured 6 px taller, and the browser set its top 14 px up.
      run.box.scrollHeight += 6;
      run.box.scrollTop -= 14;
      run.heard();
      run.grow(65);
      expect(run.fromFoot()).toBe(0);
    });

    // A slow drag up while a thought streams: each wrap moves the foot on
    // between the person's moves, each a few pixels.
    it("stops following on a slow drag up between arrivals", () => {
      const run = liveScroll();
      run.grow(400);
      for (let wrap = 0; wrap < 5; wrap += 1) {
        run.scrolled(run.box.scrollTop - 3);
        run.grow(20);
      }
      expect(run.box.scrollTop).toBe(545);
    });

    // What they stopped it for is done: it follows again, and catches up.
    it("follows again once the person closes the call they opened", async () => {
      const run = liveScroll({
        items: [
          step(
            command("w1", "npm test", {
              callInput: { description: "Run the tests" },
              detail: "ok",
            }),
          ),
        ],
      });
      run.grow(400);
      run.press("Run the tests");
      run.grow(200);
      expect(run.box.scrollTop).toBe(560);
      run.press("Run the tests");
      // It catches up once the press is done.
      await Promise.resolve();
      expect(run.fromFoot()).toBe(0);
      run.grow(65);
      expect(run.fromFoot()).toBe(0);
    });

    // A bare command lands from the slot in its box: the call the person
    // opened holds the card all the same.
    it("stays where the person reads as a command lands under the call they opened", async () => {
      vi.useFakeTimers();
      try {
        const call = step(
          command("w1", "npm test", { callInput: { description: "Run the tests" }, detail: "ok" }),
        );
        const run = liveScroll({ items: [call] });
        run.grow(400);
        run.press("Run the tests");
        const code = "echo one\necho two";
        run.show([call], {
          kind: "step",
          step: stepOf(
            command("w8", code, {
              toolLifecycleStatus: "inProgress",
              sourceActivityKind: "tool.started",
            }),
          ),
        });
        run.show([call, step(command("w8", code))]);
        act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
        await Promise.resolve();
        run.grow(65);
        expect(run.box.scrollTop).toBe(560);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stays where the person scrolled after opening a call, once they close it", () => {
      const run = liveScroll({
        items: [
          step(
            command("w1", "npm test", {
              callInput: { description: "Run the tests" },
              detail: "ok",
            }),
          ),
        ],
      });
      run.grow(400);
      run.press("Run the tests");
      run.scrolled(300);
      run.grow(200);
      run.press("Run the tests");
      run.grow(65);
      expect(run.box.scrollTop).toBe(300);
    });
  });

  // A line landing from the live slot moves the history's scroll to where
  // the landed line ends exactly when the scroll follows its foot, read as
  // it lands: one the person stopped (they opened a call in it, or moved it
  // up) stays where they read.
  describe("its scroll, as a line lands from the slot", () => {
    const saved = { window: (globalThis as { window?: unknown }).window };
    afterEach(() => {
      (globalThis as { window?: unknown }).window = saved.window;
      vi.useRealTimers();
    });

    /** A run with a line in its history and one running in its slot, its scroll at `top`. */
    function landingRun() {
      vi.useFakeTimers();
      // Motion on, as on a page.
      (globalThis as { window?: unknown }).window = {
        matchMedia: () => ({ matches: false }),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      };
      let renderer!: ReactTestRenderer;
      const scroll = () =>
        renderer.root.find(
          (found) => found.type === "div" && found.props["data-run-scroll"] !== undefined,
        );
      // The landed line takes 65px once the history draws it.
      const landed = () =>
        scroll().findAll((found) => String(found.props["data-run-key"]).includes("w2")).length > 0;
      const marks = new Set<string>();
      let top = 0;
      const box = {
        get scrollTop() {
          return top;
        },
        set scrollTop(next: number) {
          top = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
        },
        get scrollHeight() {
          return renderer === undefined || !landed() ? 600 : 665;
        },
        clientHeight: 440,
        querySelector: () => null,
        hasAttribute: (name: string) => marks.has(name),
        toggleAttribute: (name: string, on: boolean) => {
          if (on) marks.add(name);
          else marks.delete(name);
        },
      };
      const above = { querySelector: () => box, querySelectorAll: () => [] };
      const node = (element: { type: unknown; props: unknown; key?: unknown }) => {
        const props = element.props as Record<string, unknown>;
        if (element.type !== "div") return {};
        if (element.key === "above") return above;
        return props["data-run-scroll"] !== undefined ? box : {};
      };
      const running = command("w2", "pnpm build", {
        toolLifecycleStatus: "inProgress",
        sourceActivityKind: "tool.started",
      });
      act(() => {
        renderer = mounted(
          <Rows>
            <RunChat
              row={record(
                [
                  step(
                    command("h1", SCRIPT, {
                      callInput: { description: "Write the status route" },
                      detail: "written",
                    }),
                  ),
                ],
                {
                  live: true,
                  status: status(),
                  now: { kind: "step", step: stepOf(running) },
                },
              )}
            />
          </Rows>,
          { createNodeMock: node },
        );
      });
      return {
        box,
        renderer,
        /** The running line ends, stands its minimum, and lands in the history. */
        land: () => {
          act(() =>
            renderer.update(
              <Rows>
                <RunChat
                  row={record(
                    [
                      step(
                        command("h1", SCRIPT, {
                          callInput: { description: "Write the status route" },
                          detail: "written",
                        }),
                      ),
                      step(command("w2", "pnpm build")),
                    ],
                    {
                      live: true,
                      status: status(),
                      now: null,
                    },
                  )}
                />
              </Rows>,
            ),
          );
          act(() => vi.advanceTimersByTime(SLOT_HOLD_MS + 100));
          expect(landed()).toBe(true);
        },
      };
    }

    it("leaves a scroll the person stopped where they read", () => {
      const run = landingRun();
      expect(run.box.scrollTop).toBe(160);
      // They open a call in it, at its foot.
      act(() => button(run.renderer, "Write the status route").props.onClick());
      run.land();
      expect(run.box.scrollTop).toBe(160);
    });

    it("moves a scroll that follows to the landed line's end", () => {
      const run = landingRun();
      run.land();
      expect(run.box.scrollTop).toBe(225);
    });

    // A find or focus moved it up just before; its scroll event has not come.
    it("leaves a scroll moved up just before, its move not heard yet, where it was", () => {
      const run = landingRun();
      run.box.scrollTop = 120;
      run.land();
      expect(run.box.scrollTop).toBe(120);
    });
  });

  // A row travelling into its place paints past the lines' foot for a moment;
  // the browser counts that as more to scroll to. Nothing is below the last
  // line: no fade at the bottom.
  it("fades no bottom while a landing row's travel overhangs its last line", () => {
    const saved = {
      resize: (globalThis as { ResizeObserver?: unknown }).ResizeObserver,
      style: (globalThis as { getComputedStyle?: unknown }).getComputedStyle,
    };
    const list = { offsetHeight: 600 };
    const heard: Array<() => void> = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(target: unknown) {
        if (target === list) heard.push(this.callback);
      }
      disconnect() {}
    };
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({
      paddingTop: "0px",
      paddingBottom: "0px",
    });
    try {
      const marks = new Set<string>();
      let top = 0;
      const box = {
        get scrollTop() {
          return top;
        },
        set scrollTop(next: number) {
          top = Math.max(0, Math.min(next, this.scrollHeight - this.clientHeight));
        },
        scrollHeight: 600,
        clientHeight: 440,
        firstElementChild: list,
        toggleAttribute: (name: string, on: boolean) => {
          if (on) marks.add(name);
          else marks.delete(name);
        },
      };
      const node = (element: { type: unknown; props: unknown }) =>
        element.type === "ol"
          ? list
          : element.type === "div"
            ? isItemBox(element)
              ? itemBox()
              : box
            : {};
      act(() => {
        mounted(
          <Rows>
            <RunChat
              row={record([step(command("w1", "echo one"))], { live: true, status: status() })}
            />
          </Rows>,
          { createNodeMock: node },
        );
      });
      expect(marks.has("data-more-below")).toBe(false);
      // A line lands: its travel overhangs the last line by 80px.
      list.offsetHeight += 65;
      box.scrollHeight += 65 + 80;
      for (const callback of heard) callback();
      expect(box.scrollHeight - box.scrollTop - box.clientHeight).toBe(80);
      expect(marks.has("data-more-below")).toBe(false);
      expect(marks.has("data-more-above")).toBe(true);
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.resize;
      (globalThis as { getComputedStyle?: unknown }).getComputedStyle = saved.style;
    }
  });

  // A long run opens on its newest lines (a two-hour run froze the page as
  // nine hundred bubbles drew at once); scrolling up draws the earlier ones
  // before the person reaches the top.
  it("draws the earlier lines as the person scrolls up to them", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      step(command(`w${index}`, `echo ${index}`)),
    );
    const renderer = mount(record(many));
    const rows = () =>
      renderer.root.findAll(
        (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
      );
    const scroll = () =>
      renderer.root.find(
        (node) => node.type === "div" && node.props["data-run-scroll"] !== undefined,
      );
    expect(rows()).toHaveLength(40);
    act(() =>
      scroll().props.onScroll({
        currentTarget: { scrollTop: 900, scrollHeight: 1800, clientHeight: 440 },
      }),
    );
    expect(rows()).toHaveLength(40);
    act(() =>
      scroll().props.onScroll({
        currentTarget: { scrollTop: 120, scrollHeight: 1800, clientHeight: 440 },
      }),
    );
    expect(rows()).toHaveLength(50);
  });
});

describe("a turn interrupted by a Mate restart", () => {
  it.each(["light", "dark"] as const)(
    "keeps the interruption and real Continue visible while folded in %s",
    (resolvedTheme) => {
      const interruption = {
        turnId,
        restart: { cause: "replaced" as const, at: at(9) },
        continuation: "manual" as const,
      };
      const row = record([step(command("cut-work", "inspect"))], {
        status: status({ live: false, face: "interrupted", endedAt: at(9), interruption }),
      });
      const onRestartContinue = vi.fn();
      const drawWith = (pending: typeof interruption | null) =>
        renderToStaticMarkup(
          <TimelineRowCtx
            value={{
              ...SHARED,
              resolvedTheme,
              speaker: { name: "Eddy", tint: "sky" },
              interruption: pending,
              onRestartContinue,
            }}
          >
            <TimelineRowActivityCtx value={ACTIVITY}>
              <RunChat row={row} />
            </TimelineRowActivityCtx>
          </TimelineRowCtx>,
        );
      const html = drawWith(interruption);
      expect(html).toContain("Interrupted — Eddy restarted at");
      expect(html).toContain(">Continue</button>");
      expect(html).not.toContain("2026-09-27T");
      expect(html).not.toContain("Needs attention");
      expect(drawWith(null)).not.toContain(">Continue</button>");

      const awaitingAnswer = renderToStaticMarkup(
        <TimelineRowCtx
          value={{
            ...SHARED,
            resolvedTheme,
            interruption,
            queueBlockedByAnswer: true,
            onRestartContinue: null,
          }}
        >
          <TimelineRowActivityCtx value={ACTIVITY}>
            <RunChat row={row} />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>,
      );
      expect(awaitingAnswer).toContain("Answer the pending question to continue.");
      expect(awaitingAnswer).not.toContain(">Continue</button>");
      const resumed = draw({
        ...row,
        status: status({
          ...row.status,
          interruption: { ...interruption, continuation: "requested" },
        }),
      });
      expect(resumed).not.toContain("Interrupted");
      expect(resumed).toContain("continuation requested");
    },
  );
});

it.each([
  ["automatic", "continuation scheduled"],
  ["continued", "continued automatically"],
  ["requested", "continuation requested"],
] as const)("a restart says %s only from the recorded continuation", (continuation, words) => {
  const interruption = { turnId, restart: { cause: "replaced" as const, at: at(9) }, continuation };
  const html = draw(
    record([step(command("cut", "inspect"))], {
      status: status({ live: false, face: "interrupted", endedAt: at(9), interruption }),
    }),
  );
  expect(html).toContain(words);
  expect(html).not.toContain(">Continue</button>");
  if (continuation === "automatic") expect(html).not.toContain("continued automatically");
  if (continuation === "requested") {
    expect(html).not.toContain("Interrupted");
    expect(html).not.toContain(">Continue</button>");
  }
});
