import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { foldsLikeAMessage, RunChat } from "./RunChat";
import { forgetRunFolds, setRunFold } from "./runCard.logic";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";
import { checksStrip, formatWorkDuration, type OutcomeModel } from "./conversation.logic";
import { operation } from "./conversationFixtures";
import { stepOf } from "./workSteps.logic";

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

const LONG = Array.from({ length: 12 }, (_, index) => `Line ${index + 1} of what it thought.`).join(
  "\n",
);
const SCRIPT = [
  "cat > status.ts <<'EOF'",
  ...Array.from({ length: 14 }, (_, i) => `line ${i}`),
  "EOF",
].join("\n");

type RecordRow = Extract<MessagesTimelineRow, { kind: "record" }>;

function record(items: ReadonlyArray<RecordItem>, overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    kind: "record",
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
}

const thought = (id: string, text: string): RecordItem => ({
  kind: "thought",
  key: `thought:${id}`,
  at: at(1),
  messages: [message(id, "reasoning", text)],
  durationMs: 4000,
});

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
  created: [],
  notDone: [],
  planLeft: [],
  change: null,
  crewTask: null,
  activity,
  later: { services: [], changes: [], tasks: [], pages: [], answered: false },
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

  // Every element of the chat is one bubble (the owner, 2026-09-28: "the
  // design of every element has to be largely the same, differences subtle but
  // obvious"): one round, 14 px in, 10 px down, at the prose size. Only the
  // surface tells them apart — its words the fullest fill, a thought half of
  // it, what it did the card's white in a hairline — and the mark each wears
  // in the Mate's column, beside it rather than in it, so every bubble's words
  // start on one edge.
  // Five weights, strongest first (K14): what anyone said at the prose size in
  // its bubble; what the Mate did as compact 13 px rows in a light outline;
  // what it thought quietest, 13 px on the faintest fill.
  it("draws its words at the prose size, its calls and thoughts quieter", () => {
    const markup = draw(
      record([
        {
          kind: "note",
          key: "note:a1",
          at: at(10),
          message: message("a1", "assistant", "Found it."),
        },
        thought("r1", "The build script is missing."),
        step(command("w1", "npm test", { callInput: { description: "Run the tests" } })),
      ]),
    );
    const classes = (tag: string | undefined) => /class="([^"]*)"/u.exec(tag ?? "")?.[1] ?? "";
    const [said, thought_] = bubbles(markup);
    const card = /<div class="([^"]*)" data-chat-calls="true">/u.exec(markup)?.[1] ?? "";
    expect(classes(said?.tag).split(" ")).toEqual(
      expect.arrayContaining(["w-full", "rounded-2xl", "text-prose", "px-3.5", "py-2.5"]),
    );
    expect(classes(thought_?.tag).split(" ")).toEqual(
      expect.arrayContaining(["w-full", "rounded-2xl", "text-line", "px-3", "py-2"]),
    );
    expect(card.split(" ")).toEqual(expect.arrayContaining(["w-full", "rounded-2xl"]));
    // Its words wear its tint, lightly; the face beside them says who spoke.
    expect(classes(said?.tag)).toContain("run-speech");
    expect(markup).toContain("--run-speaker-tint:var(--zerops-mate-tint-sky)");
    expect(markup).toMatch(
      /<span class="flex h-\[1lh\] items-center"><svg[^>]*class="[^"]*size-5[^"]*"[^>]*data-mate-face-tint="sky"/u,
    );
    expect(classes(thought_?.tag)).toContain("bg-foreground/3");
    // Outlined on the tray, never filled: the composer keeps the only white.
    expect(card).toContain("ring-1 ring-foreground/9");
    expect(card).not.toContain("bg-card");
    // Each mark stands in the Mate's column, out of its bubble.
    const column = (line: string, icon: string) =>
      new RegExp(
        `<span aria-hidden="true" class="w-7 shrink-0 flex justify-center ${line}"><span class="flex h-\\[1lh\\] items-center"><svg[^>]*lucide-${icon}`,
        "u",
      );
    expect(markup).toMatch(column("pt-2 text-line", "asterisk"));
    expect(markup).toMatch(column("pt-1\\.75 text-line", "square-terminal"));
    expect(markup).not.toMatch(/data-chat-bubble="speech"[^>]*>\s*<span aria-hidden/u);
  });

  // Ten reads in a row are one stretch of work (the owner, 2026-09-28: "there
  // is no spacing between items"): a run of calls shares one card, a hairline
  // between them; a thought or its words between two calls start a new one.
  // Two scrollbars in one view is where the last passes' scroll bugs lived
  // (K8): the card has no scroll of its own — the conversation is the one
  // scroll, and nothing in the card scrolls inside it.
  it("has no scroll of its own, and nothing in it scrolls", () => {
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
    expect(markup).not.toMatch(/overflow-(?:y-)?auto/u);
    expect(markup).not.toContain("max-h-110");
    expect(markup).not.toContain("data-chat-fade");
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
    expect(markup).toMatch(/class="[^"]*divide-y[^"]*" data-chat-calls="true"/);
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
    expect(markup).not.toContain("animate-words-in");
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
    expect(markup).toContain('<span class="run-now-worked">Nova worked 1m 12s</span>');
    expect(markup).toContain('<span class="run-now-effort"> · 2 commands · 1 file read</span>');
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
    expect(one).toMatch(/<span class="font-mono text-foreground">npm run build<\/span>/u);
    expect(one.match(/npm run build/g)).toHaveLength(1);
    const script = draw(record([step(command("w2", SCRIPT))]));
    expect(script).toMatch(
      /<span class="font-mono text-foreground">cat &gt; status.ts &lt;&lt;&#x27;EOF&#x27;<\/span>/u,
    );
    expect(script).toContain(">Show all 16 lines<");
    expect(script).not.toContain("line 13");
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
    expect(alone).toMatch(/lucide-triangle-alert[^"]*text-status-failed-text/u);
    expect(alone).toMatch(/text-status-failed-text">Failed</u);
    expect(alone).not.toContain("bg-status-failed-surface");
    const retried = draw(
      record([step(failed), { ...step(command("w2", "npm test")), key: "step:w2", at: at(20) }]),
    );
    expect(retried).not.toMatch(standing);
    expect(retried).toContain('data-chat-failed="undone"');
    expect(retried).not.toContain("text-status-failed-text");
    expect(retried).toMatch(/lucide-triangle-alert[^"]*text-muted-foreground/u);
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
      /data-chat-bubble="speech" data-chat-kind="question"><p[^>]*>Should \/status be public\?</u,
    );
    expect(markup).toMatch(/<li class="[^"]*-mt-1\.5[^"]*" data-chat-row="true">/u);
    // Its answer stands nowhere else: whole, never cut to a line.
    expect(markup).toMatch(/<p class="[^"]*whitespace-pre-wrap[^"]*" data-chat-kind="person">/u);
    expect(markup).not.toMatch(/<p class="[^"]*truncate[^"]*" data-chat-kind="person">/u);
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
    expect(markup).toMatch(/<span class="sr-only" role="status">Thinking<\/span>/u);
  });

  // Several at once (K10): how many on the line, a still line each under it.
  it("says several steps at once by how many, a still line each under it", () => {
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
          step: runningCommand("w3", "pnpm lint"),
          others: [runningCommand("w1", "pnpm build"), runningCommand("w2", "pnpm test")],
        },
      }),
    );
    expect(markup).toContain('data-run-now="several"');
    expect(markup).toContain(">Running 3 commands<");
    expect(markup.match(/<li><span class="run-now-verb run-now-mono">/g)).toHaveLength(3);
    expect(markup).not.toContain("data-run-shimmer");
  });

  // Blue means something to click (S3): the run's clock counts in ink, and a
  // call running beside it counts in the calls' quiet ink.
  // One ticking time for each thing that runs (K3): a command left running in
  // the background ticks in its bar, never again in the chat; a deploy ticks
  // in its bar, never again as the now line's long-step words.
  it("ticks each running thing once: in its bar, or on the now line", () => {
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
    const row = serving.slice(serving.indexOf('data-chat-kind="step:command"'));
    expect(row).toMatch(/text-muted-foreground">Running</u);
    expect(row).not.toMatch(/tabular-nums">\d/u);
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
    expect(running("deploy")).not.toMatch(/run-now-long">· 0:4\d/u);
    expect(running("browser")).toMatch(/run-now-long">· 0:4\d/u);
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
    expect(markup).toMatch(
      /<span class="run-now-clock" data-work-line-clock="true">(?:\d+:)?\d+:\d\d</u,
    );
    expect(markup).not.toContain("text-status-busy-text");
  });

  // A thought is the quietest thing in the card: two lines of it, and where
  // it runs on, the thought itself is the way to the rest (D4) — never a
  // scroll inside the card.
  it("clamps a thought to two lines, the whole of it a click away", () => {
    const long = draw(record([thought("r1", LONG)]));
    expect(long).toMatch(/<span class="line-clamp-2 italic" data-chat-folded="true">/u);
    expect(long).toMatch(/<button aria-expanded="false" aria-label="[^"]*Show the whole thought"/u);
    expect(long).not.toMatch(
      /data-chat-bubble="thought"[^>]*>(?:(?!data-chat-row).)*overflow-y-auto/su,
    );
    const short = draw(record([thought("r1", "The route and the check disagree.")]));
    expect(short).toContain('<span class="line-clamp-2 italic">The route and the check disagree.');
    expect(short).not.toContain("Show the whole thought");
  });

  it("folds what the chat opens onto past the limits, and leaves the rest whole", () => {
    const markup = draw(
      record([
        thought("r1", LONG),
        thought("r2", "Short."),
        { kind: "note", key: "note:a1", at: at(10), message: message("a1", "assistant", LONG) },
      ]),
    );
    expect(markup.match(/data-chat-folded="true"/g)).toHaveLength(2);
    expect(markup.match(/Show the whole thought"/g)).toHaveLength(1);
    expect(markup.match(/>Show full message</g)).toHaveLength(1);
  });

  // A script arrives whole, so it is never "being written": four of its
  // lines from its first frame, running or done (the owner, 2026-09-28: "I
  // see 100s of LoC printed directly").
  // What a command was for leads; its code is how, in the muted ink under it
  // — failed too, where the headline, the surface and the time already say so.
  it("sets a command's code quieter than what it was for, failed or not", () => {
    const codeTone = (markup: string) =>
      /<code class="([^"]*)"/u
        .exec(markup)?.[1]
        ?.split(" ")
        .filter((name) => name.startsWith("text-"));
    for (const status of ["completed", "failed"] as const) {
      const markup = draw(
        record([
          step(
            command("w1", "npm test", {
              callInput: { description: "Run the tests" },
              toolLifecycleStatus: status,
            }),
          ),
        ]),
      );
      // Mono at 13 px, the chat's quiet size: as tall as the words it follows.
      expect(codeTone(markup)).toEqual(["text-muted-foreground", "text-line"]);
    }
  });

  it("folds a command past its fourth line from its first frame, saying how many there are", () => {
    const done = draw(
      record([
        step(command("w1", SCRIPT, { callInput: { description: "Write the status route" } })),
      ]),
    );
    expect(done).toContain('data-chat-folded="true"');
    expect(done).toContain(">Show all 16 lines<");
    const running = draw(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "step",
          step: stepOf(
            command("w9", SCRIPT, {
              callInput: { description: "Write the status route" },
              toolLifecycleStatus: "inProgress",
              sourceActivityKind: "tool.started",
            }),
            undefined,
            false,
          ),
        },
      }),
    );
    // Running, the command is the now line's: its words and code, not a row.
    expect(running).not.toContain('data-chat-kind="step:command"');
    expect(running).toContain(
      '<span class="run-now-verb" data-run-shimmer="">Write the status route',
    );
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
      /justify-end[^>]*><p[^>]*data-chat-kind="person"[^>]*>Keep \/health working too</,
    );
    expect(markup).not.toContain("The load balancer calls it.");
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
  it("opens a long chat at its newest bubbles, the ones before them a click away", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      step(command(`w${index}`, `echo ${index}`)),
    );
    const markup = draw(record(many));
    expect(bubbles(markup)).toHaveLength(40);
    expect(markup).toContain(">Show 20 earlier<");
    expect(markup).toContain(">echo 59<");
    expect(markup).not.toContain(">echo 19<");
    expect(draw(record(many.slice(0, 40)))).not.toContain("earlier<");
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
    expect(bubbles(live)).toEqual([]);
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

  // Before anything is in the chat the card is its status line alone, the
  // first thing seen after every message: the face as far from the card's
  // top as from its foot, where the empty list's room stood it 31 px down
  // and 22 px up (Nova, 2026-09-28).
  it("draws no list before anything is in the chat, so its status line stands alone", () => {
    expect(draw(record([], { live: true, status: status() }))).not.toContain("<ol");
    const said = draw(record([thought("r1", "The route and the check disagree.")]));
    expect(said).toContain(
      '<ol aria-label="Nova&#x27;s work" class="flex min-w-0 flex-col gap-3 focus:outline-none" tabindex="-1">',
    );
  });

  // The Mate's column lines its bubbles up over the face at the chat's foot,
  // and holds the marks that tell them apart: one grid for the whole card, a
  // 28 px column 8 px off the bubbles (K1).
  it("keeps the Mate's column beside every bubble, 8 px off it", () => {
    const markup = draw(
      record([
        { kind: "note", key: "note:a1", at: at(10), message: message("a1", "assistant", "Hi.") },
      ]),
    );
    // One container holds the chat and its status line, so both keep one gap.
    expect(markup).toMatch(
      /<div class="@container\/chat min-w-0" data-run-chat="true" style="[^"]*"><ol /u,
    );
    const row =
      /<li class="([^"]*)" data-chat-row="true"><span aria-hidden="true" class="([^"]*)"/u.exec(
        markup,
      );
    expect(row?.[1]?.split(" ")).toContain("gap-2");
    expect(row?.[1]).not.toContain("gap-2.5");
    expect(row?.[2]?.split(" ").slice(0, 2)).toEqual(["w-7", "shrink-0"]);
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
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
  });
  afterEach(() => {
    globalThis.ResizeObserver = saved.resize;
    globalThis.requestAnimationFrame = saved.frame;
  });

  const mount = (row: RecordRow) => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
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

  // D4: what a call printed never scrolls inside the card — past twelve lines
  // it folds, and "Show all N lines" opens every line of it in place.
  it("folds a long output past its twelfth line, every line of it a click away", () => {
    const printed = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    const renderer = mount(
      record([
        step(command("w1", "npm test", { callInput: { description: "Test" }, detail: printed })),
      ]),
    );
    act(() => button(renderer, "Test").props.onClick());
    const more = button(renderer, "Show all 30 lines");
    expect(more.props["aria-expanded"]).toBe(false);
    act(() => more.props.onClick());
    expect(button(renderer, "Show less").props["aria-expanded"]).toBe(true);
    const pre = renderer.root.find((node) => node.type === "pre");
    expect(pre.props["data-chat-folded"]).toBe("false");
    expect(JSON.stringify(renderer.toJSON())).toContain("line 30");
  });

  // A run the person comes back to opens folded and keeps everything it said
  // to them (K7, D3): its worked line on top, its words, their words and what
  // it couldn't do under it; its thoughts and calls behind "Show work", which
  // opens them under the line they clicked (K12).
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

    it("opens folded, its words kept and its work behind Show work", () => {
      const markup = draw(settledRun());
      expect(markup).toContain('data-run-fold="folded"');
      // The worked line first: the line the person clicks stands above what opens.
      expect(markup.indexOf("Nova worked 1m 20s")).toBeLessThan(
        markup.indexOf("Should /status be public?"),
      );
      expect(markup).toContain("Yes, no secrets");
      expect(markup).toContain("The deploy was refused");
      expect(markup).not.toContain("Run the tests");
      expect(markup).not.toContain("The route and the check disagree.");
      expect(markup).toMatch(/<button aria-expanded="false" class="run-now-fold"[^>]*>Show work/u);
    });

    it("keeps a run the person watched open, its line at the foot, until they leave", () => {
      setRunFold(CONVERSATION, "turn-1", "watched");
      const markup = draw(settledRun());
      expect(markup).not.toContain("data-run-fold");
      expect(markup).toContain("Run the tests");
      expect(markup.indexOf("Run the tests")).toBeLessThan(markup.indexOf("Nova worked 1m 20s"));
      expect(markup).not.toContain("Show work");
      forgetRunFolds(CONVERSATION);
      expect(draw(settledRun())).toContain('data-run-fold="folded"');
    });

    // Mounted as the page draws it: a markdown note reads the page's storage.
    const workOnly = (overrides: Partial<RecordRow> = {}) =>
      settledRun({
        items: settledRun().items.filter((item) => item.kind !== "note"),
        ...overrides,
      });
    it("marks a run watched while it runs, so it stays open once it settles", () => {
      const renderer = mount(workOnly({ live: true, status: status() }));
      act(() =>
        renderer.update(
          <Rows>
            <RunChat row={workOnly()} />
          </Rows>,
        ),
      );
      expect(text(renderer)).toContain("Run the tests");
      expect(text(renderer)).not.toContain("Show work");
    });

    it("opens the work under its line with Show work, and folds it with Hide work", () => {
      const renderer = mount(workOnly());
      expect(text(renderer)).not.toContain("Run the tests");
      act(() => button(renderer, "Show work").props.onClick());
      expect(text(renderer)).toContain("Run the tests");
      expect(button(renderer, "Hide work").props["aria-expanded"]).toBe(true);
      act(() => button(renderer, "Hide work").props.onClick());
      expect(text(renderer)).not.toContain("Run the tests");
      expect(button(renderer, "Show work").props["aria-expanded"]).toBe(false);
    });

    it("offers no Show work where nothing folds", () => {
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
      expect(markup).not.toContain("Show work");
      expect(markup).toContain("Nothing to do.");
    });
  });

  // D4: what the now line holds is never out of reach while it runs — its
  // one line opens to the whole of it in place: a script's every line, the
  // thought so far; still one clock.
  it("opens the now line to the whole of what runs, one clock still", () => {
    const renderer = mount(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "step",
          step: stepOf(
            command("w9", SCRIPT, {
              callInput: { description: "Write the status route" },
              toolLifecycleStatus: "inProgress",
              updatedAt: undefined as never,
            }),
          ),
        },
      }),
    );
    const words = () =>
      renderer.root.find(
        (node) => node.type === "button" && node.props["data-run-now-words"] !== undefined,
      );
    expect(words().props["aria-expanded"]).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).not.toContain("line 13");
    act(() => words().props.onClick());
    expect(words().props["aria-expanded"]).toBe(true);
    const shown = JSON.stringify(renderer.toJSON());
    expect(shown).toContain("line 13");
    expect(shown).toContain("EOF");
    expect(
      renderer.root.findAll((node) => node.props["data-work-line-clock"] !== undefined),
    ).toHaveLength(1);
  });

  it("opens a thought on the now line to the whole of it so far", () => {
    const thinking = "The app is a Hono server. So the page belongs on the server as its own route";
    const renderer = mount(
      record([], {
        live: true,
        status: status(),
        now: {
          kind: "thinking",
          key: "thought:r9",
          messages: [message("r9", "reasoning", thinking)],
        },
      }),
    );
    const words = renderer.root.find(
      (node) => node.type === "button" && node.props["data-run-now-words"] !== undefined,
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain("The app is a Hono server.");
    act(() => words.props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain(thinking);
  });

  // A control that goes once pressed hands the focus on: the thought's way to
  // the rest to its "Show less" and back, the last "Show N earlier" to the
  // lines it drew — never to the page's body.
  it("keeps the focus on the thought's toggle as it opens and closes", () => {
    // The opened thought is markdown, which reads the page's own storage.
    const savedWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      localStorage: { getItem: () => null, setItem: () => undefined },
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    };
    try {
      const focused: string[] = [];
      let renderer!: ReactTestRenderer;
      act(() => {
        renderer = create(
          <Rows>
            <RunChat row={record([thought("r1", LONG)])} />
          </Rows>,
          {
            createNodeMock: (element) =>
              element.type === "button"
                ? {
                    focus: () =>
                      focused.push(
                        String(
                          (element.props as { "aria-label"?: string })["aria-label"] ?? "Show less",
                        ),
                      ),
                    closest: () => null,
                    isConnected: true,
                    parentElement: null,
                    ownerDocument: { scrollingElement: null },
                    getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
                  }
                : { scrollHeight: 100, clientHeight: 40 },
          },
        );
      });
      act(() => button(renderer, "Line 1").props.onClick());
      expect(focused).toEqual(["Show less"]);
      act(() =>
        button(renderer, "Show less").props.onClick({
          currentTarget: {
            closest: () => null,
            isConnected: true,
            parentElement: null,
            ownerDocument: { scrollingElement: null },
            getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
          },
        }),
      );
      expect(focused.at(-1)).toMatch(/Show the whole thought$/u);
    } finally {
      (globalThis as { window?: unknown }).window = savedWindow;
    }
  });

  it("hands the focus to the lines the last Show N earlier drew", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      step(command(`w${index}`, `echo ${index}`)),
    );
    let listFocused = 0;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Rows>
          <RunChat row={record(many)} />
        </Rows>,
        {
          createNodeMock: (element) =>
            element.type === "ol" ? { focus: () => (listFocused += 1) } : {},
        },
      );
    });
    act(() => button(renderer, "Show 10 earlier").props.onClick());
    expect(listFocused).toBe(1);
  });

  it("draws the earlier bubbles when the person asks for them", () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      step(command(`w${index}`, `echo ${index}`)),
    );
    const renderer = mount(record(many));
    const rows = () =>
      renderer.root.findAll(
        (node) => node.type === "div" && node.props["data-chat-kind"] === "step:command",
      );
    expect(rows()).toHaveLength(40);
    act(() =>
      renderer.root
        .find((node) => node.type === "button" && node.props["data-chat-earlier"] !== undefined)
        .props.onClick({ currentTarget: { closest: () => null } }),
    );
    expect(rows()).toHaveLength(50);
  });

  it("unfolds a folded script in place, and folds it back", () => {
    const renderer = mount(
      record([
        step(command("w1", SCRIPT, { callInput: { description: "Write the status route" } })),
      ]),
    );
    const folded = () =>
      renderer.root.find(
        (node) => node.type === "div" && node.props["data-chat-folded"] !== undefined,
      ).props["data-chat-folded"];
    expect(folded()).toBe("true");
    // The button pressed, as the page has it: no scroll to keep it in.
    const pressed = {
      closest: () => null,
      isConnected: true,
      parentElement: null,
      ownerDocument: { scrollingElement: null },
      getBoundingClientRect: () => ({ top: 0, bottom: 0 }),
    };
    const press = (words: string) =>
      act(() => button(renderer, words).props.onClick({ currentTarget: pressed }));
    press("Show all 16 lines");
    expect(folded()).toBe("false");
    press("Show less");
    expect(folded()).toBe("true");
  });
});
