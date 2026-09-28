import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow, RecordItem, RunStatus } from "./MessagesTimeline.logic";
import { foldsLikeAMessage, RunChat } from "./RunChat";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineContext";
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

  // Its words and what it did cannot be taken for one another (the owner,
  // 2026-09-28: "command looks exactly like responses"): only its words are a
  // filled, round bubble; a call is a row of an outlined card, led by its
  // kind's mark.
  it("fills only the Mate's words; what it did is a row of an outlined card", () => {
    const markup = draw(
      record([
        {
          kind: "note",
          key: "note:a1",
          at: at(10),
          message: message("a1", "assistant", "Found it."),
        },
        step(command("w1", "npm test", { callInput: { description: "Run the tests" } })),
      ]),
    );
    const [said, did] = bubbles(markup);
    expect(said?.tag).toContain("bg-foreground/8");
    expect(said?.tag).toContain("rounded-2xl");
    expect(did?.tag).not.toContain("bg-foreground/8");
    expect(markup).toMatch(/<div class="[^"]*rounded-xl border[^"]*" data-chat-calls="true">/);
    expect(markup).toContain("lucide-square-terminal");
  });

  // Ten reads in a row are one stretch of work (the owner, 2026-09-28: "there
  // is no spacing between items"): a run of calls shares one card, a hairline
  // between them; a thought or its words between two calls start a new one.
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

  // The Mate's status is the chat's last line, never a heading over the card
  // (the owner, 2026-09-28: "it doesn't need to be at the top"): its face,
  // what it is doing, its clock — the one face in the chat.
  it.each([
    { name: "thinking", now: null, says: "Nova is thinking", face: "working" },
    { name: "writing", now: { kind: "writing" }, says: "Nova is writing", face: "working" },
    {
      name: "waiting on the person",
      now: { kind: "waiting" },
      says: "Nova is waiting for your answer",
      face: "needs",
    },
  ] as const)("says under its chat what the Mate is doing: $name", ({ now, says, face }) => {
    const markup = draw(record([thought("r1", "One.")], { live: true, now, status: status() }));
    expect(markup.match(/data-mate-face-state="[a-z]+"/g)).toEqual([
      `data-mate-face-state="${face}"`,
    ]);
    expect(markup).toContain(says);
    // It stands under the chat's scroll, not in it.
    expect(markup.indexOf(says)).toBeGreaterThan(markup.lastIndexOf("data-chat-row"));
    // No bubble stands in for what the status line says.
    expect(markup).not.toContain('data-chat-kind="typing');
    expect(markup).not.toContain('data-chat-kind="waiting"');
  });

  it("says who worked and for how long once the run is over, where it said what it did", () => {
    const markup = draw(
      record([thought("r1", "One.")], {
        status: status({ live: false, face: "produced", endedAt: at(72) }),
      }),
    );
    expect(markup).toContain("Nova worked");
    expect(markup).toMatch(/data-work-line-clock[^>]*>1m 12s</);
    expect(markup).toContain('data-mate-face-state="done"');
    expect(draw(record([thought("r1", "One.")]))).not.toContain("data-mate-face-state");
  });

  // A long thought scrolls inside itself while it is thought, its newest
  // words in sight, and folds to its top once it ends — at the same height
  // (the owner, 2026-09-28: "the long thinking blocks needs to start inner
  // scrolling with fade at the same cutoff").
  it("keeps the thought it is thinking to eight lines that scroll, and offers no fold under it", () => {
    const markup = draw(
      record([], {
        live: true,
        now: { kind: "thinking", key: "thought:r9", messages: [message("r9", "reasoning", LONG)] },
      }),
    );
    expect(markup).toMatch(/class="[^"]*max-h-36[^"]*overflow-y-auto/);
    expect(markup).not.toContain("data-chat-folded");
    expect(markup).not.toContain("Show more");
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
    expect(markup.match(/>Show more</g)).toHaveLength(1);
    expect(markup.match(/>Show full message</g)).toHaveLength(1);
  });

  // A script arrives whole, so it is never "being written": four of its
  // lines from its first frame, running or done (the owner, 2026-09-28: "I
  // see 100s of LoC printed directly").
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
        now: {
          kind: "step",
          step: stepOf(
            command("w9", SCRIPT, {
              toolLifecycleStatus: "inProgress",
              sourceActivityKind: "tool.started",
            }),
            undefined,
            false,
          ),
        },
      }),
    );
    expect(running).toContain('data-chat-folded="true"');
  });

  // The person's words stand on the page above the card; the chat marks, in
  // short and on their side, where they reached the Mate (the owner,
  // 2026-09-28: "shown the user message in short inside the working group").
  it("marks where the person's words reached the Mate, in one line on their side", () => {
    const markup = draw(
      record([
        {
          kind: "person",
          key: "person:u2",
          at: at(5),
          message: {
            ...message("u2", "assistant", "Keep /health working too\nThe load balancer calls it."),
            role: "user",
          },
          imageOnly: false,
        },
      ]),
    );
    expect(markup).toMatch(
      /justify-end[^>]*><p[^>]*data-chat-kind="person"[^>]*>Keep \/health working too</,
    );
    expect(markup).not.toContain("The load balancer calls it.");
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
    expect(
      JSON.stringify(details()[0]?.findAll((node) => node.type === "pre")[0]?.children),
    ).toContain("48.2 kB");
    act(() =>
      button(renderer, "Run the production build").props.onClick({
        currentTarget: { closest: () => null },
      }),
    );
    expect(details()).toHaveLength(0);
  });

  // The timeline moves its rows' nodes as it lays them out, and the browser
  // forgets a moved node's scroll with no event to say so: a chat at its
  // newest opened at its first bubble after a reload (2026-09-28).
  it("takes its newest bubble back when its end leaves sight while it follows", () => {
    const savedObserver = globalThis.IntersectionObserver;
    let report: ((entries: ReadonlyArray<{ readonly isIntersecting: boolean }>) => void) | null =
      null;
    globalThis.IntersectionObserver = class {
      constructor(callback: typeof report) {
        report = callback;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    const scroller = {
      scrollTop: 0,
      scrollHeight: 900,
      clientHeight: 440,
      getBoundingClientRect: () => ({ top: 0, bottom: 440, height: 440 }),
    };
    try {
      act(() => {
        create(
          <Rows>
            <RunChat row={record([step(command("w1", "git status"))])} />
          </Rows>,
          {
            createNodeMock: (element) =>
              element.type === "div" && element.props["onScroll"] !== undefined ? scroller : {},
          },
        );
      });
      expect(scroller.scrollTop).toBe(900);
      // The row's node moved: the browser put the chat back at its top.
      scroller.scrollTop = 0;
      act(() => report?.([{ isIntersecting: false }]));
      expect(scroller.scrollTop).toBe(900);
    } finally {
      globalThis.IntersectionObserver = savedObserver;
    }
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
    const press = (words: string) =>
      act(() => button(renderer, words).props.onClick({ currentTarget: { closest: () => null } }));
    press("Show all 16 lines");
    expect(folded()).toBe("false");
    press("Show less");
    expect(folded()).toBe("true");
  });
});
