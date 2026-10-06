/**
 * Switching between Mates' conversations, as the conversation pane does it:
 * at once, the next conversation's own list from the press. Five Mates with conversations of their own, two of them at work —
 * Iris on a run the person started the day after a message whose own run
 * never came; a first open that waits on the server; a Mate opened before
 * that paints from what the app remembers; and a run the person opened
 * folding as they leave (the card's own fold, K7). A live Mate streams its
 * answer from the page's load, so a return to it meets rows changing under
 * it. A finished run that only ran commands leaves its card holding its line
 * alone; Nova's second-to-last deployed to stage, and its result is a row
 * under its line.
 *
 * Served by the dev server at `/design-switch.html` (`?theme=dark`,
 * `?latency=<ms>` for the first open's wait, `?stream=<ms>` for how often the
 * live Mate's answer grows, `?line=1` to head the pane with the conversation
 * line — Fen and a crew of three, each chat one of the four — so a press on
 * a face swaps the conversation as the line moves, `?first=<ms>` for a live
 * Mate that has done nothing yet, `?deploy=<from>,<to>` for a deploy running
 * alongside its run, and `?end=<ms>` for its run's end).
 * `window.__switchHarness
 * .switchTo("juno")` switches from a script, so a per-frame sampler can watch
 * a switch it started itself, `.say("mira", text)` lands a message at a
 * conversation's end, `.probeFollow("nova")` measures what a person
 * reading it meets as messages land, and `.follows()` says whether the shown
 * conversation follows its end.
 *
 * Fixtures only. Nothing here ships — `design-switch.html` is not
 * `index.html`, and no route imports this module.
 */
import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import type { MateTintId } from "@t3tools/shared/brand";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import * as Stream from "effect/Stream";

