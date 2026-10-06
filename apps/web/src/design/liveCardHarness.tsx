/**
 * The live card (pass 35), played into the real conversation list: one
 * scripted run of a Mate's, its calls starting and returning, its thoughts
 * streaming, a question it waits on, a deploy and a check in the browser —
 * the board's script — so the live slot, its plops, coalescing bursts and the
 * shared height can be watched and sampled frame by frame.
 *
 * Served by the dev server at `/design-live.html`:
 * - `?script=main` (the default) the board's 36 s run; `burst` six reads in
 *   half a second, then the tests; `stale` a call whose completion never
 *   comes; `band` a stand-up whose builds run on after its call returned;
 *   `long` thirty steps, so the card fills its height, its commands
 *   two lines each, the first with what it printed to open; `edits` two edits in
 *   a row, the second folding into the first as it lands; `cards` three calls
 *   at once, the first returning first, then a new batch;
 * - `?speed=<x>` plays faster or slower, `?at=<s>` starts that far in;
 * - `?theme=dark`; `?provider=claudeAgent` reads no call stale by timing.
 *
 * `window.__liveHarness.restart()` plays it again from the start,
 * `.seconds()` says where it is, for a per-frame sampler, and `.resync(s)`
 * catches it up to `s` seconds as a resync does.
 *
 * Fixtures only, all invented. Nothing here ships — `design-live.html` is not
 * `index.html`, and no route imports this module.
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import * as Stream from "effect/Stream";

import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveDock } from "~/components/chat/conversationDock.logic";
import { KeptTimelines } from "~/components/chat/KeptTimelines";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import type { TimelineEntry, WorkLogEntry } from "~/session-logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import "../index.css";

const params = new URLSearchParams(location.search);
const SPEED = Number(params.get("speed") ?? 1);
const START_AT = Number(params.get("at") ?? 0);
const SCRIPT = params.get("script") ?? "main";
const PROVIDER = params.get("provider") ?? "codex";
const ENVIRONMENT = EnvironmentId.make("environment-harness");
const TURN = TurnId.make("live-turn");
const COMPOSER_HEIGHT = 132;

/** One thing the run does, from `start` to `end` seconds. */
type Item =
  | {
      readonly id: string;
      readonly kind: "thought";
      readonly start: number;
      readonly end: number;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: "read" | "search" | "edit";
      readonly start: number;
      /** Null: its completion never comes. */
      readonly end: number | null;
      readonly name: string;
    }
  | {
      readonly id: string;
      readonly kind: "command";
      readonly start: number;
      readonly end: number | null;
      readonly words: string;
      readonly code: string;
      readonly output?: string;
      readonly fails?: boolean;
      /** Sent to the background, as Claude Code says: the job's id. */
      readonly background?: string;
    }
  | {
      readonly id: string;
      readonly kind: "question";
      readonly start: number;
      readonly end: number;
      readonly text: string;
      readonly answer: string;
    }
  | { readonly id: string; readonly kind: "note"; readonly start: number; readonly text: string }
  | {
      readonly id: string;
      readonly kind: "deploy" | "standup";
      readonly start: number;
      /** When its call returns: a stand-up's returns before its builds end. */
      readonly returns: number;
      readonly end: number;
      readonly subject: string;
      readonly stages: ReadonlyArray<readonly [string, number, number]>;
    }
  | {
      readonly id: string;
      readonly kind: "browser";
      readonly start: number;
      readonly end: number;
      readonly page: string;
    };

interface Run {
  readonly ask: string;
  readonly items: ReadonlyArray<Item>;
  /** When its answer starts streaming, and when the run settles. */
  readonly write: number;
  readonly end: number;
  readonly answer: string;
  /**
   * The person writes into the run at `at`: the turn ends there and the next
   * one starts thinking, as a message sent mid-run does (run 11).
   */
  readonly interrupt?: { readonly at: number; readonly words: string; readonly thought: string };
}

