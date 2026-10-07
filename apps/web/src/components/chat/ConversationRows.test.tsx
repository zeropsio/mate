// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EventLine, PauseBlock, type ConversationSpeaker } from "./ConversationRows";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

const NOVA: ConversationSpeaker = { name: "Nova", tint: "sky" };
const NOW_MS = Date.parse("2026-09-27T10:00:00.000Z");
const at = (secondsAgo: number) => new Date(NOW_MS - secondsAgo * 1000).toISOString();

/** The class list of every opening tag that carries `marker`, in document order. */
function classesOf(markup: string, marker: string): ReadonlyArray<ReadonlyArray<string>> {
  return [...markup.matchAll(/<[a-z][^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes(marker))
    .map((tag) => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" "));
}

/** A spacing step as Tailwind writes it — `ps-5.5` is 5.5 — or 0 when the list has none. */
function step(classes: ReadonlyArray<string>, prefix: string): number {
  const found = classes.find((name) => name.startsWith(`${prefix}-`));
  return found === undefined ? 0 : Number(found.slice(prefix.length + 1));
}

describe("the usage-limit pause", () => {
  const pause = (resumedAt: string | null): Extract<MessagesTimelineRow, { kind: "pause" }> => ({
    kind: "pause",
    id: "pause:1",
    createdAt: at(600),
    resetsAt: new Date(NOW_MS + 3_600_000).toISOString(),
    resumedAt,
    held: 0,
  });
  const render = (resumed: boolean) =>
    renderToStaticMarkup(
      <PauseBlock
        nowMs={NOW_MS}
        onAutoResumeChange={resumed ? null : () => undefined}
        row={pause(resumed ? at(60) : null)}
        serverPause={
          resumed
            ? null
            : { resetsAt: new Date(NOW_MS + 3_600_000).toISOString(), autoResume: true }
        }
        speaker={NOVA}
        timestampFormat="24-hour"
      />,
    );

  // Paused and picked up again, it is one block: the same head in the same
  // size, the same mark, and what it says under its words, never its mark.
  it.each([
    { state: "paused", resumed: false },
    { state: "resumed", resumed: true },
  ])("the $state pause heads in one size and one mark", ({ resumed }) => {
    const markup = render(resumed);
    const [head = []] = classesOf(markup, "data-pause-head");
    expect(head).toContain("text-line");
    expect(head).not.toContain("text-sm");
    const [mark = []] = classesOf(markup, "lucide-pause");
    expect(mark).toContain("size-3.5");
    expect(markup).toMatch(/data-pause-head[^>]*><span[^>]*data-line-mark/);
  });

  it.each([
    { state: "paused", resumed: false, lines: ["data-pause-detail", "data-pause-switch"] },
    { state: "resumed", resumed: true, lines: ["data-pause-detail"] },
  ])("the $state pause says what follows on its words' edge", ({ resumed, lines }) => {
    const markup = render(resumed);
    const [head = []] = classesOf(markup, "data-pause-head");
    const [mark = []] = classesOf(markup, "data-line-mark");
    const wordsEdge = step(mark, "w") + step(head, "gap");
    for (const line of lines) {
      const [classes = []] = classesOf(markup, line);
      expect(step(classes, "ps"), line).toBe(wordsEdge);
    }
  });

  // Gone quiet it is a line like an event's: nothing stands before its mark.
  it("the resumed pause keeps its mark on the text edge", () => {
    const [block = []] = classesOf(render(true), "data-conversation-pause");
    expect(block).toContain("border-x-0");
    expect(block.some((name) => /^(px|ps)-/.test(name))).toBe(false);
  });
});

describe("the pause's automatic-resume choice", () => {
  let root: Root | undefined;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });
  afterEach(async () => {
    await act(() => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each([
    { autoResume: true, next: "off" },
    { autoResume: false, next: "on" },
  ])(
    "the pause shows the thread's automatic-resume choice and lets the person turn it $next",
    async ({ autoResume }) => {
      const changed = vi.fn<(enabled: boolean) => void>();
      const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
      const show = (choice: boolean) =>
        act(() => {
          root!.render(
            <PauseBlock
              nowMs={NOW_MS}
              onAutoResumeChange={changed}
              row={{
                kind: "pause",
                id: "pause:choice",
                createdAt: at(600),
                resetsAt,
                resumedAt: null,
                held: 0,
              }}
              serverPause={{ resetsAt, autoResume: choice }}
              speaker={NOVA}
              timestampFormat="24-hour"
            />,
          );
        });

      await show(autoResume);
      const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]');
      if (toggle === null) throw new Error("The pause has no automatic-resume choice.");
      expect(toggle.getAttribute("aria-checked")).toBe(String(autoResume));
      expect(toggle.closest("label")?.textContent).toContain("Resume by itself at the reset");

      await act(() => toggle.click());
      expect(changed).toHaveBeenCalledWith(!autoResume);
      await show(!autoResume);
      expect(toggle.getAttribute("aria-checked")).toBe(String(!autoResume));
    },
  );
});

describe("a slash command's line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // A /compact runs for minutes: its line counts them the way the work line
  // does, and once it is done it says what it came to and nothing more.
  it.each([
    {
      name: "a /compact while it runs counts its time",
      command: { name: "compact", args: "" },
      done: false,
      says: "Condensing the context · 1m 32s",
    },
    {
      name: "a /compact once done says what it came to",
      command: { name: "compact", args: "" },
      done: true,
      says: "Context condensed — Nova kept a summary of the conversation so far",
    },
    {
      name: "any other command is what the person ran",
      command: { name: "model", args: "opus" },
      done: false,
      says: "You ran /model opus",
    },
  ])("$name", ({ command, done, says }) => {
    const markup = renderToStaticMarkup(
      <EventLine
        at={at(92)}
        event={{ type: "command", command, done }}
        speaker={NOVA}
        timestampFormat="24-hour"
      />,
    );
    expect(markup.replace(/<[^>]*>/g, "")).toBe(says);
    // All of it, the clock too, stands in the line's one truncating span: a
    // clock that grows never wraps the line onto a second one.
    const words = /class="min-w-0 truncate"[^>]*>(.*?)<\/span><\/div>$/.exec(markup)?.[1] ?? "";
    expect(words.replace(/<[^>]*>/g, "")).toBe(says);
  });
});