import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { nextTimelineFollow } from "@t3tools/client-runtime/zerops/timelineFollow";
import { ConversationStripView } from "~/components/chat/ConversationStrip";
import { deriveDock } from "~/components/chat/conversationDock.logic";
import type { LineCrewmate } from "~/components/chat/ConversationStrip.logic";
import { KeptTimelines } from "~/components/chat/KeptTimelines";
import type { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { readTimelinePosition } from "~/components/chat/timelineScrollAnchoring";
import type { TimelineEntry } from "~/session-logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import "../index.css";

const params = new URLSearchParams(location.search);
const LATENCY_MS = Number(params.get("latency") ?? 320);
/** Head the pane with the conversation line: Fen's own chat, then its crew's. */
const LINE = params.get("line") === "1";
const ENVIRONMENT = EnvironmentId.make("environment-harness");
const BASE = Date.parse("2026-09-29T07:00:00.000Z");
const at = (minute: number, second = 0) =>
  new Date(BASE + minute * 60_000 + second * 1000).toISOString();

const ASKS = [
  "Add a /status page that shows the API's version and how long it has been up.",
  "The build fails on the stage service since this morning. Can you look?",
  "Rename the orders table's `total` column to `amount_cents` and keep the old reads working.",
  "Make the login form remember the last email, and show a clear error when the password is wrong.",
  "Why is the product list slow on the first load? Measure it before changing anything.",
  "Deploy what we have to stage and check the checkout in the browser.",
  "Write tests for the price rounding, the ones we talked about yesterday.",
  "Add pagination to the admin's order list, 50 per page.",
];

const NOTES = [
  "Checking how the API reports its version first.",
  "The build log points at a type error in the session module.",
  "Found the query: it reads every product with its images in one go.",
  "The migration runs clean on a copy of the stage database.",
];

const ANSWERS = [
  "The **/status** page is live on stage. It reads the version from the build and the uptime from the process:\n\n- `GET /status` answers `{ version, uptimeSeconds }`\n- the page refreshes every 10 seconds\n- nothing else changed\n\n```ts\nexport function status() {\n  return { version: BUILD_VERSION, uptimeSeconds: Math.round(process.uptime()) };\n}\n```",
  "The build failed on a type error in `session.ts`: a field the new client sends was optional on one side and required on the other. I made it optional on both, the build passes and stage runs the fix.",
  "Done. The column is `amount_cents` now, a view keeps `total` readable for the reports that still use it, and the migration is reversible.\n\n1. `20260929_rename_total.sql` renames the column\n2. the view `orders_legacy` maps it back\n3. the API writes the new name only",
  "The form remembers the last email in local storage and says **Wrong password** under the field when the API answers 401. I checked both in the browser at phone and laptop width.",
  "The first load takes 2.4 s because the list asks for every product with all its images. Paged to 24 with the first image only, it takes 310 ms. I left the change on a branch for you to review before it goes anywhere.",
  "Stage runs the new build. The checkout goes through with the test card, and the order shows up in the admin.",
  "Seven tests cover the rounding now: halves, negative amounts, three currencies and the totals of a basket. They all pass.",
  "The admin's order list pages by 50 now, with the page in the address so a reload keeps it.",
];

const COMMANDS = [
  "pnpm build",
  "pnpm test --filter api",
  "git status --short",
  "pnpm lint",
  "curl -s localhost:3000/status",
  "pnpm db:migrate --dry-run",
];

/** A deploy to stage that went through: the run's result is the service it left running. */
function deployedToStage(id: string, turnId: TurnId, when: string): TimelineEntry {
  return {
    id,
    kind: "operation",
    createdAt: when,
    operation: {
      key: `op:${id}`,
      kind: "deploy",
      phase: "done",
      anchorAt: when,
      anchorActivityId: `activity-${id}`,
      settledAt: when,
      turnId,
      subject: "stage",
      kicker: "Deploy · stage",
      voice: "Deploying to stage",
      voiceSource: "mate",
      statusWord: "Deployed",
      steps: [],
      links: [],
      callIds: [`call-${id}`],
      target: { hostname: "stage" },
      hasResult: true,
    },
  };
}

function turnEntries(thread: string, turn: number, calls: number): TimelineEntry[] {
  const minute = turn * 11;
  const turnId = TurnId.make(`${thread}-turn-${turn}`);
  const entries: TimelineEntry[] = [
    {
      id: `${thread}-ask-${turn}`,
      kind: "message",
      createdAt: at(minute),
      message: {
        id: MessageId.make(`${thread}-ask-${turn}`),
        role: "user",
        text: ASKS[(turn + thread.length) % ASKS.length]!,
        turnId: null,
        createdAt: at(minute),
        updatedAt: at(minute),
        streaming: false,
      },
    },
  ];
  for (let call = 0; call < calls; call += 1) {
    const second = 4 + call * 9;
    if (call === 2) {
      const note = `${thread}-note-${turn}`;
      entries.push({
        id: note,
        kind: "message",
        createdAt: at(minute, second - 2),
        message: {
          id: MessageId.make(note),
          role: "assistant",
          text: NOTES[(turn + call) % NOTES.length]!,
          turnId,
          createdAt: at(minute, second - 2),
          updatedAt: at(minute, second - 2),
          streaming: false,
        },
      });
    }
    const id = `${thread}-call-${turn}-${call}`;
    entries.push({
      id,
      kind: "work",
      createdAt: at(minute, second),
      entry: {
        id,
        createdAt: at(minute, second),
        turnId,
        toolCallId: `call-${id}`,
        label: "Run command",
        tone: "tool",
        itemType: "command_execution",
        command: COMMANDS[(turn * 3 + call) % COMMANDS.length]!,
        toolLifecycleStatus: "completed",
      },
    });
  }
  if (thread === "nova" && turn === 12) {
    entries.push(deployedToStage(`${thread}-deploy-${turn}`, turnId, at(minute, 6 + calls * 9)));
  }
  const answer = `${thread}-answer-${turn}`;
  const answerAt = at(minute, 8 + calls * 9);
  entries.push({
    id: answer,
    kind: "message",
    createdAt: answerAt,
    message: {
      id: MessageId.make(answer),
      role: "assistant",
      text: ANSWERS[(turn * 5 + thread.length) % ANSWERS.length]!,
      turnId,
      createdAt: answerAt,
      updatedAt: answerAt,
      streaming: false,
    },
  });
  return entries;
}

interface HarnessThread {
  readonly key: string;
  readonly name: string;
  readonly turns: number;
  /** Its Mate at work on the last turn: a call still running, the clock going. */
  readonly live?: boolean;
  /** Calls in its last run, taller than the pane: somewhere to read inside a run. */
  readonly lastCalls?: number;
  /**
   * Its last run is one the person started after a message whose own run
   * never came — a Stop before it began, then a restart — and it thinks
   * (Juno, 2026-09-30: its clock counted from the message the day before).
   */
  readonly unreached?: boolean;
}

const THREADS: ReadonlyArray<HarnessThread> = [
  { key: "nova", name: "Nova", turns: 14, lastCalls: 18 },
  { key: "juno", name: "Juno", turns: 9 },
  { key: "fen", name: "Fen", turns: 3 },
  { key: "mira", name: "Mira", turns: 5, live: true },
  { key: "iris", name: "Iris", turns: 3, live: true, unreached: true },
];

const LIVE_STARTED = Date.now() - 95_000;
const liveAt = (second: number) => new Date(LIVE_STARTED + second * 1000).toISOString();

function personSaid(id: string, createdAt: string, text: string): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt,
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      turnId: null,
      createdAt,
      updatedAt: createdAt,
      streaming: false,
    },
  };
}