const THOUGHT1 =
  "The admin pages all render on the server, so the status page joins them as one more route behind the same sign-in. I'll read the router first, then the deploy history helper, and keep the page to two rows: how long the app has been up, and its last deploy with the version and when it went out.";
const THOUGHT2 = "The route sits behind the sign-in middleware; the test calls it signed out.";
const BUILD = [
  "pnpm install --frozen-lockfile",
  "pnpm build",
  "node scripts/check-size.js --max 250kb",
  "du -sh dist",
  "ls dist/assets | head -20",
  "echo done",
].join("\n");
const ANSWER =
  "Added `/status`. It shows two rows: how long the app has been up since its last start, and its last deploy, with the version and when it went out. It opens without signing in and shows no secrets.";

const MAIN: Run = {
  ask: "Add a /status page that lists the app's uptime and its last deploy.",
  items: [
    { id: "t1", kind: "thought", start: 0.2, end: 3.2, text: THOUGHT1 },
    { id: "r1", kind: "read", start: 3.4, end: 3.5, name: "src/routes/index.ts" },
    { id: "r2", kind: "read", start: 3.55, end: 3.65, name: "src/lib/deploys.ts" },
    { id: "r3", kind: "read", start: 3.7, end: 3.78, name: "package.json" },
    { id: "s1", kind: "search", start: 3.8, end: 3.9, name: "uptime" },
    { id: "e1", kind: "edit", start: 4.4, end: 4.55, name: "src/routes/status.ts" },
    {
      id: "c1",
      kind: "command",
      start: 4.8,
      end: 7.4,
      words: "Run the tests for the page",
      code: "npm test -- status",
      fails: true,
      output: "1 failing\n\n  GET /status\n    expected 200, got 302",
    },
    { id: "t2", kind: "thought", start: 7.6, end: 8.35, text: THOUGHT2 },
    {
      id: "q1",
      kind: "question",
      start: 9,
      end: 12,
      text: "Should /status be reachable without signing in?",
      answer: "Yes, but show no secrets",
    },
    { id: "e2", kind: "edit", start: 12.3, end: 12.6, name: "src/middleware.ts" },
    {
      id: "c2",
      kind: "command",
      start: 12.8,
      end: 14.6,
      words: "Run the tests for the page",
      code: "npm test -- status",
      output: "4 passing (212 ms)",
    },
    { id: "c3", kind: "command", start: 14.8, end: 21.8, words: "Build the app", code: BUILD },
    {
      id: "c4",
      kind: "command",
      start: 14.85,
      end: 16.95,
      words: "Lint the page",
      code: "npm run lint -- src/routes/status.ts",
      output: "No problems found",
    },
    {
      id: "n1",
      kind: "note",
      start: 22,
      text: "The build needs Node 22, so I moved .nvmrc from 20 to 22.",
    },
    {
      id: "d1",
      kind: "deploy",
      start: 23,
      returns: 31,
      end: 31,
      subject: "appdev",
      stages: [
        ["Building", 23, 27],
        ["Deploying", 27, 29.5],
        ["Starting", 29.5, 31],
      ],
    },
    { id: "b1", kind: "browser", start: 31, end: 33, page: "https://appdev.example.dev/status" },
  ],
  write: 33.5,
  end: 36,
  answer: ANSWER,
};

const BURST: Run = {
  ask: "Check the routes and run the tests.",
  items: [
    ...["a", "b", "c", "d", "e", "f"].map((name, index): Item => ({
      id: `r${index}`,
      kind: "read",
      start: 0.5 + index * 0.08,
      end: 0.5 + index * 0.08 + 0.06,
      name: `src/routes/${name}.ts`,
    })),
    { id: "c1", kind: "command", start: 1.05, end: 7, words: "Run the tests", code: "npm test" },
  ],
  write: 7.5,
  end: 9,
  answer: "The six routes read clean and the tests pass.",
};

