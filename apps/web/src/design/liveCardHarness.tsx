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
 *   at once, the first returning first, then a new batch; `smooth` every way
 *   the card's edges move — a thought growing line by line, a call taking its
 *   place, a command whose body arrives seconds after its pill, then the same
 *   once the card stands at its full height; `ten` ten quick calls of every
 *   kind inside two seconds, then calm; `board` the approved board's run
 *   (a ledger of thoughts, commands, a tool and what the Mate said, a command
 *   of six lines running at 13 s to 17.5 s, one of fifteen to open at 22 s);
 *   `reads` ten reads inside two seconds between two thoughts, the board's
 *   burst; `deep` a run forty minutes in, `?steps=<n>` rows in its log (300)
 *   that never fold, its working row changing every second or so (`?joins=<n>`
 *   for that many earlier lines joining the front of its log 17.5 s in, as a
 *   page of them read in late; `?leaves=<n>` for its first lines leaving it
 *   then); `send` a conversation at its end
 *   under a finished run, the person's message sent a second in (`?draft=<px>`
 *   for a draft that tall, which the composer gives back as it goes; `?ack=<s>`
 *   for how long the card stands on its head alone; `?short` for a
 *   conversation that begins with that run, shorter than the page until the
 *   new card outgrows it; `?watched` for that run played to its end here
 *   first, its answer landing three seconds before the send; `?left` for a
 *   conversation left mid-read before, which opens not following its end —
 *   at a row since gone, or at `?leftrow=<row id>`; `?crew` for a crew
 *   thread's send, whose message and card the engine writes a moment after
 *   it; `?long=<n>` for that many turns above, the list long and virtual);
 * - `?speed=<x>` plays faster or slower, `?at=<s>` starts that far in;
 * - `?theme=dark`; `?provider=claudeAgent` reads no call stale by timing.
 *
 * `window.__liveHarness.restart()` plays it again from the start,
 * `.seconds()` says where it is, for a per-frame sampler, `.resync(s)`
 * catches it up to `s` seconds as a resync does, `.follows()` says whether
 * the conversation follows its end and `.followLog()` what turned that on or
 * off, as ChatView judges it.
 *
 * Fixtures only, all invented. Nothing here ships — `design-live.html` is not
 * `index.html`, and no route imports this module.
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { AccountScope } from "@t3tools/client-runtime/zerops/data";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import type {
  PipelineReadout,
  PipelineStepId,
} from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import {
  standupReadingOf,
  type StandupReading,
} from "@t3tools/client-runtime/zerops/activity/standupReading";
import { StandupReadings } from "~/zerops/activity/useStandupReading";
import {
  HandedOperationCardContext,
  type OperationCardRegions,
} from "~/zerops/activity/useOperationCard";
import { ZeropsBuildLog } from "~/components/zerops/ZeropsBuildLog";

import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { nextTimelineFollow } from "@t3tools/client-runtime/zerops/timelineFollow";
import { deriveDock } from "~/components/chat/conversationDock.logic";
import { KeptTimelines } from "~/components/chat/KeptTimelines";
import {
  readTimelinePosition,
  rememberTimelinePosition,
} from "~/components/chat/timelineScrollAnchoring";
import type { MessagesTimeline } from "~/components/chat/MessagesTimeline";
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
/** How much taller the composer stands with the draft the person sends (`send`). */
const DRAFT = Number(params.get("draft") ?? 0);
/** How long the card stands on its head alone after a send, before the run's first thing. */
const ACK = Number(params.get("ack") ?? 1.5);
/** A conversation that begins with the run before the send: shorter than the page until its card grows. */
const SHORT = params.has("short");
/** The run before the send is watched to its end here, its answer landing under the person's eyes. */
const WATCHED = params.has("watched");
/** When the person sends (`send`): a second in, or once the watched run before it has settled. */
const SEND_AT = WATCHED ? 6 : 1;
/** When the watched run before the send ends. */
const BEFORE_END = 3;
/** The conversation was left mid-read before: it opens not following its end. */
const LEFT = params.has("left");
/**
 * `?crew`: the send is a crew thread's — it makes no row of its own; its
 * message and its run's card come from the engine a moment later.
 */
const CREW = params.has("crew");
/** `?long=N`: N turns stand above the one before the send, so the list is long and virtualized. */
const TURNS_ABOVE = Number(params.get("long") ?? 0);
/** `?steps=<n>`: how many rows the `deep` run's log holds as it opens. */
const STEPS = Math.max(2, Number(params.get("steps") ?? 300));
/** `?joins=<n>`: that many earlier lines join the front of the `deep` run's log, 17.5 s in. */
const JOINS = Math.max(0, Number(params.get("joins") ?? 0));
/** `?leaves=<n>`: the `deep` run's first lines, that many, leave its log 17.5 s in. */
const LEAVES = Math.max(0, Number(params.get("leaves") ?? 0));
/** `?services=3|7`: the `batch` run deploys that many services instead of its two. */
const BATCH_SIZE = Number(params.get("services") ?? 2);
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
      /** When its command is known: until then it is a call that says nothing of itself. */
      readonly codeAt?: number;
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
      /** A tool called by its name: neither a file's nor a command. */
      readonly id: string;
      readonly kind: "tool";
      readonly start: number;
      readonly end: number;
      readonly tool: string;
    }
  | {
      readonly id: string;
      readonly kind: "deploy" | "standup";
      readonly start: number;
      /** When its call returns: a stand-up's returns before its builds end. */
      readonly returns: number;
      readonly end: number;
      readonly subject: string;
      readonly stages: ReadonlyArray<readonly [string, number, number]>;
      /** A deploy's pipeline as its card reads it of the platform: each step, from when to when. */
      readonly pipeline?: ReadonlyArray<readonly [PipelineStepId, number, number]>;
      /** A batch deploy's services, each with the pipeline its own version runs. */
      readonly services?: ReadonlyArray<BatchService>;
      /** Where what it deployed answers, once it is out. */
      readonly address?: string;
    }
  | {
      readonly id: string;
      readonly kind: "browser";
      readonly start: number;
      readonly end: number;
      readonly page: string;
    };

/** A batch deploy's service: the pipeline its own version runs, and where it broke if it did. */
interface BatchService {
  readonly name: string;
  readonly pipeline: ReadonlyArray<readonly [PipelineStepId, number, number]>;
  /** Its last listed step fails as it ends, saying this. */
  readonly fails?: string;
}

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
  /**
   * The person sends its ask at `sendAt`, the conversation standing at its end
   * under a run that finished before: until then nothing runs.
   */
  readonly sendAt?: number;
  /** When it began, where that was before the page opened: its clock counts from there. */
  readonly from?: number;
  /**
   * Its entries at `t`, where the items above do not say them (`deep`): the
   * same array while nothing happened, the same entry while it did not
   * change — as a conversation's store hands them on.
   */
  readonly entries?: (t: number) => TimelineEntry[];
  /** What happened last by `t`, as a key: the harness draws again only when it changes. */
  readonly eventKey?: (t: number) => string;
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

/**
 * A deploy at the platform's own pace, then a command: `at=120` stands on its build in the working
 * row, `at=300` on its line in the log, which opens onto its steps, the way to its log and where
 * it answers.
 */