/**
 * The conversation of a Mate whose last message but one never got a run: the
 * person's message 17 h 40 m before the run going now, and that run's first
 * thought still streaming. Built once, so the list meets the same rows.
 */
const unreachedConversations = new Map<string, TimelineEntry[]>();
function unreachedConversationOf(thread: HarnessThread): TimelineEntry[] {
  const known = unreachedConversations.get(thread.key);
  if (known) return known;
  const last = thread.turns - 1;
  const thought = `${thread.key}-thought-${last}`;
  const entries: TimelineEntry[] = [
    ...Array.from({ length: last }, (_, turn) =>
      turnEntries(thread.key, turn, 3 + ((turn * 7) % 6)),
    ).flat(),
    personSaid(
      `${thread.key}-ask-unreached`,
      new Date(LIVE_STARTED - (17 * 60 + 40) * 60_000).toISOString(),
      "Is the cache warmed on deploy?",
    ),
    personSaid(`${thread.key}-ask-${last}`, liveAt(0), ASKS[last % ASKS.length]!),
    {
      id: thought,
      kind: "message",
      createdAt: liveAt(3),
      message: {
        id: MessageId.make(thought),
        role: "reasoning",
        text: "Reading how the import files list the services before answering.",
        turnId: TurnId.make(`${thread.key}-turn-${last}`),
        createdAt: liveAt(3),
        updatedAt: liveAt(3),
        streaming: true,
      },
    },
  ];
  unreachedConversations.set(thread.key, entries);
  return entries;
}

/**
 * The live run streams from the page's load, shown or not: its answer grows
 * every 50 ms and a call lands every second, so its rows change under a
 * return to it.
 */
const STREAM_EVERY_MS = Number(params.get("stream") ?? 50);
const STREAM_STARTED = Date.now();
/**
 * `?end=<ms>`: the live run settles that long after the page loads — its
 * answer done, its turn completed — so its card's fold at the end can be
 * watched and sampled in the real list.
 */
const END_MS = Number(params.get("end") ?? 0);
/**
 * `?first=<ms>`: the live run has done nothing yet — its Mate thinks, and its
 * card holds its line alone — until its first call lands that long after the
 * page loads; then a call lands every second, its answer on its way.
 */
const FIRST_MS = Number(params.get("first") ?? 0);
/**
 * `?deploy=<from>,<to>`: a deploy to stage runs alongside the live run from
 * <from> ms after the page loads, its bar under the live line, and is done at
 * <to> — its bar leaves, as a finished one does.
 */