const STALE: Run = {
  ask: "Run the tests, then fix the page.",
  items: [
    { id: "c1", kind: "command", start: 0.5, end: null, words: "Run the tests", code: "npm test" },
    { id: "r1", kind: "read", start: 2, end: 2.3, name: "src/routes/status.ts" },
    { id: "e1", kind: "edit", start: 2.6, end: 2.9, name: "src/routes/status.ts" },
    { id: "c2", kind: "command", start: 3.2, end: 6, words: "Build the app", code: "pnpm build" },
    { id: "r2", kind: "read", start: 6.3, end: 6.5, name: "dist/index.html" },
  ],
  write: 7,
  end: 8.5,
  answer: "Fixed the page; the build passes.",
};

const BAND: Run = {
  ask: "Stand the development services up and read the app's log.",
  items: [
    {
      id: "u1",
      kind: "standup",
      start: 0.5,
      returns: 1.5,
      end: 14,
      subject: "development",
      stages: [
        ["appdev", 1.5, 10],
        ["db", 1.5, 14],
      ],
    },
    { id: "r1", kind: "read", start: 2, end: 2.2, name: "zerops.yml" },
    { id: "e1", kind: "edit", start: 2.5, end: 2.8, name: "zerops.yml" },
    { id: "c1", kind: "command", start: 3.2, end: 5, words: "Run the tests", code: "npm test" },
    { id: "r2", kind: "read", start: 5.4, end: 5.6, name: "src/server.ts" },
  ],
  write: 14.5,
  end: 16,
  answer: "Development is up: appdev and db both run.",
};

const LONG: Run = {
  ask: "Tidy the routes, one by one.",
  items: Array.from({ length: 30 }, (_, index): Item =>
    index % 3 === 2
      ? {
          id: `c${index}`,
          kind: "command",
          start: 0.5 + index * 0.9,
          end: 0.5 + index * 0.9 + 0.7,
          words: `Check route ${index}`,
          // Two lines: the block fits its cap, so nothing in it fades.
          code: `npm test -- route-${index}\nnpm run lint -- route-${index}`,
          // The first says what it printed: a call to open while the card
          // is still below its height.
          ...(index === 2
            ? {
                output: Array.from({ length: 6 }, (_, n) => `  ✓ route-2 case ${n + 1}`).join("\n"),
              }
            : {}),
        }
      : {
          id: `r${index}`,
          kind: index % 3 === 0 ? "read" : "edit",
          start: 0.5 + index * 0.9,
          end: 0.5 + index * 0.9 + 0.3,
          name: `src/routes/route-${index}.ts`,
        },
  ),
  write: 28,
  end: 30,
  answer: "Tidied thirty routes.",
};

/** Two edits in a row, then a command: the second folds into the first once it lands. */
const EDITS: Run = {
  ask: "Fix the two routes.",
  items: [
    { id: "e1", kind: "edit", start: 0.5, end: 0.8, name: "src/routes/status.ts" },
    { id: "e2", kind: "edit", start: 1.2, end: 1.5, name: "src/routes/health.ts" },
    { id: "c1", kind: "command", start: 2.6, end: 5, words: "Run the tests", code: "npm test" },
  ],
  write: 5.5,
  end: 7,
  answer: "Fixed both routes; the tests pass.",
};

/**
 * Three commands at once, the first returning first while the others run on,
 * a read 0.1 s after it lands, then a new batch: the card keeps its rows.
 */
const CARDS: Run = {
  ask: "Run the checks.",
  items: [
    { id: "c1", kind: "command", start: 0.5, end: 1.5, words: "Lint the app", code: "pnpm lint" },
    { id: "c2", kind: "command", start: 0.55, end: 4, words: "Run the tests", code: "pnpm test" },
    { id: "c3", kind: "command", start: 0.6, end: 4.2, words: "Build the app", code: "pnpm build" },
    { id: "r1", kind: "read", start: 1.6, end: 1.7, name: "package.json" },
    { id: "c4", kind: "command", start: 5.2, end: 6.5, words: "Check sizes", code: "du -sh dist" },
  ],
  write: 7,
  end: 8.5,
  answer: "Lint, tests and build pass.",
};

