import { EnvironmentId, MessageId, TurnId } from "@t3tools/contracts";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { act, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "../../session-logic";
import type { ChatMessage } from "../../types";
import type { MessagesTimelineRow, RecordItem, TurnHeaderActivity } from "./MessagesTimeline.logic";
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

  // One voice down the card's left edge: where two bubbles meet their
  // corners are small, and only the first keeps its top corner round.
  it("sets the bubbles on one spine", () => {
    const [first, ...rest] = bubbles(
      draw(record([thought("r1", "One."), thought("r2", "Two."), thought("r3", "Three.")])),
    );
    expect(first?.tag).toContain("rounded-es-md");
    expect(first?.tag).not.toContain("rounded-s-md");
    for (const bubble of rest) expect(bubble.tag).toContain("rounded-s-md");
  });

  it("stands the face beside what the Mate is on, and only while it works", () => {
    const now: TurnHeaderActivity = {
      kind: "thinking",
      key: "thought:r9",
      messages: [message("r9", "reasoning", "Checking the route next.")],
    };
    const live = draw(record([thought("r1", "One.")], { live: true, now }));
    expect(live.match(/data-mate-face-state="working"/g)).toHaveLength(1);
    // The face is in the newest row, beside the thought it is thinking.
    const newest = live.slice(live.lastIndexOf("data-chat-row"));
    expect(newest).toContain("data-mate-face-state");
    expect(newest).toContain("Checking the route next.");
    expect(draw(record([thought("r1", "One.")]))).not.toContain("data-mate-face-state");
  });

  // The person's rule for their own messages, with one difference: what the
  // Mate is writing now is always whole (the owner, 2026-09-27: "the current
  // message being written should absolutely be visible in full").
  it("never folds the thought it is thinking, however long, and offers no fold under it", () => {
    const markup = draw(
      record([], {
        live: true,
        now: { kind: "thinking", key: "thought:r9", messages: [message("r9", "reasoning", LONG)] },
      }),
    );
    expect(markup).toContain('data-chat-folded="false"');
    expect(markup).not.toContain("Show full message");
    expect(markup).not.toContain("Show less");
  });

  it("folds what the chat opens onto past the limits, and leaves the rest whole", () => {
    const markup = draw(record([thought("r1", LONG), thought("r2", "Short.")]));
    expect(markup.match(/data-chat-folded="true"/g)).toHaveLength(1);
    expect(markup.match(/>Show full message</g)).toHaveLength(1);
  });

  it("folds a command past its eighth line, saying how many there are", () => {
    const markup = draw(
      record([
        step(command("w1", SCRIPT, { callInput: { description: "Write the status route" } })),
      ]),
    );
    expect(markup).toContain('data-chat-folded="true"');
    expect(markup).toContain(">Show all 16 lines<");
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
    act(() => button(renderer, "Show all 16 lines").props.onClick());
    expect(folded()).toBe("false");
    act(() => button(renderer, "Show less").props.onClick());
    expect(folded()).toBe("true");
  });
});