const DEPLOY_MS = params.get("deploy")?.split(",").map(Number) ?? null;
const runEnded = () => END_MS > 0 && Date.now() - STREAM_STARTED >= END_MS;
const streamTick = () => Math.floor((Date.now() - STREAM_STARTED) / STREAM_EVERY_MS);
const STREAM_WORDS =
  "The checkout now asks the payment service once per basket instead of once per line, so a basket of twelve items makes one call where it made twelve. I kept the old path behind the flag for a day in case the service rejects batched requests under load, and wrote down what to watch in the logs before we remove it.".split(
    " ",
  );

/** The run still going: its ask, the calls it made, one running, its answer on its way. */
function liveTurnEntries(
  thread: string,
  turn: number,
  tick: number,
  ended: boolean,
): TimelineEntry[] {
  const turnId = TurnId.make(`${thread}-turn-${turn}`);
  const ask = `${thread}-ask-${turn}`;
  const since = tick * STREAM_EVERY_MS;
  const calls =
    FIRST_MS === 0
      ? 4 + Math.floor(tick / 20)
      : since < FIRST_MS
        ? 0
        : 1 + Math.floor((since - FIRST_MS) / 1000);
  return [
    {
      id: ask,
      kind: "message",
      createdAt: liveAt(0),
      message: {
        id: MessageId.make(ask),
        role: "user",
        text: ASKS[turn % ASKS.length]!,
        turnId: null,
        createdAt: liveAt(0),
        updatedAt: liveAt(0),
        streaming: false,
      },
    },
    ...Array.from({ length: calls }, (_, call): TimelineEntry => {
      const id = `${thread}-call-${turn}-${call}`;
      return {
        id,
        kind: "work",
        createdAt: liveAt(5 + call * 20),
        entry: {
          id,
          createdAt: liveAt(5 + call * 20),
          turnId,
          toolCallId: `call-${id}`,
          label: "Run command",
          tone: "tool",
          itemType: "command_execution",
          command: COMMANDS[(turn + call) % COMMANDS.length]!,
          toolLifecycleStatus: "completed",
        },
      };
    }),
    ...(DEPLOY_MS !== null && since >= DEPLOY_MS[0]!
      ? [liveDeploy(thread, turn, turnId, since < DEPLOY_MS[1]! && !ended)]
      : []),
    ...(calls === 0 && !ended ? [] : [liveAnswer(thread, turn, turnId, tick, ended)]),
  ];
}

/** The deploy running alongside the live run (`?deploy=`), or done. */
function liveDeploy(thread: string, turn: number, turnId: TurnId, running: boolean): TimelineEntry {
  const id = `${thread}-deploy-${turn}`;
  return {
    id,
    kind: "operation",
    createdAt: liveAt(60),
    operation: {
      key: `op:${id}`,
      kind: "deploy",
      phase: running ? "running" : "done",
      anchorAt: liveAt(60),
      anchorActivityId: `activity-${id}`,
      ...(running ? {} : { settledAt: liveAt(90) }),
      turnId,
      subject: "stage",
      kicker: "Deploy · stage",
      voice: "Deploying to stage",
      voiceSource: "mate",
      statusWord: running ? "Deploying" : "Deployed",
      steps: [
        { id: "build", label: "Build", state: "done", stateLabel: "Done" },
        {
          id: "deploy",
          label: "Deploy",
          state: running ? "running" : "done",
          stateLabel: running ? "Running build commands from zerops.yml" : "Done",
        },
      ],
      links: [],
      callIds: [`call-${id}`],
      target: { hostname: "stage" },
      hasResult: !running,
    },
  };
}

/** The live run's answer, streaming until the run ends. */
function liveAnswer(
  thread: string,
  turn: number,
  turnId: TurnId,
  tick: number,
  ended: boolean,
): TimelineEntry {
  return {
    id: `${thread}-answer-${turn}`,
    kind: "message",
    createdAt: liveAt(95),
    message: {
      id: MessageId.make(`${thread}-answer-${turn}`),
      role: "assistant",
      text: Array.from(
        { length: 6 + tick },
        (_, word) => STREAM_WORDS[word % STREAM_WORDS.length],
      ).join(" "),
      turnId,
      createdAt: liveAt(95),
      updatedAt: liveAt(95),
      streaming: !ended,
    },
  };
}