const DEPLOY: Run = {
  ask: "Put the fix on stage and check it.",
  items: [
    { id: "n1", kind: "note", start: 1, text: "Deploying the fix to shopstage now." },
    {
      id: "d1",
      kind: "deploy",
      start: 2,
      returns: 289,
      end: 289,
      subject: "shopstage",
      stages: [
        ["Building", 2, 232],
        ["Deploying", 232, 289],
      ],
      pipeline: [
        ["INIT_BUILD_CONTAINER", 8, 22],
        ["RUN_BUILD_COMMANDS", 22, 238],
        ["DEPLOY", 238, 289],
      ],
      address: "shopstage-39ae-3000.example.app",
    },
    {
      id: "c1",
      kind: "command",
      start: 291,
      end: 900,
      words: "Run the smoke tests on shopstage",
      code: 'ssh shopstage "cd /var/www && npm run smoke"',
    },
  ],
  write: 905,
  end: 910,
  answer: "The fix is on stage and the smoke tests pass.",
};

const TWO_SERVICES: ReadonlyArray<BatchService> = [
  {
    name: "shoppool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 20],
      ["RUN_BUILD_COMMANDS", 20, 26],
      ["INIT_PREPARE_CONTAINER", 26, 55],
      ["RUN_PREPARE_COMMANDS", 55, 82],
      ["DEPLOY", 82, 112],
    ],
  },
  {
    name: "shopstage",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 10, 22],
      ["RUN_BUILD_COMMANDS", 22, 66],
      ["DEPLOY", 66, 120],
    ],
  },
];

/**
 * Seven services, made up: at `at=4` all wait; at `at=40` geopool is out, apipool deploys,
 * edgepool builds, embedderpool prepares its runtime, runnerpool deploys, sitepool's build broke
 * at 31 s, and webpool waits until 56 s (zerops.yml read until 60 s); at `at=130` all but sitepool
 * are out.
 */
const SEVEN_SERVICES: ReadonlyArray<BatchService> = [
  {
    name: "apipool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 20],
      ["RUN_BUILD_COMMANDS", 20, 34],
      ["DEPLOY", 34, 48],
    ],
  },
  {
    name: "edgepool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 10, 22],
      ["RUN_BUILD_COMMANDS", 22, 66],
      ["DEPLOY", 66, 90],
    ],
  },
  {
    name: "embedderpool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 8, 14],
      ["RUN_BUILD_COMMANDS", 14, 24],
      ["INIT_PREPARE_CONTAINER", 24, 30],
      ["RUN_PREPARE_COMMANDS", 30, 55],
      ["DEPLOY", 55, 80],
    ],
  },
  {
    name: "geopool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 15],
      ["RUN_BUILD_COMMANDS", 15, 22],
      ["DEPLOY", 22, 33],
    ],
  },
  {
    name: "webpool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 60, 70],
      ["RUN_BUILD_COMMANDS", 70, 96],
      ["DEPLOY", 96, 118],
    ],
  },
  {
    name: "sitepool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 18],
      ["RUN_BUILD_COMMANDS", 18, 31],
    ],
    fails:
      "npm run build exited with code 1: cannot find module './uptime' in src/routes/status.ts.",
  },
  {
    name: "runnerpool",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 14],
      ["RUN_BUILD_COMMANDS", 14, 25],
      ["DEPLOY", 25, 60],
    ],
  },
];

/**
 * Three services, one with a long name: at `at=40` webstage deploys, apistage builds and the
 * long-named worker waits.
 */
const THREE_SERVICES: ReadonlyArray<BatchService> = [
  {
    name: "webstage",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 9, 20],
      ["RUN_BUILD_COMMANDS", 20, 34],
      ["DEPLOY", 34, 48],
    ],
  },
  {
    name: "apistage",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 10, 22],
      ["RUN_BUILD_COMMANDS", 22, 66],
      ["DEPLOY", 66, 90],
    ],
  },
  {
    name: "notificationsworkerstagereplica",
    pipeline: [
      ["INIT_BUILD_CONTAINER", 60, 70],
      ["RUN_BUILD_COMMANDS", 70, 96],
      ["DEPLOY", 96, 118],
    ],
  },
];

/** `?services=`: two (the default), three or seven. */
const BATCH_SERVICES =
  BATCH_SIZE === 7 ? SEVEN_SERVICES : BATCH_SIZE === 3 ? THREE_SERVICES : TWO_SERVICES;
const BATCH_SUBJECT = BATCH_SERVICES.map((service) => service.name).join(", ");

/**
 * One call deploying two services, each at its own pace and with its own steps: `at=4` both wait,
 * `at=7` the platform reads their zerops.yml, `at=30` and `at=70` they are at different steps (one
 * pipeline has no prepare steps), `at=130` both are out. `?services=3|7` deploys more
 * (`SEVEN_SERVICES` says when each stands where).
 */
