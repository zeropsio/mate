// @vitest-environment happy-dom
import { projectMateLimit } from "@t3tools/client-runtime/data";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { formatUpcomingTimestamp } from "../../timestampFormat";
import {
  EventLine,
  HeldMessageLine,
  LimitContinue,
  NoticeLine,
  PauseBlock,
  type ConversationSpeaker,
} from "./ConversationRows";

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
  // CI saw "the coding agent's limit", then "the Codex limit": the live limit learnt the agent late.
  it.each([
    { record: "Claude", live: "coding agent", says: "Nova hit the Claude limit." },
    { record: "Codex", live: "Claude", says: "Nova hit the Codex limit." },
    { record: undefined, live: "coding agent", says: "Nova hit the coding agent's limit." },
  ])(
    "names the agent its own record names from the first paint ($record, live $live)",
    ({ record, live, says }) => {
      const reset = new Date(NOW_MS + 3_600_000).toISOString();
      const html = renderToStaticMarkup(
        <PauseBlock
          nowMs={NOW_MS}
          limit={{ kind: "limited", turnId: null, provider: live, resetsAt: reset }}
          row={{
            kind: "pause",
            id: "pause:1",
            createdAt: at(600),
            resetsAt: null,
            resumedAt: null,
            held: 0,
            ...(record === undefined ? {} : { provider: record }),
          }}
          serverPause={null}
          speaker={NOVA}
          timestampFormat="24-hour"
        />,
      );
      expect(html.replaceAll("&#x27;", "'")).toContain(says);
    },
  );
  it.each([
    { resumedAt: null, says: "Nova hit Claude's weekly limit." },
    { resumedAt: at(30), says: "Nova hit Claude's weekly limit on " },
  ])(
    "names the weekly window its record names, live and after ($resumedAt)",
    ({ resumedAt, says }) => {
      const reset = new Date(NOW_MS + 3_600_000).toISOString();
      const html = renderToStaticMarkup(
        <PauseBlock
          nowMs={NOW_MS}
          limit={
            resumedAt === null
              ? { kind: "limited", turnId: null, provider: "Claude", resetsAt: reset }
              : { kind: "none" }
          }
          row={{
            kind: "pause",
            id: "pause:1",
            createdAt: at(600),
            resetsAt: null,
            resumedAt,
            held: 0,
            provider: "Claude",
            window: "7-day",
          }}
          serverPause={null}
          speaker={NOVA}
          timestampFormat="24-hour"
        />,
      );
      expect(html.replaceAll("&#x27;", "'")).toContain(says);
    },
  );
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