/** A thread's conversation; the runs the person left fold to their Mate's words (K7). */
function conversationOf(thread: HarnessThread, tick: number, ended: boolean): TimelineEntry[] {
  if (thread.unreached) return unreachedConversationOf(thread);
  return Array.from({ length: thread.turns }, (_, turn) =>
    thread.live && turn === thread.turns - 1
      ? liveTurnEntries(thread.key, turn, tick, ended)
      : turnEntries(
          thread.key,
          turn,
          turn === thread.turns - 1 && thread.lastCalls !== undefined
            ? thread.lastCalls
            : 3 + ((turn * 7) % 6),
        ),
  ).flat();
}

function latestTurnOf(thread: HarnessThread, ended: boolean) {
  const last = thread.turns - 1;
  const turnId = TurnId.make(`${thread.key}-turn-${last}`);
  if (thread.live && ended) {
    return {
      turnId,
      state: "completed" as const,
      startedAt: liveAt(0),
      completedAt: new Date(STREAM_STARTED + END_MS).toISOString(),
    };
  }
  return thread.live
    ? { turnId, state: "running" as const, startedAt: liveAt(0), completedAt: null }
    : {
        turnId,
        state: "completed" as const,
        startedAt: at(last * 11),
        completedAt: at(last * 11, 90),
      };
}

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

const threadKeyOf = (key: string) => `${ENVIRONMENT}:${key}`;

/**
 * `__switchHarness.say(key, text)`: a message from the Mate lands at the end of
 * a conversation, shown or not — what a person reading history above meets.
 */
const said = new Map<string, ReadonlyArray<TimelineEntry>>();
const SAID_EVENT = "switch-harness-said";
function say(key: string, text: string) {
  const earlier = said.get(key) ?? [];
  const id = `${key}-said-${earlier.length}`;
  const at = new Date().toISOString();
  said.set(key, [
    ...earlier,
    {
      id,
      kind: "message",
      createdAt: at,
      message: {
        id: MessageId.make(id),
        role: "assistant",
        text,
        turnId: null,
        createdAt: at,
        updatedAt: at,
        streaming: false,
      },
    },
  ]);
  window.dispatchEvent(new Event(SAID_EVENT));
}

/**
 * `__switchHarness.probeFollow(key)`: what a person reading the shown
 * conversation meets as messages land, measured. From the end, following:
 * A — a wheel notch up animating in 10–40 px frames over ~200 ms; A2 — a
 * wheel notch and the browser's own smooth scroll 200 px up (its first
 * frames still within the end band); both while rows land every 60 ms;
 * B — ~600 px up, a row lands; C — the person's smooth scroll back to the
 * end, a row lands; D — following, a control in the live card's scroller
 * focused, ArrowUp and PageUp, rows land; E — ~300 px up, back to the end in
 * 40 px steps while rows stream in, a row lands. Each reports the row under
 * the reading line's move (0: held) and how far the list ends from its end.
 */
/** Whether the shown conversation follows its end, as the pane last decided. */
let shownFollows = true;

