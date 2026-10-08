// @vitest-environment happy-dom
import { projectMateLimit } from "@t3tools/client-runtime/data";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { formatUpcomingTimestamp } from "../../timestampFormat";
import { EventLine, PauseBlock, type ConversationSpeaker } from "./ConversationRows";

const NOVA: ConversationSpeaker = { name: "Nova", tint: "sky" };
const NOW_MS = Date.parse("2026-09-27T10:00:00.000Z");
const limitAt = (resetsAt: string | null, provider = "Claude") =>
  projectMateLimit(
    {
      latestTurn: null,
      session: { lastError: `${provider} usage limit reached`, usageLimitResetAt: resetsAt },
    },
    NOW_MS,
  );
const at = (secondsAgo: number) => new Date(NOW_MS - secondsAgo * 1000).toISOString();

describe("the usage-limit pause", () => {
  const render = (
    autoResume: boolean | null,
    reset: string | null,
    resumedAt: string | null = null,
  ) =>
    renderToStaticMarkup(
      <PauseBlock
        nowMs={NOW_MS}
        limit={limitAt(reset, "Codex")}
        row={{
          kind: "pause",
          id: "pause:1",
          createdAt: at(600),
          resetsAt: reset,
          resumedAt,
          held: 0,
          provider: "Codex",
        }}
        serverPause={reset === null || autoResume === null ? null : { resetsAt: reset, autoResume }}
        onAutoResumeChange={null}
        speaker={NOVA}
        timestampFormat="24-hour"
      />,
    );
  it("shows the day of a weekly reset in the continuation explanation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    try {
      const reset = new Date(NOW_MS + 7 * 86_400_000).toISOString();
      const when = formatUpcomingTimestamp(reset, "24-hour", NOW_MS);
      const notice = render(false, reset);
      expect(notice).toContain("Nova hit the Codex limit.");
      expect(notice).toContain(`Reset time: ${when}.`);
    } finally {
      vi.useRealTimers();
    }
  });
  it("names the agent whose limit holds the work", () => {
    expect(render(false, null)).toContain("Nova hit the Codex limit.");
    expect(render(false, null)).toContain("hasn&#x27;t given a reset time");
  });
  it("only promises automatic continuation when the server has enabled it", () => {
    const reset = new Date(NOW_MS + 3_600_000).toISOString();
    expect(render(true, reset)).toContain(
      `try again automatically at ${formatUpcomingTimestamp(reset, "24-hour", NOW_MS)}`,
    );
    expect(render(false, reset)).toContain("Automatic continuation is off");
    expect(render(false, reset)).not.toContain("Send a message");
  });
  it("a passed reset time cannot claim the Mate has resumed", () => {
    expect(render(true, at(60))).not.toContain("still paused");
    expect(render(true, at(60))).toContain("Reset time passed");
    expect(render(true, at(60))).not.toContain("Limit · until");
    expect(render(true, at(60))).toContain("Nova hit the Codex limit on ");
    expect(render(true, at(60))).not.toContain("picking up");
  });
  it("a known reset cannot invent an unread continuation choice", () => {
    const reset = new Date(NOW_MS + 3_600_000).toISOString();
    const notice = render(null, reset);
    expect(notice).toContain(`Reset time: ${formatUpcomingTimestamp(reset, "24-hour", NOW_MS)}.`);
    expect(notice).not.toContain("Automatic continuation is off");
    expect(notice).not.toContain("try again automatically");
  });
  it("only a resume receipt says it picked up again", () => {
    expect(render(true, at(60), at(30))).toContain("Nova picked up again");
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

  it("an expired refusal cannot Continue until the pending request is answered", async () => {
    const continued = vi.fn();
    const show = (blockedByAnswer: boolean) =>
      act(() =>
        root!.render(
          <PauseBlock
            nowMs={NOW_MS}
            row={{
              kind: "pause",
              id: "refused",
              createdAt: at(600),
              resetsAt: at(60),
              resumedAt: null,
              held: 0,
              provider: "Claude",
            }}
            serverPause={null}
            limit={limitAt(at(60))}
            blockedByAnswer={blockedByAnswer}
            onAutoResumeChange={null}
            onContinue={blockedByAnswer ? null : continued}
            speaker={NOVA}
            timestampFormat="24-hour"
          />,
        ),
      );
    await show(true);
    const button = document.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Respond to Nova's pending request before continuing.",
    );
    await act(() => {
      button.click();
      button.click();
    });
    expect(continued).not.toHaveBeenCalled();
    await show(false);
    await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(continued).toHaveBeenCalledOnce();
  });

  it.each([null, at(60), new Date(NOW_MS + 3_600_000).toISOString()])(
    "offers an explicit continuation whether the reset time is known (%s)",
    async (resetsAt) => {
      const continued = vi.fn();
      const row = {
        kind: "pause" as const,
        id: "pause:continue",
        createdAt: at(600),
        resetsAt,
        resumedAt: null,
        held: 0,
      };
      const show = (resumedAt: string | null) =>
        act(() =>
          root!.render(
            <PauseBlock
              nowMs={NOW_MS}
              row={{ ...row, resumedAt }}
              serverPause={null}
              limit={limitAt(resetsAt)}
              onAutoResumeChange={null}
              onContinue={continued}
              speaker={NOVA}
              timestampFormat="24-hour"
            />,
          ),
        );
      await show(null);
      const button = document.querySelector<HTMLButtonElement>("button");
      expect(button?.textContent).toBe("Continue");
      await act(() => button!.click());
      if (resetsAt !== null && Date.parse(resetsAt) > NOW_MS) {
        expect(continued).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("can't continue");
      } else expect(continued).toHaveBeenCalledOnce();
      await show(at(30));
      expect(document.querySelector("button")).toBeNull();
    },
  );

  it("Continue before a known reset explains the wait without submitting another attempt", async () => {
    const continued = vi.fn();
    const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
    await act(() =>
      root!.render(
        <PauseBlock
          nowMs={NOW_MS}
          row={{
            kind: "pause",
            id: "waiting",
            createdAt: at(600),
            resetsAt,
            resumedAt: null,
            held: 0,
            provider: "Claude",
          }}
          serverPause={{ resetsAt, autoResume: false }}
          limit={limitAt(resetsAt)}
          onAutoResumeChange={null}
          onContinue={continued}
          speaker={NOVA}
          timestampFormat="24-hour"
        />,
      ),
    );
    await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(continued).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Nova can't continue with Claude before");
    expect(document.body.textContent).toContain(
      formatUpcomingTimestamp(resetsAt, "24-hour", NOW_MS),
    );
  });

  it("an early recovery leaves the dated refusal but Continue submits immediately", async () => {
    const continued = vi.fn();
    const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
    const show = (serverPause: { resetsAt: string; autoResume: boolean } | null) =>
      act(() =>
        root!.render(
          <PauseBlock
            nowMs={NOW_MS}
            row={{
              kind: "pause",
              id: "recovered",
              createdAt: at(600),
              resetsAt,
              resumedAt: null,
              held: 0,
              provider: "Claude",
            }}
            serverPause={serverPause}
            limit={serverPause === null ? { kind: "none" } : limitAt(resetsAt)}
            onAutoResumeChange={null}
            onContinue={continued}
            speaker={NOVA}
            timestampFormat="24-hour"
          />,
        ),
      );
    await show({ resetsAt, autoResume: false });
    await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
    await show(null);
    await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
    expect(continued).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("limit still holds");
    expect(document.querySelector('[data-mate-status="limit"]')).toBeNull();
    expect(document.body.textContent).toContain("Nova hit the Claude limit on");
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
              limit={limitAt(resetsAt)}
              speaker={NOVA}
              timestampFormat="24-hour"
            />,
          );
        });

      await show(autoResume);
      const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]');
      if (toggle === null) throw new Error("The pause has no automatic-resume choice.");
      expect(toggle.getAttribute("aria-checked")).toBe(String(autoResume));
      expect(toggle.closest("label")?.textContent).toContain("Continue automatically");

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
  });
});