/**
 * Photos sent to the background, the menu page wired meanwhile, a build
 * running — then the person writes into the run (Rhea, run 11: the card was
 * cut off at its bottom as the next run began).
 */
const INTERRUPT: Run = {
  ask: "Make photos for the six recipe pages and add them to the menu page.",
  items: [
    {
      id: "t1",
      kind: "thought",
      start: 0.3,
      end: 1.5,
      text: "Six photos take a while: I'll send them to the background and wire the menu meanwhile.",
    },
    {
      id: "c1",
      kind: "command",
      start: 1.8,
      end: 2.2,
      words: "Generate the remaining six recipe photos",
      code: "python make_photos.py --all",
      background: "bg-photos",
    },
    { id: "r1", kind: "read", start: 2.6, end: 2.8, name: "src/pages/menu.tsx" },
    { id: "e1", kind: "edit", start: 3.2, end: 3.6, name: "src/pages/menu.tsx" },
    {
      id: "n1",
      kind: "note",
      start: 4.2,
      text: "Adding the photos to the menu page while they render.",
    },
    { id: "c2", kind: "command", start: 5, end: null, words: "Build the site", code: "pnpm build" },
  ],
  write: 1000,
  end: 14,
  answer: "",
  interrupt: {
    at: 7,
    words: "could the desserts get a darker background?",
    thought: "The person asks for a darker background behind the desserts.",
  },
};

const RUN: Run =
  {
    main: MAIN,
    burst: BURST,
    stale: STALE,
    band: BAND,
    long: LONG,
    edits: EDITS,
    cards: CARDS,
    interrupt: INTERRUPT,
  }[SCRIPT] ?? MAIN;

/** The turn the person's message starts, in the interrupt script. */
const TURN2 = TurnId.make("live-turn-2");

/** The run started this long before the page loaded, so its clock reads as it would live. */
const STARTED = Date.now() - START_AT * 1000;
const iso = (second: number) => new Date(STARTED + second * 1000).toISOString();

function work(id: string, start: number, fields: Partial<WorkLogEntry>): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: iso(start),
    entry: {
      id,
      createdAt: iso(start),
      startedAt: iso(start),
      turnId: TURN,
      toolCallId: `call-${id}`,
      label: "Tool call",
      tone: "tool",
      ...fields,
    },
  };
}

const TOOL: Record<"read" | "search" | "edit", { readonly name: string; readonly field: string }> =
  {
    read: { name: "Read", field: "file_path" },
    search: { name: "Grep", field: "pattern" },
    edit: { name: "Edit", field: "file_path" },
  };

/** A call at `t`: running from its start, returned at its end. */
function callEntry(
  item: Extract<Item, { kind: "read" | "search" | "edit" | "command" }>,
  t: number,
) {
  const returned = item.end !== null && t >= item.end;
  const status = returned
    ? item.kind === "command" && item.fails
      ? ("failed" as const)
      : ("completed" as const)
    : ("inProgress" as const);
  const lifecycle = {
    toolLifecycleStatus: status,
    sourceActivityKind: returned ? ("tool.completed" as const) : ("tool.started" as const),
    ...(returned ? { updatedAt: iso(item.end!) } : {}),
  };
  if (item.kind === "command") {
    return work(item.id, item.start, {
      label: "Command run",
      itemType: "command_execution",
      command: item.code,
      callInput: { description: item.words },
      ...lifecycle,
      ...(returned && item.output !== undefined ? { detail: item.output } : {}),
      ...(returned && item.fails ? { tone: "tool" } : {}),
      ...(returned && item.background !== undefined ? { sentToBackground: item.background } : {}),
    });
  }
  const tool = TOOL[item.kind];
  return work(item.id, item.start, {
    itemType: item.kind === "edit" ? "file_change" : "dynamic_tool_call",
    detail: `${tool.name}: ${JSON.stringify({ [tool.field]: item.name })}`,
    callInput: item.kind === "search" ? { pattern: item.name } : { filePath: item.name },
    ...(item.kind === "edit" ? { changedFiles: [item.name] } : {}),
    ...lifecycle,
  });
}