async function probeFollow(key: string) {
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const node = [...document.querySelectorAll<HTMLElement>("div")]
    .filter((element) => {
      const style = getComputedStyle(element);
      // The shown conversation's list: a kept one stands inert beside it.
      return (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        element.scrollHeight > element.clientHeight + 50 &&
        !element.closest("[inert]")
      );
    })
    .sort((a, b) => b.clientHeight - a.clientHeight)[0];
  if (!node) return null;
  const fromEnd = () => Math.round(node.scrollHeight - node.scrollTop - node.clientHeight);
  const rowAtReadingLine = () => {
    const box = node.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + 160);
  };
  const topOf = (element: Element | null) => element?.getBoundingClientRect().top ?? 0;
  const wheel = (deltaY: number) =>
    node.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
  let landed = 0;
  const land = () =>
    say(key, `Probe row ${landed++}: the build went through and the preview answers.`);
  const toEnd = async () => {
    wheel(100);
    node.scrollTop = node.scrollHeight;
    await wait(500);
  };
  const out: Record<string, number> = {};

  await toEnd();
  let lander = setInterval(land, 60);
  wheel(-100);
  for (const step of [12, 24, 36, 40, 34, 26, 18, 10]) {
    await frame();
    node.scrollTop -= step;
    await wait(25);
  }
  let anchor = rowAtReadingLine();
  let anchorTop = topOf(anchor);
  await wait(700);
  clearInterval(lander);
  await wait(400);
  out.A_anchorMovedPx = Math.round(topOf(anchor) - anchorTop);
  out.A_fromEnd = fromEnd();

  await toEnd();
  lander = setInterval(land, 60);
  wheel(-100);
  node.scrollBy({ top: -200, behavior: "smooth" });
  await frame();
  await frame();
  out.A2_firstFramesFromEnd = fromEnd();
  await wait(300);
  anchor = rowAtReadingLine();
  anchorTop = topOf(anchor);
  await wait(700);
  clearInterval(lander);
  await wait(400);
  out.A2_anchorMovedPx = Math.round(topOf(anchor) - anchorTop);
  out.A2_fromEnd = fromEnd();

  wheel(-100);
  node.scrollTop -= 600;
  await wait(400);
  anchor = rowAtReadingLine();
  anchorTop = topOf(anchor);
  land();
  await wait(500);
  out.B_anchorMovedPx = Math.round(topOf(anchor) - anchorTop);
  out.B_fromEnd = fromEnd();

  wheel(100);
  node.scrollBy({ top: fromEnd(), behavior: "smooth" });
  await wait(1200);
  land();
  await wait(600);
  out.C_fromEnd = fromEnd();

  // D — following, a control in the live card's own scroller focused, scroll
  // keys up (the card scrolled partway, so they scroll the card): rows land.
  const card = node.querySelector<HTMLElement>("[data-run-scroll]");
  if (card && card.scrollHeight > card.clientHeight) {
    await toEnd();
    card.scrollTop = Math.round((card.scrollHeight - card.clientHeight) / 2);
    // The fixture's card holds no disclosure: one stands in for it.
    const stand = card.querySelector("button")
      ? null
      : card.appendChild(Object.assign(document.createElement("button"), { textContent: "…" }));
    const control = card.querySelector<HTMLElement>("button")!;
    control.focus();
    for (const keyName of ["ArrowUp", "PageUp"]) {
      control.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true }));
    }
    land();
    await wait(300);
    land();
    await wait(500);
    out.D_cardKeysFromEnd = fromEnd();
    out.D_follows = Number(shownFollows);
    control.blur();
    stand?.remove();
  }

  // E — ~300 px up, the person scrolls back down in 40 px steps while rows
  // stream in every 120 ms; then a row lands.
  wheel(-100);
  node.scrollTop -= 300;
  await wait(400);
  lander = setInterval(land, 120);
  for (let step = 0; step < 120 && fromEnd() > 0; step++) {
    wheel(40);
    node.scrollTop += 40;
    await frame();
  }
  clearInterval(lander);
  await wait(200);
  land();
  await wait(600);
  out.E_backInStepsFromEnd = fromEnd();
  out.E_follows = Number(shownFollows);
  return out;
}

/**
 * What the pane reads for the routed thread: the server's copy after a first
 * open's wait, and what the app remembers of a thread it painted before
 * (`peekRememberedThreadTimeline`), read again from the server meanwhile.
 */
