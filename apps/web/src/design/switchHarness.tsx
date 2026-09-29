/**
 * Switching between Mates' conversations, as the conversation pane does it
 * (T1): four Mates with conversations of their own, one of them at work; a
 * first open that waits on the server; a Mate opened before that paints from
 * what the app remembers; and a run the person opened folding as they leave
 * (the card's own fold, K7). A live Mate streams its answer from the page's
 * load, so a return to it meets rows changing under it.
 *
 * Served by the dev server at `/design-switch.html` (`?theme=dark`,
 * `?latency=<ms>` for the first open's wait, `?stream=<ms>` for how often the
 * live Mate's answer grows). `window.__switchHarness.switchTo("juno")`
 * switches from a script, so a per-frame sampler can watch a switch it
 * started itself.
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
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import type { LegendListRef } from "@legendapp/list/react";
import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";
import * as Stream from "effect/Stream";

import { MessagesTimeline } from "~/components/chat/MessagesTimeline";
import { TimelineSwitch } from "~/components/chat/TimelineSwitch";
import { readTimelinePosition } from "~/components/chat/timelineScrollAnchoring";
import type { TimelineEntry } from "~/session-logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import "../index.css";

const params = new URLSearchParams(location.search);
const LATENCY_MS = Number(params.get("latency") ?? 320);
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
}

const THREADS: ReadonlyArray<HarnessThread> = [
  { key: "nova", name: "Nova", turns: 14, lastCalls: 18 },
  { key: "juno", name: "Juno", turns: 9 },
  { key: "fen", name: "Fen", turns: 3 },
  { key: "mira", name: "Mira", turns: 5, live: true },
];

const LIVE_STARTED = Date.now() - 95_000;
const liveAt = (second: number) => new Date(LIVE_STARTED + second * 1000).toISOString();

/**
 * The live run streams from the page's load, shown or not: its answer grows
 * every 50 ms and a call lands every second, so its rows change under a
 * return to it.
 */
const STREAM_EVERY_MS = Number(params.get("stream") ?? 50);
const STREAM_STARTED = Date.now();
const streamTick = () => Math.floor((Date.now() - STREAM_STARTED) / STREAM_EVERY_MS);
const STREAM_WORDS =
  "The checkout now asks the payment service once per basket instead of once per line, so a basket of twelve items makes one call where it made twelve. I kept the old path behind the flag for a day in case the service rejects batched requests under load, and wrote down what to watch in the logs before we remove it.".split(
    " ",
  );

/** The run still going: its ask, the calls it made, one running, its answer on its way. */
function liveTurnEntries(thread: string, turn: number, tick: number): TimelineEntry[] {
  const turnId = TurnId.make(`${thread}-turn-${turn}`);
  const ask = `${thread}-ask-${turn}`;
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
    ...Array.from({ length: 4 + Math.floor(tick / 20) }, (_, call): TimelineEntry => {
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
    {
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
        streaming: true,
      },
    },
  ];
}

/** A thread's conversation; the runs the person left fold to their Mate's words (K7). */
function conversationOf(thread: HarnessThread, tick: number): TimelineEntry[] {
  return Array.from({ length: thread.turns }, (_, turn) =>
    thread.live && turn === thread.turns - 1
      ? liveTurnEntries(thread.key, turn, tick)
      : turnEntries(
          thread.key,
          turn,
          turn === thread.turns - 1 && thread.lastCalls !== undefined
            ? thread.lastCalls
            : 3 + ((turn * 7) % 6),
        ),
  ).flat();
}

function latestTurnOf(thread: HarnessThread) {
  const last = thread.turns - 1;
  const turnId = TurnId.make(`${thread.key}-turn-${last}`);
  return thread.live
    ? { turnId, state: "running" as const, startedAt: liveAt(0), completedAt: null }
    : {
        turnId,
        state: "completed" as const,
        startedAt: at(last * 11),
        completedAt: at(last * 11, 90),
      };
}

const threadKeyOf = (key: string) => `${ENVIRONMENT}:${key}`;

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
  // A live run's rows change every 50 ms while it is shown.
  const [, setStreamed] = useState(0);
  useEffect(() => {
    if (!thread.live) return;
    const stream = setInterval(() => setStreamed(streamTick), STREAM_EVERY_MS);
    return () => clearInterval(stream);
  }, [thread.live]);
  const tick = thread.live ? streamTick() : 0;
  const loading = shown === "loading";
  const entries = useMemo(
    () => (loading ? [] : conversationOf(thread, tick)),
    [loading, thread, tick],
  );
  return { thread, phase: shown, entries };
}

const COMPOSER_HEIGHT = 132;

function Pane({ threadKey }: { readonly threadKey: string }) {
  const { thread, phase, entries } = useHarnessThread(threadKey);
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
  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    setFollow((current) =>
      current.atEnd === isAtEnd
        ? current
        : { ...current, atEnd: isAtEnd, enabled: isAtEnd || current.enabled },
    );
  }, []);
  const onManualNavigation = useCallback(
    () => setFollow((current) => ({ ...current, enabled: false })),
    [],
  );
  const latestTurn = useMemo(() => latestTurnOf(thread), [thread]);
  const loading = phase === "loading";
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        // As ChatView: a wheel up is the person reading history, and the end
        // stops being followed.
        onWheelCapture={(event) => {
          if (event.deltaY < 0) onManualNavigation();
        }}
      >
        <TimelineSwitch switchKey={routeThreadKey}>
          <MessagesTimeline
            isWorking={thread.live === true}
            activeTurnStartedAt={thread.live ? latestTurn.startedAt : null}
            listRef={listRef}
            timelineEntries={entries}
            latestTurn={latestTurn}
            runningTurnId={thread.live ? latestTurn.turnId : null}
            turnDiffSummaries={[]}
            routeThreadKey={routeThreadKey}
            onOpenTurnDiff={() => undefined}
            supportsConversationRollback={false}
            onRevertToTurnCount={() => undefined}
            isRevertingCheckpoint={false}
            onImageExpand={() => undefined}
            activeThreadEnvironmentId={ENVIRONMENT}
            markdownCwd={undefined}
            resolvedTheme={appearance}
            timestampFormat="locale"
            workspaceRoot={undefined}
            anchorMessageId={null}
            onAnchorReady={() => undefined}
            contentInsetEndAdjustment={COMPOSER_HEIGHT}
            liveFollowEnabled={liveFollowEnabled}
            onIsAtEndChange={onIsAtEndChange}
            onManualNavigation={onManualNavigation}
            hideEmptyPlaceholder={loading}
            loading={loading}
            syncing={phase !== null}
            topFadeEnabled
          />
        </TimelineSwitch>
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

function Harness() {
  const [current, setCurrent] = useState(THREADS[0]!.key);
  useEffect(() => {
    (window as unknown as { __switchHarness: unknown }).__switchHarness = {
      switchTo: (key: string) => setCurrent(key),
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
        <header
          className="flex shrink-0 items-center border-border border-b px-5 font-medium text-sm"
          style={{ height: 52 }}
        >
          {thread.name}
        </header>
        <Pane threadKey={current} />
      </main>
    </div>
  );
}

/** The markdown's commands ask the account's grant what they may do: stand-ins that answer nothing. */
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