const BATCH: Run = {
  ask: "Put the fix on the pool and on stage.",
  items: [
    { id: "n1", kind: "note", start: 1, text: `Deploying the fix to ${BATCH_SUBJECT} now.` },
    {
      id: "d1",
      kind: "deploy",
      start: 2,
      returns: 120,
      end: 120,
      subject: BATCH_SUBJECT,
      stages: [
        ["Building", 2, 80],
        ["Deploying", 80, 120],
      ],
      services: BATCH_SERVICES,
    },
    {
      id: "c1",
      kind: "command",
      start: 122,
      end: 600,
      words: "Run the smoke tests on shopstage",
      code: 'ssh shopstage "cd /var/www && npm run smoke"',
    },
  ],
  write: 605,
  end: 610,
  answer: "The fix is on the pool and on stage.",
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

const THOUGHT3 =
  "The route reads the deploy history on every request. That is a query a page view: fine for an admin page, wasteful for one a monitor polls every few seconds. A minute's cache in the helper keeps it to one read, and the page says how old its answer is so nobody reads a stale row as live. The helper already has a cache for the release list; the status rows can share its key space under their own prefix.";
const SIZES = [
  "pnpm build",
  "du -sh dist",
  "ls dist/assets | wc -l",
  "gzip -9 -c dist/app.js | wc -c",
  "echo done",
].join("\n");

/** A thought and a two-line command, `at` seconds in: what fills the card to its height. */
function pair(index: number, at: number): ReadonlyArray<Item> {
  return [
    {
      id: `ft${index}`,
      kind: "thought",
      start: at,
      end: at + 0.5,
      text: `Route ${index} still reads the history twice: once for the row, once for its age.`,
    },
    {
      id: `fc${index}`,
      kind: "command",
      start: at + 0.6,
      end: at + 1.1,
      words: `Check route ${index}`,
      code: `npm test -- route-${index}\nnpm run lint -- route-${index}`,
    },
  ];
}

/**
 * Every way the card's edges move, twice: while it still grows on the page,
 * and once it stands at its full height and the history gives the slot its
 * room. A thought gaining a line at a time, a call taking its place (the
 * history arriving with its first line), a command that is a pill for a
 * second and a half before its five lines arrive, a thought after it, then
 * the run's end.
 */
const SMOOTH: Run = {
  ask: "Cache the status page's deploy history for a minute.",
  items: [
    { id: "t1", kind: "thought", start: 0.3, end: 3.3, text: THOUGHT3 },
    { id: "r1", kind: "read", start: 3.5, end: 3.7, name: "src/lib/deploys.ts" },
    {
      id: "c1",
      kind: "command",
      start: 4.3,
      end: 7.3,
      codeAt: 5.8,
      words: "Measure the bundle",
      code: SIZES,
      output: "184K\tdist\n      12\n   61204\ndone",
    },
    { id: "t2", kind: "thought", start: 7.5, end: 8.6, text: THOUGHT2 },
    ...[0, 1, 2, 3].flatMap((index) => pair(index, 9 + index * 1.4)),
    { id: "t3", kind: "thought", start: 14.8, end: 17.8, text: THOUGHT3 },
    { id: "r2", kind: "read", start: 18, end: 18.2, name: "src/lib/cache.ts" },
    {
      id: "c2",
      kind: "command",
      start: 18.8,
      end: 21.8,
      codeAt: 20.3,
      words: "Measure the bundle",
      code: SIZES,
      output: "184K\tdist\n      12\n   61204\ndone",
    },
    { id: "t4", kind: "thought", start: 22, end: 23, text: THOUGHT2 },
  ],
  write: 23.5,
  end: 25.5,
  answer: ANSWER,
};

/**
 * Ten quick calls inside two seconds — reads, searches, edits, one-line
 * commands, a fifth of a second apart — then calm: a thought, and one command
 * that runs a while (the owner, 2026-11-10: "sometimes it pumps out 10 rows in
 * two seconds"). Every edge keeps one way through it.
 */
const TEN: Run = {
  ask: "Find where the deploy history is read and tidy it.",
  items: [
    ...(
      [
        ["read", "src/lib/deploys.ts"],
        ["read", "src/lib/cache.ts"],
        ["search", "deployHistory"],
        ["edit", "src/lib/deploys.ts"],
        ["command", "npm run lint -- src/lib"],
        ["read", "src/routes/status.ts"],
        ["edit", "src/routes/status.ts"],
        ["read", "src/routes/index.ts"],
        ["search", "readHistory"],
        ["command", "npm test -- deploys"],
      ] as const
    ).map(([kind, name], index): Item => {
      const start = 0.5 + index * 0.2;
      return kind === "command"
        ? { id: `q${index}`, kind, start, end: start + 0.15, words: "Check it", code: name }
        : { id: `q${index}`, kind, start, end: start + 0.12, name };
    }),
    { id: "t1", kind: "thought", start: 3.4, end: 5, text: THOUGHT2 },
    { id: "c1", kind: "command", start: 5.3, end: 8, words: "Build the app", code: "pnpm build" },
  ],
  write: 8.5,
  end: 10.5,
  answer: "The history is read in one place now, and the page says how old its answer is.",
};

/**
 * The person's message sent with the conversation at its end, a finished run
 * over it: the card that starts under it grows past the composer's top, and
 * the conversation is to follow it there.
 */
const SENT = SEND_AT + ACK;
const SEND: Run = {
  ask: "Now cache its deploy history for a minute.",
  sendAt: SEND_AT,
  items: [
    { id: "t1", kind: "thought", start: SENT, end: SENT + 2, text: THOUGHT1 },
    { id: "r1", kind: "read", start: SENT + 2.2, end: SENT + 2.4, name: "src/lib/deploys.ts" },
    { id: "e1", kind: "edit", start: SENT + 2.9, end: SENT + 3.2, name: "src/lib/deploys.ts" },
    {
      id: "c1",
      kind: "command",
      start: SENT + 3.6,
      end: SENT + 5.6,
      words: "Measure the bundle",
      code: SIZES,
      output: "184K\tdist\n      12\n   61204\ndone",
    },
    { id: "t2", kind: "thought", start: SENT + 5.8, end: SENT + 6.8, text: THOUGHT2 },
    { id: "e2", kind: "edit", start: SENT + 7, end: SENT + 7.3, name: "src/routes/status.ts" },
  ],
  write: SENT + 7.8,
  end: SENT + 10,
  answer: ANSWER,
};

/**
 * The approved board's run ("one quiet log, one loud now"): a thought, a
 * command, a thought, three quick commands, a tool, what the Mate says, a
 * thought, a command — then a command of six lines that runs from 13 s to
 * 17.5 s (`?at=17&speed=0.0001` stands on it), two edits, a command of
 * fifteen lines to open, and a long thought before the answer.
 */
const BOARD_THOUGHT_ROUTE =
  "The shop keeps one route file per page and a loader beside it. A status page fits the same pattern, so nothing new has to be invented: one route, one loader, one entry in the footer's list of links, and the tests that go with them.";
const BOARD_THOUGHT_TESTS =
  "The tests pin the route's shape, so the page should read it through the same loader the other pages use. That keeps one place to change if a fourth check is ever added, and the page's own test stays small.";
const BOARD_THOUGHT_ROWS =
  "The status route reports three checks: orders, payments and the catalogue. The page can show one row for each with the time of its last check, and say in plain words when one of them is failing instead of printing a code.";
const BOARD_THOUGHT_FOOTER =
  "The footer test counted three links and the page adds a fourth, so two of the status tests still expect the old footer. I'm updating them to expect four links rather than loosening the check, so a link that goes missing later still fails. The page's own test passes with the three rows. After that I'll open the page once with real data, to see orders, payments and the catalogue each say when they were last checked, and then open the change for you to review.";
const BOARD_READ = [
  "for f in src/routes/status.ts src/routes/status.test.ts; do",
  `  echo "== $f"; sed -n '1,120p' "$f"`,
  "done",
  'grep -rn "statusRoute\\|lastChecked" src \\',
  "  --include='*.ts' --include='*.tsx' | head -20",
  "sed -n '1,40p' src/routes/index.ts",
].join("\n");
const BOARD_ADD = [
  "python3 - <<'EOF'",
  "import re",
  "p = 'src/components/Footer.tsx'",
  "s = open(p).read()",
  "s = s.replace(",
  `    '<a href="/contact">Contact</a>',`,
  String.raw`    '<a href="/contact">Contact</a>\n      <a href="/status">Status</a>',`,
  ")",
  "open(p, 'w').write(s)",
  "",
  `page = """`,
  'import { Card } from "../components/Card";',
  `"""`,
  "open('src/pages/status.tsx', 'w').write(page)",
  "EOF",
].join("\n");
const BOARD: Run = {
  ask: "Add a status page to Tea Shop, linked from the footer.",
  items: [
    { id: "t1", kind: "thought", start: 0.3, end: 2.3, text: BOARD_THOUGHT_ROUTE },
    {
      id: "c1",
      kind: "command",
      start: 2.5,
      end: 4.5,
      words: "Find where the shop's pages are routed",
      code: String.raw`grep -rn "createRoute\|path:" src/routes src/pages | head -40`,
    },
    { id: "t2", kind: "thought", start: 4.7, end: 6.2, text: BOARD_THOUGHT_TESTS },
    ...(["routes", "pages", "loaders"] as const).map((name, index): Item => ({
      id: `g${index}`,
      kind: "command",
      start: 6.4 + index * 0.3,
      end: 6.6 + index * 0.3,
      words: `Count the ${name}`,
      code: `ls src/${name} | wc -l`,
    })),
    { id: "w1", kind: "tool", start: 7.6, end: 9.6, tool: "zerops_workflow" },
    {
      id: "n1",
      kind: "note",
      start: 9.8,
      text: "The shop already has a status route, so I'm building the page on it.",
    },
    { id: "t3", kind: "thought", start: 10, end: 11.5, text: BOARD_THOUGHT_ROWS },
    {
      id: "c2",
      kind: "command",
      start: 11.7,
      end: 12.9,
      words: "List the components the page can reuse",
      code: "ls src/components && sed -n '1,60p' src/components/Card.tsx src/components/Dot.tsx",
    },
    {
      id: "c3",
      kind: "command",
      start: 13,
      end: 17.5,
      words: "Read the status route and its tests",
      code: BOARD_READ,
    },
    { id: "t4", kind: "thought", start: 17.7, end: 19, text: BOARD_THOUGHT_TESTS },
    { id: "e1", kind: "edit", start: 19.2, end: 20.4, name: "src/pages/status.tsx" },
    { id: "e2", kind: "edit", start: 20.6, end: 21.8, name: "src/components/Footer.tsx" },
    {
      id: "c4",
      kind: "command",
      start: 22,
      end: 28,
      words: "Add the status page and link it from the footer",
      code: BOARD_ADD,
      output: "wrote src/pages/status.tsx\nupdated src/components/Footer.tsx",
    },
    { id: "w2", kind: "tool", start: 28.2, end: 30.2, tool: "zerops_workflow" },
    {
      id: "n2",
      kind: "note",
      start: 30.4,
      text: "The page is in. I'm running the tests before I show it to you.",
    },
    { id: "t5", kind: "thought", start: 30.6, end: 36, text: BOARD_THOUGHT_FOOTER },
  ],
  write: 36.5,
  end: 39,
  answer:
    "Tea Shop has a status page now, at `/status`, linked from the footer. It is ready for you to review.",
};

/**
 * The board's burst: calm rows, a thought, then ten reads inside two seconds
 * (5.2 s to 7.3 s), then a thought again — the log is to move once for the
 * batch, the working row to stand one height through it.
 */
const READS_BEFORE =
  "The page should look like the rest of the shop, so before writing anything I want the card and the dot the orders page already uses, the footer it will be linked from, the tokens for its colours, and the loaders that show how a page asks for its data. That is ten files. I'll read them in one go rather than one at a time, and then write the page against what they hold.";
const READS_AFTER =
  "Everything the page needs is in those ten files. The card takes a title and its rows, the dot takes a colour, and the orders loader shows the shape a page expects back. So the status page can be one card with three rows and a dot on each, read through a loader of its own, and the footer only gains a link. Nothing else in the shop has to change, which keeps the review small.";
const READS: Run = {
  ask: "Make the status page look like the rest of the shop.",
  items: [
    {
      id: "c1",
      kind: "command",
      start: 0.2,
      end: 1.4,
      words: "List the components the page can reuse",
      code: "ls src/components && sed -n '1,60p' src/components/Card.tsx src/components/Dot.tsx",
    },
    { id: "w1", kind: "tool", start: 1.5, end: 2.6, tool: "zerops_workflow" },
    { id: "t1", kind: "thought", start: 2.7, end: 5, text: READS_BEFORE },
    ...(
      [
        "src/routes/status.ts",
        "src/routes/index.ts",
        "src/components/Card.tsx",
        "src/components/Dot.tsx",
        "src/components/Footer.tsx",
        "src/pages/orders.tsx",
        "src/loaders/orders.ts",
        "src/loaders/catalogue.ts",
        "src/styles/tokens.css",
        "src/pages/index.tsx",
      ] as const
    ).map((name, index): Item => ({
      id: `r${index}`,
      kind: "read",
      start: 5.2 + index * 0.2,
      end: 5.2 + index * 0.2 + 0.1 + (index % 3) * 0.1,
      name,
    })),
    { id: "t2", kind: "thought", start: 7.6, end: 12, text: READS_AFTER },
  ],
  write: 12.5,
  end: 14.5,
  answer: "The status page uses the shop's own card and dot now.",
};

/** A stand-up whose call runs for as long as its services build: its row is its progress. */
const STANDING: Run = {
  ask: "Stand the stage up.",
  items: [
    {
      id: "t1",
      kind: "thought",
      start: 0.3,
      end: 1.2,
      text: "The stage has two services to build and one to wait for.",
    },
    {
      id: "u1",
      kind: "standup",
      start: 1.4,
      returns: 16,
      end: 16,
      subject: "stage",
      stages: [
        ["apistage", 2, 9],
        ["webstage", 2.5, 14],
        ["workerstage", 9, 15.5],
      ],
    },
  ],
  write: 16.5,
  end: 18,
  answer: "The stage is up: all three services run.",
};

/** What a stand-up's call reads of its services while it runs (`StandupReadings`). */
/** No stand-up reads anything: the same map, so what reads it is not drawn again for nothing. */
const NO_READINGS: ReadonlyMap<string, StandupReading> = new Map();

function standupReadingsAt(t: number): ReadonlyMap<string, StandupReading> {
  const readings = new Map<string, StandupReading>();
  for (const item of RUN.items) {
    if (item.kind !== "standup" || t < item.start + 0.6 || t >= item.returns) continue;
    readings.set(
      `op:${item.id}`,
      standupReadingOf(
        item.stages.map(([hostname, from, to]) => ({
          hostname,
          state: t >= to ? "up" : t >= from ? "building" : "waits",
        })),
      ),
    );
  }
  return readings.size === 0 ? NO_READINGS : readings;
}

/**
 * A run forty minutes in (the owner, 2026-11-10: "Working · 41:17 · 299
 * steps … running on like 5 FPS"): `?steps` rows that never fold — a
 * two-line thought, then a command with a title and one line of code, every
 * tenth what the Mate said — and under them the run going on, ten seconds a
 * round: a thought growing line by line for three seconds, a command taking
 * its place, its four lines of code arriving a second later, a second call
 * running on a line of its own under it, then four and a half seconds with
 * nothing moving until both land and the next round begins.
 *
 * Its rows stand before the page opened; they are handed over in the first
 * half second, after the card is drawn, so the log holds every one of them —
 * as it does for the person who watched the run from its start — and not
 * only the newest forty a card opened later draws.
 */
const DEEP_ROUND = 10;
const DEEP_FIRST = 1.5;
const DEEP_STEP_SECONDS = 8;
const DEEP_THOUGHTS = [
  "The orders page asks its loader for a page of rows and a total, and draws the pager from the total alone. The loader counts on every request, which is the slow half of it, so the count can be kept beside the rows for a minute.",
  "The catalogue's tests build their own fixtures instead of reading the shared ones, so a column added to the shared ones never reaches them. Moving them over is mechanical, and each test keeps its own assertions as they are.",
  "The footer links are a list in one file and a second list in the sitemap, kept the same by hand. One list both read from removes the drift, and the sitemap keeps its order by a field the footer ignores.",
  "The payment form validates the card number twice, once in the field and once in the submit handler, with two messages for the same mistake. The handler can trust the field and keep only what the field cannot know.",
] as const;
const DEEP_SAID = [
  "The loader is the slow half, so I'm starting there.",
  "The shared fixtures cover this, so I'm moving the tests over.",
  "One list for both, then. I'll keep the sitemap's order.",
  "The field already checks this, so the handler gets simpler.",
] as const;
const DEEP_NOW =
  "The next piece is the catalogue's search. It filters in the page after loading every row, which is fine at two hundred teas and will not be at two thousand. The loader already takes a query, so the filter can move there and the page keeps only the input and its debounce. The tests for the page stay as they are, and the loader gains two: one for a match in a name, one for none at all. I'll read the loader and its tests before changing either.";

function deepHistory(): TimelineEntry[] {
  const rows: TimelineEntry[] = [];
  for (let index = 0; index < STEPS; index += 1) {
    const at = (index - STEPS) * DEEP_STEP_SECONDS;
    const round = Math.floor(index / 2);
    if (index % 10 === 9) {
      rows.push(
        message(`deep-said-${index}`, "assistant", at, DEEP_SAID[round % DEEP_SAID.length]!),
      );
    } else if (index % 2 === 0) {
      rows.push(
        message(
          `deep-thought-${index}`,
          "reasoning",
          at,
          DEEP_THOUGHTS[round % DEEP_THOUGHTS.length]!,
        ),
      );
    } else {
      rows.push(
        work(`deep-command-${index}`, at, {
          label: "Command run",
          itemType: "command_execution",
          command: `pnpm test -- step-${index} --reporter dot && pnpm lint -- src/steps/step-${index}.ts`,
          callInput: { description: `Check step ${index + 1} of the plan` },
          toolLifecycleStatus: "completed",
          sourceActivityKind: "tool.completed",
          updatedAt: iso(at + 3),
        }),
      );
    }
  }
  return rows;
}

/** Where the `deep` run stands at `t`: its round, and how far into it. */
function deepAt(t: number) {
  const since = Math.max(0, t - DEEP_FIRST);
  const round = t < DEEP_FIRST ? -1 : Math.floor(since / DEEP_ROUND);
  return { round, into: round < 0 ? 0 : since - round * DEEP_ROUND };
}

/** When the front of the `deep` run's log changes (`?joins`, `?leaves`): in its second round's quiet stretch. */
const DEEP_FRONT_AT = DEEP_FIRST + DEEP_ROUND + 6;

function deepEventKey(t: number): string {
  const key = deepRoundKey(t);
  return (JOINS > 0 || LEAVES > 0) && t >= DEEP_FRONT_AT ? `${key}:front` : key;
}

function deepRoundKey(t: number): string {
  const { round, into } = deepAt(t);
  if (t < 0.5) return "opening";
  if (round < 0) return "opened";
  // A thought streams a tenth of a second at a time, three seconds long.
  if (into < 3) return `${round}:thought:${Math.floor(into * 10)}`;
  if (into < 3.2) return `${round}:thought`;
  if (into < 4.2) return `${round}:command`;
  if (into < 4.6) return `${round}:code`;
  if (into < 9.2) return `${round}:beside`;
  return `${round}:returned`;
}

const DEEP_BEGAN = -(STEPS + 3) * DEEP_STEP_SECONDS;

function deepEntries(): (t: number) => TimelineEntry[] {
  // Made as the run is first asked for: the page's clock is not set before.
  let history: TimelineEntry[] | null = null;
  const before = () => [
    message("ask", "user", DEEP_BEGAN, "Work through the plan, a step at a time."),
  ];
  let opening: TimelineEntry[] | null = null;
  // The front of its log once it changed: earlier lines joined, or its first ones gone.
  let fronted: TimelineEntry[] | null = null;
  const front = (rows: TimelineEntry[]) => [
    rows[0]!,
    // In the log's own mix, so each is a line of its own: a thought, then a command.
    ...Array.from({ length: JOINS }, (_, index) => {
      const at = DEEP_BEGAN + (index + 1) / (JOINS + 1);
      return index % 2 === 0
        ? message(
            `deep-earlier-${index}`,
            "reasoning",
            at,
            DEEP_THOUGHTS[index % DEEP_THOUGHTS.length]!,
          )
        : work(`deep-earlier-${index}`, at, {
            label: "Command run",
            itemType: "command_execution",
            command: `pnpm test -- earlier-${index} --reporter dot`,
            callInput: { description: `Check what stood before, part ${index + 1}` },
            toolLifecycleStatus: "completed",
            sourceActivityKind: "tool.completed",
            updatedAt: iso(at),
          });
    }),
    ...rows.slice(1 + LEAVES),
  ];
  // A second call beside the command, from its code's arrival to its end: a line of its own under it.
  const beside = (round: number, returned: boolean) => {
    const start = DEEP_FIRST + round * DEEP_ROUND + 4.6;
    return work(`deep-now-beside-${round}`, start, {
      itemType: "dynamic_tool_call",
      detail: `Read: ${JSON.stringify({ file_path: "src/pages/catalogue.tsx" })}`,
      callInput: { filePath: "src/pages/catalogue.tsx" },
      toolLifecycleStatus: returned ? "completed" : "inProgress",
      sourceActivityKind: returned ? "tool.completed" : "tool.started",
      ...(returned ? { updatedAt: iso(start + 4.6) } : {}),
    });
  };
  // The rounds that ended, as they ended: never built again.
  const ended: TimelineEntry[] = [];
  let last: { readonly key: string; readonly entries: TimelineEntry[] } | null = null;
  const thought = (round: number, shown: number) => {
    const text = DEEP_NOW.slice(0, Math.max(1, Math.round(DEEP_NOW.length * Math.min(1, shown))));
    return message(
      `deep-now-thought-${round}`,
      "reasoning",
      DEEP_FIRST + round * DEEP_ROUND,
      text,
      shown < 1,
    );
  };
  const command = (round: number, state: "said" | "coded" | "returned") => {
    const start = DEEP_FIRST + round * DEEP_ROUND + 3.2;
    return work(`deep-now-command-${round}`, start, {
      label: "Command run",
      itemType: "command_execution",
      ...(state === "said"
        ? {}
        : {
            command: [
              "for f in src/loaders/catalogue.ts src/loaders/catalogue.test.ts; do",
              `  echo "== $f"; sed -n '1,120p' "$f"`,
              "done",
              `grep -rn "searchCatalogue" src --include='*.ts' | head -20`,
            ].join("\n"),
            callInput: {
              description: `Read the catalogue's loader and its tests, round ${round + 1}`,
            },
          }),
      toolLifecycleStatus: state === "returned" ? "completed" : "inProgress",
      sourceActivityKind: state === "returned" ? "tool.completed" : "tool.started",
      ...(state === "returned" ? { updatedAt: iso(start + 6) } : {}),
    });
  };
  return (t) => {
    const key = deepEventKey(t);
    if (last?.key === key) return last.entries;
    history ??= [...before(), ...deepHistory()];
    opening ??= history.slice(0, 4);
    const { round, into } = deepAt(t);
    while (ended.length / 3 < round) {
      const done = ended.length / 3;
      ended.push(thought(done, 1), command(done, "returned"), beside(done, true));
    }
    const now: TimelineEntry[] = [];
    if (round >= 0) {
      now.push(thought(round, into / 3));
      if (into >= 3.2)
        now.push(command(round, into < 4.2 ? "said" : into < 9.2 ? "coded" : "returned"));
      if (into >= 4.6) now.push(beside(round, into >= 9.2));
    }
    if (t >= DEEP_FRONT_AT && (JOINS > 0 || LEAVES > 0)) fronted ??= front(history);
    const entries = [...(t < 0.5 ? opening : (fronted ?? history)), ...ended, ...now];
    last = { key, entries };
    return entries;
  };
}

const DEEP: Run = {
  ask: "Work through the plan, a step at a time.",
  items: [],
  write: 100_000,
  end: 100_000,
  answer: "",
  from: DEEP_BEGAN,
  entries: deepEntries(),
  eventKey: deepEventKey,
};

const RUN: Run =
  {
    deep: DEEP,
    main: MAIN,
    board: BOARD,
    reads: READS,
    burst: BURST,
    stale: STALE,
    band: BAND,
    standing: STANDING,
    long: LONG,
    edits: EDITS,
    deploy: DEPLOY,
    batch: BATCH,
    cards: CARDS,
    interrupt: INTERRUPT,
    smooth: SMOOTH,
    ten: TEN,
    send: SEND,
  }[SCRIPT] ?? MAIN;

/** The turn the person's message starts, in the interrupt script. */
const TURN2 = TurnId.make("live-turn-2");

/** The run started this long before the page loaded, so its clock reads as it would live. */
const STARTED = Date.now() - START_AT * 1000;
const iso = (second: number) => new Date(STARTED + second * 1000).toISOString();

function work(
  id: string,
  start: number,
  fields: Partial<WorkLogEntry>,
  turnId: TurnId = TURN,
): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: iso(start),
    entry: {
      id,
      createdAt: iso(start),
      startedAt: iso(start),
      turnId,
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
    // Its command not known yet, it is a call that says nothing of itself.
    const known = item.codeAt === undefined || t >= item.codeAt;
    return work(item.id, item.start, {
      label: "Command run",
      itemType: "command_execution",
      ...(known ? { command: item.code, callInput: { description: item.words } } : {}),
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

/** The run's second the operations were last drawn at: what a deploy's handed pipeline stands at. */
let drawnAt = START_AT;

const PIPELINE_LABEL = {
  INIT_BUILD_CONTAINER: "Build container",
  RUN_BUILD_COMMANDS: "Build",
  INIT_PREPARE_CONTAINER: "Prepare container",
  RUN_PREPARE_COMMANDS: "Prepare runtime",
  DEPLOY: "Deploy",
} as const;

const BUILD_LOG = [
  "npm ci",
  "added 412 packages in 38s",
  "npm run build",
  "vite v7.1.4 building for production...",
  "✓ 1284 modules transformed.",
  "✓ built in 2m 41s",
].map((text, index) => ({ id: `log-${index}`, at: iso(30 + index * 30), text, severity: 6 }));

/** The way to a handed deploy's build log: its dialog's state is its own. */
function HandedBuildLog({
  running,
  subject,
}: {
  readonly running: boolean;
  readonly subject: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ZeropsBuildLog
      lines={BUILD_LOG}
      onToggle={() => setOpen(!open)}
      open={open}
      stands={!running}
      status={running ? "live" : "ended"}
      subject={subject}
    />
  );
}

/** What a deploy's card read of the platform, made up: its pipeline at the run's second, its log. */
function handedOperationCard(operation: ZeropsOperation): OperationCardRegions | undefined {
  const item = RUN.items.find((candidate) => `op:${candidate.id}` === operation.key);
  if (item === undefined || item.kind !== "deploy") return undefined;
  const t = drawnAt;
  const read = (
    pipeline: ReadonlyArray<readonly [PipelineStepId, number, number]>,
    fails = false,
  ) =>
    pipeline.map(([id, from, to], index) => {
      const ended =
        t >= to ? (fails && index === pipeline.length - 1 ? "failed" : "finished") : null;
      const state = ended ?? (t >= from ? "running" : "waiting");
      return {
        id,
        label: PIPELINE_LABEL[id],
        state,
        sentence: PIPELINE_LABEL[id],
        ...(state === "waiting"
          ? {}
          : { durationMs: (Math.min(t, to) - from) * 1000, startedAt: iso(from) }),
      } as const;
    });
  if (item.services !== undefined)
    return {
      observed: {
        steps: [],
        chips: [],
        provenance: "",
        services: item.services.map((service) => {
          const first = service.pipeline[0]?.[1] ?? 0;
          const last = service.pipeline.at(-1)?.[2] ?? 0;
          // Its version exists a few seconds in; its steps are known a few seconds after.
          if (t < first - 4)
            return { name: service.name, state: "waiting", stateLabel: "Waiting", steps: [] };
          if (t < first)
            return {
              name: service.name,
              state: "running",
              stateLabel: "Deploying",
              steps: [],
              calculating: true,
            };
          const steps = read(service.pipeline, service.fails !== undefined);
          const built = steps.some(
            (step) => step.id === "RUN_BUILD_COMMANDS" && step.state !== "waiting",
          );
          const failed = t >= last && service.fails !== undefined;
          return {
            name: service.name,
            ...(failed
              ? { state: "failed" as const, stateLabel: "Failed", reason: service.fails }
              : t >= last
                ? { state: "done" as const, stateLabel: "Deployed" }
                : { state: "running" as const, stateLabel: "Deploying" }),
            steps,
            ...(built ? { log: <HandedBuildLog running={t < last} subject={service.name} /> } : {}),
          };
        }),
      },
    };
  if (item.pipeline === undefined) return undefined;
  const steps = read(item.pipeline);
  const running = t < item.end;
  const pipeline: PipelineReadout = {
    status: running ? { tone: "running", word: "Running" } : { tone: "finished", word: "Finished" },
    calculating: false,
    steps,
  };
  const built = steps.some((step) => step.id === "RUN_BUILD_COMMANDS" && step.state !== "waiting");
  return {
    observed: {
      steps: [],
      chips: [],
      provenance: "",
      pipeline,
      ...(built ? { log: <HandedBuildLog running={running} subject={item.subject} /> } : {}),
    },
  };
}

function operationEntry(
  item: Extract<Item, { kind: "deploy" | "standup" | "browser" }>,
  t: number,
) {
  drawnAt = t;
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
  const services = item.kind === "deploy" ? item.services : undefined;
  const broke = settled && services?.some((service) => service.fails !== undefined) === true;
  const operation: ZeropsOperation = {
    key: `op:${item.id}`,
    kind: item.kind,
    // A stand-up's call settles it as its report said, its builds running on.
    phase: broke ? "failed" : settled || (item.kind === "standup" && returned) ? "done" : "running",
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
    statusWord: broke
      ? "Failed"
      : settled
        ? item.kind === "deploy"
          ? "Deployed"
          : item.kind === "standup"
            ? "Stood up"
            : "Checked"
        : "Working",
    steps:
      services === undefined
        ? steps
        : services.map((service) =>
            settled && service.fails !== undefined
              ? {
                  id: service.name,
                  label: service.name,
                  state: "failed" as const,
                  stateLabel: "Failed",
                  note: service.fails,
                }
              : {
                  id: service.name,
                  label: service.name,
                  state: settled ? ("done" as const) : ("running" as const),
                  stateLabel: settled ? "Deployed" : "Running",
                },
          ),
    ...(services === undefined ? {} : { batch: true }),
    links:
      item.kind === "deploy" && settled && item.address !== undefined
        ? [{ label: item.address, url: `https://${item.address}` }]
        : [],
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

/** The turn of the run that finished before the person's send (`send`). */
const TURN_BEFORE = TurnId.make("turn-before");

const BEFORE_ANSWER = "Added `/status`: it says how long the app has been up since its last start.";

/** `?long`: the turns long before it, each an ask and its answer. */
function turnsBefore(): ReadonlyArray<TimelineEntry> {
  return Array.from({ length: TURNS_ABOVE }, (_, index) => {
    const at = -3600 + index * 60;
    const turn = TurnId.make(`turn-long-ago-${index}`);
    return [
      message(
        `long-ago-ask-${index}`,
        "user",
        at,
        `What does step ${index + 1} of the plan change?`,
      ),
      message(`long-ago-answer-${index}`, "assistant", at + 20, BEFORE_ANSWER, false, turn),
    ];
  }).flat();
}

/**
 * The run before the send at `t`: two calls and its answer. It finished a few
 * minutes before the page opened, its card settled — or, `?watched`, it plays
 * from the page's open and ends at `BEFORE_END`.
 */
function runBefore(t: number): ReadonlyArray<TimelineEntry> {
  const from = WATCHED ? 0 : -300;
  const at = WATCHED ? t : Number.POSITIVE_INFINITY;
  const entries: TimelineEntry[] = [
    message("before-ask", "user", from, "Add a /status page that lists the app's uptime."),
  ];
  (["src/routes/index.ts", "src/routes/status.ts"] as const).forEach((name, index) => {
    const start = from + 0.4 + index * 0.7;
    if (at < start) return;
    const returned = at >= start + 0.5;
    entries.push(
      work(
        `before-${index}`,
        start,
        {
          itemType: index === 0 ? "dynamic_tool_call" : "file_change",
          detail: `${index === 0 ? "Read" : "Edit"}: ${JSON.stringify({ file_path: name })}`,
          callInput: { filePath: name },
          ...(index === 0 ? {} : { changedFiles: [name] }),
          toolLifecycleStatus: returned ? "completed" : "inProgress",
          sourceActivityKind: returned ? "tool.completed" : "tool.started",
          ...(returned ? { updatedAt: iso(start + 0.5) } : {}),
        },
        TURN_BEFORE,
      ),
    );
  });
  const writes = from + 1.9;
  if (at >= writes) {
    const shown = Math.min(1, (at - writes) / (BEFORE_END - 1.9));
    entries.push(
      message(
        "before-answer",
        "assistant",
        writes,
        BEFORE_ANSWER.slice(0, Math.max(1, Math.round(BEFORE_ANSWER.length * shown))),
        at < from + BEFORE_END,
        TURN_BEFORE,
      ),
    );
  }
  return entries;
}

/** The run's timeline at `t` seconds in. */
function entriesAt(t: number): TimelineEntry[] {
  if (RUN.entries !== undefined) return RUN.entries(t);
  const entries: TimelineEntry[] = SHORT ? [] : [...EARLIER];
  if (RUN.sendAt !== undefined) entries.push(...turnsBefore(), ...runBefore(t));
  if (t >= (RUN.sendAt ?? 0)) entries.push(message("ask", "user", RUN.sendAt ?? 0, RUN.ask));
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
      case "tool": {
        const returned = t >= item.end;
        entries.push(
          work(item.id, item.start, {
            itemType: "dynamic_tool_call",
            detail: `${item.tool}: {}`,
            toolLifecycleStatus: returned ? "completed" : "inProgress",
            sourceActivityKind: returned ? "tool.completed" : "tool.started",
            ...(returned ? { updatedAt: iso(item.end) } : {}),
          }),
        );
        break;
      }
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
/** When the person presses send: as its message becomes a row, or a moment before (`?crew`). */
const SENT_AT = RUN.sendAt === undefined ? undefined : RUN.sendAt - (CREW ? 0.4 : 0);

function useRunClock(
  /** The person's send, told in the update that makes its message a row: one commit, as ChatView's. */
  onSend: () => void,
): readonly [number, () => void, (to: number) => void, { readonly current: () => number }] {
  const [origin, setOrigin] = useState(() => performance.now() - (START_AT * 1000) / SPEED);
  const nowRef = useRef(() => START_AT);
  useLayoutEffect(() => {
    nowRef.current = () => ((performance.now() - origin) * SPEED) / 1000;
  }, [origin]);
  const [seconds, setSeconds] = useState(START_AT);
  const onSendRef = useRef(onSend);
  useLayoutEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => {
    const { eventKey } = RUN;
    if (eventKey !== undefined) {
      // A run that says its events is drawn again as one happens, and never
      // between: nothing of the harness runs in a frame nothing changed in.
      let said = eventKey(START_AT);
      const timer = setInterval(() => {
        const next = ((performance.now() - origin) * SPEED) / 1000;
        const key = eventKey(next);
        if (key === said) return;
        said = key;
        setSeconds(next);
      }, 20);
      return () => clearInterval(timer);
    }
    let frame = 0;
    let before = ((performance.now() - origin) * SPEED) / 1000;
    const tick = () => {
      const next = Math.min(RUN.end + 2, ((performance.now() - origin) * SPEED) / 1000);
      if (SENT_AT !== undefined && before < SENT_AT && next >= SENT_AT) onSendRef.current();
      before = next;
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
  return [seconds, restart, jump, nowRef];
}

const keptForever = () => true;
const readsNothing = () => null;

type TimelineProps = Parameters<typeof MessagesTimeline>[0];

/** What turned following on or off, for a sampler: when, by what, and what it is since. */
interface FollowChange {
  readonly at: number;
  readonly by: string;
  readonly follows: boolean;
}

/**
 * Whether the conversation follows its end, as ChatView judges it — the same
 * refs and the same order, so what turns following off there turns it off
 * here: the conversation opens following unless it was left mid-read
 * (`readTimelinePosition`), the list's scrolls and the person's inputs turn it
 * off and on (`nextTimelineFollow`), and the person's own send turns it on
 * (ChatView's `scrollToEnd(false, true)`).
 */
function useFollow(listRef: { readonly current: LegendListRef | null }, routeThreadKey: string) {
  const [enabled, setEnabled] = useState(true);
  const logRef = useRef<FollowChange[]>([]);
  const state = useRef({ following: true, atEnd: true, mode: "following-end" });
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const say = useCallback((by: string, follows: boolean) => {
    const last = logRef.current.at(-1);
    if (last?.follows !== follows) logRef.current.push({ at: performance.now(), by, follows });
    setEnabled(follows);
  }, []);
  // The conversation opens: at its end, or where the person left it.
  useEffect(() => {
    const followEnd = nextTimelineFollow(state.current.following, {
      type: "opened",
      atEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false,
    });
    state.current = {
      following: followEnd,
      atEnd: followEnd,
      mode: followEnd ? "following-end" : "free-scrolling",
    };
    logRef.current = [];
    say("opened", followEnd);
  }, [routeThreadKey, say]);
  const onManualNavigation = useCallback(() => {
    cancelPositionRestoreRef.current?.();
    state.current = { ...state.current, following: false, mode: "free-scrolling" };
    say("navigation", false);
  }, [say]);
  const resume = useCallback(
    (by: string) => {
      state.current = { following: true, atEnd: true, mode: "following-end" };
      say(by, true);
    },
    [say],
  );
  const atEndNow = useCallback(() => {
    const node = listRef.current?.getScrollableNode() as HTMLElement | undefined;
    return node === undefined ? true : node.scrollHeight - node.scrollTop - node.clientHeight <= 40;
  }, [listRef]);
  const onPersonInput = useCallback<TimelineProps["onPersonInput"]>(
    (input) => {
      const leave = (by: string) => {
        if (state.current.following) flushSync(onManualNavigation);
        else onManualNavigation();
        logRef.current.push({ at: performance.now(), by, follows: false });
      };
      switch (input.kind) {
        case "wheel":
        case "key":
          if (input.direction === "up") leave(`${input.kind} up`);
          else if (
            !state.current.following &&
            nextTimelineFollow(false, { type: "toward-end-input", inEndBand: atEndNow() })
          )
            resume(`${input.kind} down`);
          return;
        case "scrollbar":
          leave("scrollbar");
          return;
        case "touch-move":
        case "content-pointer":
          if (!atEndNow()) leave(input.kind);
          return;
      }
    },
    [atEndNow, onManualNavigation, resume],
  );
  const onIsAtEndChange = useCallback<TimelineProps["onIsAtEndChange"]>(
    (isAtEnd, scroll) => {
      const { following } = state.current;
      const followsNext = nextTimelineFollow(following, {
        type: "position",
        atEnd: isAtEnd,
        ...scroll,
      });
      if (following && !followsNext) {
        flushSync(onManualNavigation);
        state.current = { ...state.current, atEnd: false };
        logRef.current.push({
          at: performance.now(),
          by: `position ${JSON.stringify({ isAtEnd, ...scroll })}`,
          follows: false,
        });
        return;
      }
      if (following) return;
      const wasAtEnd = state.current.atEnd;
      state.current = { ...state.current, atEnd: isAtEnd };
      if (followsNext) resume(`position ${JSON.stringify({ isAtEnd, ...scroll })}`);
      else if (wasAtEnd !== isAtEnd && !isAtEnd) {
        state.current = { ...state.current, mode: "free-scrolling", following: false };
      }
    },
    [onManualNavigation, resume],
  );
  // The person's own send, as ChatView's: judged in the update that makes its
  // message a row, or — a crew thread's — before the engine has written it.
  const sent = useCallback(() => {
    if (!nextTimelineFollow(state.current.following, { type: "sent", byPerson: true })) return;
    cancelPositionRestoreRef.current?.();
    const following = state.current.atEnd && state.current.mode === "following-end";
    state.current = { following: true, atEnd: true, mode: "following-end" };
    say("sent", true);
    if (following) return;
    requestAnimationFrame(() => void listRef.current?.scrollToEnd({ animated: false }));
  }, [listRef, say]);
  return {
    enabled,
    logRef,
    cancelPositionRestoreRef,
    onIsAtEndChange,
    onManualNavigation,
    onPersonInput,
    sent,
  };
}

/**
 * `?left`: the conversation was left mid-read, a row since gone at its reading
 * line — it opens where that leaves it, at its end, and does not follow; or
 * `?leftrow`, a row it still has.
 */
function rememberLeftMidRead(routeThreadKey: string) {
  if (!LEFT) return;
  rememberTimelinePosition(routeThreadKey, {
    rowId: params.get("leftrow") ?? "row-since-gone",
    offsetWithinRow: 0,
    rowHeight: 0,
    cardTopId: null,
    previousRowId: null,
    atEnd: false,
  });
}

function Pane() {
  const [epoch, setEpoch] = useState(0);
  // A resync: the thread catches up while `syncing`, then settles.
  const [syncing, setSyncing] = useState(false);
  const listRef = useRef<LegendListRef | null>(null);
  const routeThreadKey = `${ENVIRONMENT}:live-${epoch}`;
  const {
    enabled: follows,
    logRef,
    cancelPositionRestoreRef,
    onIsAtEndChange,
    onManualNavigation,
    onPersonInput,
    sent,
  } = useFollow(listRef, routeThreadKey);
  const [seconds, restart, jump, nowRef] = useRunClock(sent);
  useEffect(() => {
    (window as unknown as { __liveHarness: unknown }).__liveHarness = {
      restart: () => {
        rememberLeftMidRead(`${ENVIRONMENT}:live-${epoch + 1}`);
        setEpoch(epoch + 1);
        restart();
      },
      seconds: () => seconds,
      // Where the run stands this moment, between two draws too.
      now: () => nowRef.current(),
      resync: (to: number) => {
        setSyncing(true);
        jump(to);
        setTimeout(() => setSyncing(false), 300);
      },
      follows: () => follows,
      followLog: () => logRef.current,
    };
  }, [epoch, follows, jump, logRef, nowRef, restart, seconds]);
  const step = RUN.eventKey === undefined ? Math.floor(seconds * 20) / 20 : seconds;
  // The person's send: until then the conversation rests under a finished run.
  const asked = RUN.sendAt === undefined || step >= RUN.sendAt;
  // The draft the person sends: typed half-way to the send, it stands in the
  // composer until it goes.
  const composerHeight =
    COMPOSER_HEIGHT + (SENT_AT !== undefined && step >= SENT_AT / 2 && step < SENT_AT ? DRAFT : 0);
  // The run before the send, watched: it works until its answer has landed.
  const beforeWorks = !asked && WATCHED && step < BEFORE_END;
  const ended = !beforeWorks && (!asked || (step >= RUN.end && RUN.interrupt === undefined));
  // Written into: the first turn is over, the next one runs.
  const second = RUN.interrupt !== undefined && step >= RUN.interrupt.at + 0.5;
  const entries = useMemo(() => entriesAt(step), [step]);
  const standing = useMemo(() => standupReadingsAt(step), [step]);
  const latestTurn = useMemo(
    () =>
      second
        ? {
            turnId: TURN2,
            state: "running" as const,
            startedAt: iso(RUN.interrupt!.at + 0.5),
            completedAt: null,
          }
        : !asked
          ? {
              turnId: TURN_BEFORE,
              state: beforeWorks ? ("running" as const) : ("completed" as const),
              startedAt: iso(WATCHED ? 0 : -299),
              completedAt: beforeWorks ? null : iso(WATCHED ? BEFORE_END : -289),
            }
          : {
              turnId: TURN,
              state: ended ? ("completed" as const) : ("running" as const),
              startedAt: iso(RUN.from ?? RUN.sendAt ?? 0),
              completedAt: ended ? iso(RUN.end) : null,
            },
    [asked, beforeWorks, ended, second],
  );
  const runningTurnId = ended ? null : second ? TURN2 : beforeWorks ? TURN_BEFORE : TURN;
  const dock = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking: !ended,
        runningTurnId,
        agentPanelModel: emptyAgentPanelModel(),
        plan: null,
        pause: null,
      }),
    [entries, ended, runningTurnId],
  );
  return (
    <StandupReadings value={standing}>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <KeptTimelines
            open={routeThreadKey}
            alive={keptForever}
            Reader={readsNothing}
            crewTimeline={null}
            timeline={{
              isWorking: !ended,
              activeTurnStartedAt: ended
                ? null
                : second
                  ? iso(RUN.interrupt!.at + 0.5)
                  : iso(beforeWorks ? 0 : (RUN.from ?? RUN.sendAt ?? 0)),
              listRef,
              timelineEntries: entries,
              latestTurn,
              runningTurnId,
              working: dock,
              routeThreadKey,
              // Its calls name no response: Codex's timing rule reads its
              // batches, unless `?provider=claudeAgent` (nothing goes stale).
              provider: PROVIDER,
              onImageExpand: () => undefined,
              activeThreadEnvironmentId: ENVIRONMENT,
              markdownCwd: undefined,
              resolvedTheme: appearance,
              timestampFormat: "locale",
              workspaceRoot: undefined,
              anchorMessageId: null,
              onAnchorReady: () => undefined,
              contentInsetEndAdjustment: composerHeight,
              liveFollowEnabled: follows,
              cancelPositionRestoreRef,
              onIsAtEndChange,
              onPersonInput,
              onManualNavigation,
              hideEmptyPlaceholder: false,
              loading: false,
              // The `deep` run's rows are handed over as a catch-up brings them: there at once.
              syncing: syncing || (RUN.entries !== undefined && step < 1),
              topFadeEnabled: true,
            }}
          />
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-5 pt-2"
          style={{ height: composerHeight }}
          data-harness-composer=""
        >
          <div
            className="mx-auto max-w-3xl rounded-3xl border border-border bg-card shadow-sm"
            style={{ height: composerHeight - 20 }}
          />
        </div>
        <p
          className="absolute top-2 right-4 z-30 font-mono text-muted-foreground text-xs tabular-nums"
          data-live-harness-clock
        >
          {SCRIPT} · {seconds.toFixed(1)} s
        </p>
      </div>
    </StandupReadings>
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
    lost: new Set(),
    deleted: [],
  };
  const data: ZeropsDataContextValue = {
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

const appearance = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

rememberLeftMidRead(`${ENVIRONMENT}:live-0`);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Standins>
        <HandedOperationCardContext value={handedOperationCard}>
          <Harness />
        </HandedOperationCardContext>
      </Standins>
    </StrictMode>,
  );
}