function useHarnessThread(key: string) {
  const [opened] = useState(() => new Set<string>());
  const [state, setState] = useState<{
    readonly key: string;
    readonly phase: "loading" | "syncing" | null;
  }>({ key, phase: opened.has(key) ? "syncing" : "loading" });
  if (state.key !== key) setState({ key, phase: opened.has(key) ? "syncing" : "loading" });
  useEffect(() => {
    const wait = opened.has(key) ? 300 : LATENCY_MS;
    const timer = setTimeout(() => {
      opened.add(key);
      setState((current) => (current.key === key ? { key, phase: null } : current));
    }, wait);
    return () => clearTimeout(timer);
  }, [key, opened]);
  const thread = THREADS.find((candidate) => candidate.key === key)!;
  const shown = state.key === key ? state.phase : opened.has(key) ? "syncing" : "loading";
  // A live run's rows change every 50 ms while it is shown, until it ends:
  // drawn from the tick kept in state — a tick read from the clock while
  // rendering is one the compiler keeps from the first render.
  const [streamed, setStreamed] = useState(streamTick);
  const [ended, setEnded] = useState(runEnded);
  useEffect(() => {
    if (!thread.live || ended) return;
    const stream = setInterval(() => {
      if (runEnded()) setEnded(true);
      else setStreamed(streamTick());
    }, STREAM_EVERY_MS);
    return () => clearInterval(stream);
  }, [thread.live, ended]);
  const tick = thread.live ? (ended ? Math.floor(END_MS / STREAM_EVERY_MS) : streamed) : 0;
  const [heard, setHeard] = useState(() => new Map(said));
  useEffect(() => {
    const hear = () => setHeard(new Map(said));
    window.addEventListener(SAID_EVENT, hear);
    return () => window.removeEventListener(SAID_EVENT, hear);
  }, []);
  const loading = shown === "loading";
  const entries = useMemo(
    () =>
      loading ? [] : [...conversationOf(thread, tick, ended), ...(heard.get(thread.key) ?? [])],
    [loading, thread, tick, ended, heard],
  );
  return { thread, live: thread.live === true && !ended, ended, phase: shown, entries };
}

const COMPOSER_HEIGHT = 132;

/** The harness's Mates are never removed. */
const keptForever = () => true;
/** Its kept lists are drawn as last shown: the harness has no store to read them from. */
const readsNothing = () => null;

function Pane({ threadKey }: { readonly threadKey: string }) {
  const { thread, live, ended, phase, entries } = useHarnessThread(threadKey);
  const listRef = useRef<LegendListRef | null>(null);
  const routeThreadKey = threadKeyOf(thread.key);
  // As ChatView: a thread left mid-read reopens there, any other follows its
  // end; following comes back only when the end is reached anew.
  const [follow, setFollow] = useState(() => ({
    key: routeThreadKey,
    enabled: readTimelinePosition(routeThreadKey)?.atEnd !== false,
    atEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false,
  }));
  if (follow.key !== routeThreadKey) {
    const atEnd = readTimelinePosition(routeThreadKey)?.atEnd !== false;
    setFollow({ key: routeThreadKey, enabled: atEnd, atEnd });
  }
  const liveFollowEnabled = follow.enabled;
  useEffect(() => {
    shownFollows = follow.enabled;
  }, [follow.enabled]);
  const onIsAtEndChange = useCallback<TimelineProps["onIsAtEndChange"]>((isAtEnd, scroll) => {
    setFollow((current) => {
      const enabled = nextTimelineFollow(current.enabled, {
        type: "position",
        atEnd: isAtEnd,
        ...scroll,
      });
      return current.atEnd === isAtEnd && current.enabled === enabled
        ? current
        : { ...current, atEnd: isAtEnd, enabled };
    });
  }, []);
  const onManualNavigation = useCallback(
    () => setFollow((current) => ({ ...current, enabled: false })),
    [],
  );
  // As ChatView: a wheel or a key up is the person reading history, and the
  // end stops being followed at once.
  const onPersonInput = useCallback<TimelineProps["onPersonInput"]>(
    (input) => {
      if (input.kind !== "wheel" && input.kind !== "key") return;
      if (input.direction === "up") {
        flushSync(onManualNavigation);
        return;
      }
      // Down in the end band is coming back.
      setFollow((current) => {
        const enabled = nextTimelineFollow(current.enabled, {
          type: "toward-end-input",
          inEndBand: current.atEnd,
        });
        return enabled === current.enabled ? current : { ...current, enabled };
      });
    },
    [onManualNavigation],
  );
  const latestTurn = useMemo(() => latestTurnOf(thread, ended), [thread, ended]);
  // What runs alongside the live run, as ChatView gives it the timeline.
  const dock = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking: live,
        runningTurnId: live ? latestTurn.turnId : null,
        agentPanelModel: emptyAgentPanelModel(),
        plan: null,
        pause: null,
      }),
    [entries, live, latestTurn],
  );
  const loading = phase === "loading";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <KeptTimelines
          open={routeThreadKey}
          alive={keptForever}
          Reader={readsNothing}
          crewTimeline={null}
          timeline={{
            isWorking: live,
            activeTurnStartedAt: live ? latestTurn.startedAt : null,
            listRef,
            timelineEntries: entries,
            latestTurn,
            runningTurnId: live ? latestTurn.turnId : null,
            turnDiffSummaries: [],
            working: dock,
            routeThreadKey,
            onOpenTurnDiff: () => undefined,
            supportsConversationRollback: false,
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
            liveFollowEnabled,
            onIsAtEndChange,
            onPersonInput,
            onManualNavigation,
            hideEmptyPlaceholder: loading,
            loading,
            syncing: phase !== null,
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
    </div>
  );
}