function operationEntry(
  item: Extract<Item, { kind: "deploy" | "standup" | "browser" }>,
  t: number,
) {
  const settled = t >= item.end;
  const returned = item.kind === "browser" ? settled : t >= item.returns;
  const steps =
    item.kind === "browser"
      ? []
      : item.stages.map(([label, from, to]) => ({
          id: label,
          label,
          state:
            t >= to ? ("done" as const) : t >= from ? ("running" as const) : ("queued" as const),
          stateLabel: t >= to ? "Done" : t >= from ? label : "Waiting",
        }));
  const subject = item.kind === "browser" ? item.page : item.subject;
  const operation: ZeropsOperation = {
    key: `op:${item.id}`,
    kind: item.kind,
    // A stand-up's call settles it as its report said, its builds running on.
    phase: settled || (item.kind === "standup" && returned) ? "done" : "running",
    anchorAt: iso(item.start),
    anchorActivityId: `activity-${item.id}`,
    ...(settled ? { settledAt: iso(item.end) } : {}),
    ...(returned ? { returnedAt: iso(item.kind === "browser" ? item.end : item.returns) } : {}),
    turnId: TURN,
    subject,
    kicker: item.kind === "deploy" ? `Deploy · ${subject}` : subject,
    voice:
      item.kind === "deploy"
        ? `Deploying ${subject}`
        : item.kind === "standup"
          ? `Standing ${subject} up`
          : `Checking ${subject}`,
    voiceSource: "mate",
    statusWord: settled
      ? item.kind === "deploy"
        ? "Deployed"
        : item.kind === "standup"
          ? "Stood up"
          : "Checked"
      : "Working",
    steps,
    links: [],
    callIds: [`call-${item.id}`],
    target: { hostname: item.kind === "browser" ? "appdev" : subject },
    hasResult: returned,
    ...(item.kind === "deploy" && settled ? { version: { id: "v-12", name: "v0.1.2" } } : {}),
  };
  return {
    id: `zerops:op:${item.id}`,
    kind: "operation" as const,
    createdAt: iso(item.start),
    operation,
  };
}

function message(
  id: string,
  role: "assistant" | "reasoning" | "user",
  at: number,
  text: string,
  streaming = false,
  turnId: TurnId = TURN,
): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: iso(at),
    message: {
      id: MessageId.make(id),
      role,
      text,
      turnId: role === "user" ? null : turnId,
      createdAt: iso(at),
      updatedAt: iso(at),
      streaming,
    },
  };
}

/** An earlier exchange over the run, so the list scrolls and follows its end, as a long conversation does. */
const EARLIER: ReadonlyArray<TimelineEntry> = [
  message("earlier-ask", "user", -600, "What does the admin area have today?"),
  message(
    "earlier-answer",
    "assistant",
    -590,
    Array.from(
      { length: 14 },
      (_, index) =>
        `- **Page ${index + 1}** renders on the server behind the sign-in, reads its rows from the database and caches them for a minute.`,
    ).join("\n"),
    false,
    TurnId.make("earlier-turn"),
  ),
];