// The owner's pick on the "Answer Then More Work" board (B5, 2026-10-12): "The card waits through
// the pause." Continue stands at the waiting card's head, at its right edge, with every rule the
// pause's notice had.
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
  const head = (props: Partial<Parameters<typeof LimitContinue>[0]>) =>
    act(() =>
      root!.render(
        <LimitContinue
          nowMs={NOW_MS}
          pause={{ resetsAt: null, provider: "Claude" }}
          speaker={NOVA}
          timestampFormat="24-hour"
          {...props}
        />,
      ),
    );
  const continueButton = () =>
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Continue");

  it("an expired refusal cannot Continue until the pending request is answered", async () => {
    const continued = vi.fn();
    const show = (blockedByAnswer: boolean) =>
      head({
        pause: { resetsAt: at(60), provider: "Claude" },
        limit: limitAt(at(60)),
        blockedByAnswer,
        onContinue: blockedByAnswer ? null : continued,
      });
    await show(true);
    expect(continueButton()).toBeUndefined();
    expect(document.body.textContent).toContain("Answer the pending question to continue.");
    expect(continued).not.toHaveBeenCalled();
    await show(false);
    await act(() => continueButton()!.click());
    expect(continued).toHaveBeenCalledOnce();
  });

  it.each([null, at(60), new Date(NOW_MS + 3_600_000).toISOString()])(
    "offers an explicit continuation whether the reset time is known (%s)",
    async (resetsAt) => {
      const continued = vi.fn();
      const show = (resumed: boolean) =>
        head({
          // Gone on, the card waits no more: its head offers nothing.
          pause: resumed ? null : { resetsAt },
          limit: limitAt(resetsAt),
          onContinue: continued,
        });
      await show(false);
      const button = continueButton();
      expect(button?.textContent).toBe("Continue");
      await act(() => button!.click());
      if (resetsAt !== null && Date.parse(resetsAt) > NOW_MS) {
        expect(continued).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain("can't continue");
      } else expect(continued).toHaveBeenCalledOnce();
      await show(true);
      expect(document.querySelector("button")).toBeNull();
    },
  );

  it("Continue before a known reset explains the wait without submitting another attempt", async () => {
    const continued = vi.fn();
    const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
    await head({
      pause: { resetsAt, provider: "Claude" },
      limit: limitAt(resetsAt),
      onContinue: continued,
    });
    await act(() => continueButton()!.click());
    expect(continued).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Nova can't continue with Claude before");
    expect(document.body.textContent).toContain(
      formatUpcomingTimestamp(resetsAt, "24-hour", NOW_MS),
    );
  });

  // Milo, 2026-10-10: signed in to another subscription, the limit was gone a day before its
  // reset, and Continue only said it could not continue before then.
  it("on the Mate's engine, Continue before a known reset asks the Mate to try now", async () => {
    const continued = vi.fn();
    const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
    await head({
      pause: { resetsAt, provider: "Claude" },
      limit: limitAt(resetsAt),
      onContinue: continued,
      triesBeforeReset: true,
    });
    await act(() => continueButton()!.click());
    expect(continued).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("can't continue");
  });

  it("an early recovery leaves the dated refusal but Continue submits immediately", async () => {
    const continued = vi.fn();
    const resetsAt = new Date(NOW_MS + 3_600_000).toISOString();
    const show = (recovered: boolean) =>
      head({
        pause: { resetsAt, provider: "Claude" },
        limit: recovered ? { kind: "none" } : limitAt(resetsAt),
        onContinue: continued,
      });
    await show(false);
    await act(() => continueButton()!.click());
    await show(true);
    await act(() => continueButton()!.click());
    expect(continued).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("can't continue");
  });
});

// The owner's pick on the "Composer Strips" board (S6, 2026-10-12): "the held message shows its send
// time under it instead of only on hover".
describe("a message a usage limit holds", () => {
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
    {
      resetsAt: "2026-09-27T14:00:00.000Z",
      says: `Sends when the limit resets at ${formatUpcomingTimestamp("2026-09-27T14:00:00.000Z", "24-hour")}`,
    },
    { resetsAt: null, says: "Sends when the limit resets" },
  ])(
    "says under it when it goes, and Don't send withdraws it: $says",
    async ({ resetsAt, says }) => {
      const withdrawn = vi.fn();
      await act(() =>
        root!.render(
          <HeldMessageLine onWithdraw={withdrawn} resetsAt={resetsAt} timestampFormat="24-hour" />,
        ),
      );
      expect(document.body.textContent).toBe(`${says}Don't send`);
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(withdrawn).toHaveBeenCalledOnce();
    },
  );

  it("offers no Don't send where the message cannot be withdrawn", async () => {
    await act(() =>
      root!.render(<HeldMessageLine onWithdraw={null} resetsAt={null} timestampFormat="24-hour" />),
    );
    expect(document.body.textContent).toBe("Sends when the limit resets");
    expect(document.querySelector("button")).toBeNull();
  });
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

describe("a notice's row", () => {
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
    { unavailable: null, runs: true },
    { unavailable: "Compacting is unavailable right now", runs: false },
  ])(
    "says what happened, runs its one action unless it is unavailable ($unavailable), and dismisses",
    async ({ unavailable, runs }) => {
      const act1 = vi.fn();
      const dismiss = vi.fn();
      await act(() =>
        root!.render(
          <NoticeLine
            notice={{
              id: "n",
              icon: <span />,
              words: (
                <>
                  <strong>Resume with less context</strong> · 180k tokens from an older session
                </>
              ),
              action: { label: "Compact", onAction: act1, unavailable },
              dismissLabel: "Keep full history",
              onDismiss: dismiss,
            }}
          />,
        ),
      );
      expect(document.body.textContent).toContain(
        "Resume with less context · 180k tokens from an older session",
      );
      const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
      const compact = buttons.find((button) => button.textContent === "Compact")!;
      await act(() => compact.click());
      expect(act1).toHaveBeenCalledTimes(runs ? 1 : 0);
      expect(compact.disabled).toBe(!runs);
      await act(() =>
        buttons
          .find((button) => button.getAttribute("aria-label") === "Keep full history")!
          .click(),
      );
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );
});