/** Fen's crew on the line: each crewmate's chat one of the harness's conversations. */
const LINE_CREW: ReadonlyArray<{
  readonly key: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly lead: boolean;
}> = [
  { key: "nova", name: "Lead", tint: "violet", lead: true },
  { key: "juno", name: "World Server", tint: "sky", lead: false },
  { key: "mira", name: "Game Rules", tint: "rose", lead: false },
];

/** The line over the pane, as `ChatHeader` draws it for a Mate with a crew. */
function LineHeader({
  current,
  onOpen,
}: {
  readonly current: string;
  readonly onOpen: (key: string) => void;
}) {
  const crew = LINE_CREW.map((seat): LineCrewmate => ({
    handle: seat.key,
    name: seat.name,
    tint: seat.tint,
    face: seat.key === "mira" ? "working" : "idle",
    lead: seat.lead,
    open: seat.key === current,
    known: true,
    threadId: ThreadId.make(seat.key),
    role: seat.lead ? ", Fen's lead" : ", one of Fen's crew",
    job: null,
    status: null,
  }));
  return (
    <div className="flex min-w-0 flex-1 items-center">
      <ConversationStripView
        chats={null}
        crew={crew}
        mate={{
          name: "Fen",
          tint: "amber",
          face: "idle",
          open: current === "fen",
          threadId: ThreadId.make("fen"),
          tooltip: current === "fen" ? null : "Fen's own chat",
        }}
        onCloseChat={() => undefined}
        onOpen={(threadId) => onOpen(threadId)}
        onRename={null}
        renameField={null}
        renderCrewmateMenu={() => null}
      />
    </div>
  );
}

function Harness() {
  const [current, setCurrent] = useState(LINE ? "fen" : THREADS[0]!.key);
  useEffect(() => {
    (window as unknown as { __switchHarness: unknown }).__switchHarness = {
      switchTo: (key: string) => setCurrent(key),
      say,
      probeFollow,
      follows: () => shownFollows,
      threads: THREADS.map((thread) => thread.key),
    };
  }, []);
  const thread = THREADS.find((candidate) => candidate.key === current)!;
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside
        className="flex shrink-0 flex-col gap-1 border-border border-r p-4"
        style={{ width: 435 }}
      >
        <p className="pb-2 text-muted-foreground text-xs">
          Switching Mates · first open waits {LATENCY_MS} ms
        </p>
        {THREADS.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            data-harness-thread={candidate.key}
            aria-current={candidate.key === current ? "true" : undefined}
            className="rounded-lg px-3 py-2 text-left text-sm aria-[current=true]:bg-accent"
            onClick={() => setCurrent(candidate.key)}
          >
            {candidate.name} · {candidate.turns} turns
          </button>
        ))}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {/* The app's own top bar (`WorkspacePageHeader`), so the conversation
            under it stands where ChatView's does. */}
        <WorkspacePageHeader
          className="relative bg-background font-medium text-sm"
          data-chat-header
        >
          {LINE ? <LineHeader current={current} onOpen={setCurrent} /> : thread.name}
        </WorkspacePageHeader>
        <Pane threadKey={current} />
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