/** The run's timeline at `t` seconds in. */
function entriesAt(t: number): TimelineEntry[] {
  const entries: TimelineEntry[] = [...EARLIER, message("ask", "user", 0, RUN.ask)];
  for (const item of RUN.items) {
    if (t < item.start) continue;
    switch (item.kind) {
      case "thought": {
        const shown = Math.min(1, (t - item.start) / Math.max(0.1, item.end - item.start));
        const text = item.text.slice(0, Math.max(1, Math.round(item.text.length * shown)));
        entries.push(message(item.id, "reasoning", item.start, text, t < item.end));
        break;
      }
      case "read":
      case "search":
      case "edit":
      case "command":
        entries.push(callEntry(item, t));
        break;
      case "note":
        entries.push(message(item.id, "assistant", item.start, item.text));
        break;
      case "question":
        entries.push(
          work(item.id, item.start, {
            tone: "info",
            label: "User input requested",
            toolCallId: undefined as never,
            sourceActivityKind: "user-input.requested",
            inputRequestId: `request-${item.id}`,
            inputQuestions: [{ id: item.id, header: "Sign-in", question: item.text }],
          }),
        );
        if (t >= item.end) {
          entries.push(
            work(`${item.id}-answer`, item.end, {
              tone: "info",
              label: "User input submitted",
              toolCallId: undefined as never,
              sourceActivityKind: "user-input.resolved",
              inputRequestId: `request-${item.id}`,
              inputAnswers: [{ key: item.id, answer: item.answer }],
            }),
          );
        }
        break;
      case "deploy":
      case "standup":
      case "browser":
        entries.push(operationEntry(item, t));
        break;
    }
  }
  if (RUN.interrupt !== undefined && t >= RUN.interrupt.at) {
    const { at, words, thought } = RUN.interrupt;
    entries.push(message("interrupt", "user", at, words));
    if (t >= at + 0.5) {
      const shown = Math.min(1, (t - at - 0.5) / 2);
      const text = thought.slice(0, Math.max(1, Math.round(thought.length * shown)));
      entries.push(message("t2-thought", "reasoning", at + 0.5, text, shown < 1, TURN2));
    }
  }
  if (t >= RUN.write) {
    const shown = Math.min(1, (t - RUN.write) / Math.max(0.1, RUN.end - RUN.write));
    entries.push(
      message(
        "answer",
        "assistant",
        RUN.write,
        RUN.answer.slice(0, Math.max(1, Math.round(RUN.answer.length * shown))),
        t < RUN.end,
      ),
    );
  }
  return entries.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** The harness's clock: seconds into the run, at `SPEED`. */
function useRunClock(): readonly [number, () => void, (to: number) => void] {
  const [origin, setOrigin] = useState(() => performance.now() - (START_AT * 1000) / SPEED);
  const [seconds, setSeconds] = useState(START_AT);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const next = Math.min(RUN.end + 2, ((performance.now() - origin) * SPEED) / 1000);
      // A tenth of a second at a time: the run's facts change no faster.
      setSeconds((current) =>
        Math.floor(next * 20) === Math.floor(current * 20) ? current : next,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [origin]);
  const restart = useCallback(() => {
    setOrigin(performance.now());
    setSeconds(0);
  }, []);
  // A jump forward, as a resync catches a thread up.
  const jump = useCallback((to: number) => {
    setOrigin(performance.now() - (to * 1000) / SPEED);
    setSeconds(to);
  }, []);
  return [seconds, restart, jump];
}

const keptForever = () => true;
const readsNothing = () => null;

function Pane() {
  const [seconds, restart, jump] = useRunClock();
  const [epoch, setEpoch] = useState(0);
  // A resync: the thread catches up while `syncing`, then settles.
  const [syncing, setSyncing] = useState(false);
  const listRef = useRef<LegendListRef | null>(null);
  useEffect(() => {
    (window as unknown as { __liveHarness: unknown }).__liveHarness = {
      restart: () => {
        setEpoch((current) => current + 1);
        restart();
      },
      seconds: () => seconds,
      resync: (to: number) => {
        setSyncing(true);
        jump(to);
        setTimeout(() => setSyncing(false), 300);
      },
    };
  }, [jump, restart, seconds]);
  const step = Math.floor(seconds * 20) / 20;
  const ended = step >= RUN.end && RUN.interrupt === undefined;
  // Written into: the first turn is over, the next one runs.
  const second = RUN.interrupt !== undefined && step >= RUN.interrupt.at + 0.5;
  const entries = useMemo(() => entriesAt(step), [step]);
  const latestTurn = useMemo(
    () =>
      second
        ? {
            turnId: TURN2,
            state: "running" as const,
            startedAt: iso(RUN.interrupt!.at + 0.5),
            completedAt: null,
          }
        : {
            turnId: TURN,
            state: ended ? ("completed" as const) : ("running" as const),
            startedAt: iso(0),
            completedAt: ended ? iso(RUN.end) : null,
          },
    [ended, second],
  );
  const dock = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking: !ended,
        runningTurnId: ended ? null : second ? TURN2 : TURN,
        agentPanelModel: emptyAgentPanelModel(),
        plan: null,
        pause: null,
      }),
    [entries, ended],
  );
  const routeThreadKey = `${ENVIRONMENT}:live-${epoch}`;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <KeptTimelines
          open={routeThreadKey}
          alive={keptForever}
          Reader={readsNothing}
          crewTimeline={null}
          timeline={{
            isWorking: !ended,
            activeTurnStartedAt: ended ? null : second ? iso(RUN.interrupt!.at + 0.5) : iso(0),
            listRef,
            timelineEntries: entries,
            latestTurn,
            runningTurnId: ended ? null : second ? TURN2 : TURN,
            turnDiffSummaries: [],
            working: dock,
            routeThreadKey,
            onOpenTurnDiff: () => undefined,
            supportsConversationRollback: false,
            // Its calls name no response: Codex's timing rule reads its
            // batches, unless `?provider=claudeAgent` (nothing goes stale).
            provider: PROVIDER,
            onRevertToTurnCount: () => undefined,
            isRevertingCheckpoint: false,
            onImageExpand: () => undefined,
            activeThreadEnvironmentId: ENVIRONMENT,
            markdownCwd: undefined,
            resolvedTheme: appearance,
            timestampFormat: "locale",
            workspaceRoot: undefined,
            anchorMessageId: null,
            onAnchorReady: () => undefined,
            contentInsetEndAdjustment: COMPOSER_HEIGHT,
            liveFollowEnabled: true,
            onIsAtEndChange: () => undefined,
            onPersonInput: () => undefined,
            onManualNavigation: () => undefined,
            hideEmptyPlaceholder: false,
            loading: false,
            syncing,
            topFadeEnabled: true,
          }}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pt-2"
        style={{ height: COMPOSER_HEIGHT }}
      >
        <div
          className="mx-auto max-w-3xl rounded-3xl border border-border bg-card shadow-sm"
          style={{ height: COMPOSER_HEIGHT - 20 }}
        />
      </div>
      <p
        className="absolute top-2 right-4 z-30 font-mono text-muted-foreground text-xs tabular-nums"
        data-live-harness-clock
      >
        {SCRIPT} · {seconds.toFixed(1)} s
      </p>
    </div>
  );
}

function Harness() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* A phone's width shows the conversation alone, as the app does. */}
      <aside
        className="flex shrink-0 flex-col gap-1 border-border border-r p-4 max-md:hidden"
        style={{ width: 435 }}
      >
        <p className="pb-2 text-muted-foreground text-xs">The live card · {SCRIPT}</p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <WorkspacePageHeader
          className="relative bg-background font-medium text-sm"
          data-chat-header
        >
          Nova
        </WorkspacePageHeader>
        <Pane />
      </main>
    </div>
  );
}

/** The markdown's commands ask the account's grant what they may do: stand-ins that answer nothing. */
function Standins({ children }: { readonly children: ReactNode }) {
  const inventory: Inventory = {
    projects: [],
    isLoading: false,
    error: null,
    projectRefs: new Map(),
    authority: new Map(),
    account: { kind: "authorized" },
    lost: new Set(),
  };
  const data: ZeropsDataContextValue = {
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

const appearance = params.get("theme") === "dark" ? "dark" : "light";
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
