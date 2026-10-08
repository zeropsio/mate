import { markupDom } from "../../../test/markupDom";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { BrowserStrip } from "./BrowserStrip";
import type { BrowserStripModel } from "./conversation.logic";

const at = (second: number) => new Date(Date.UTC(2026, 8, 27, 10, 0, second)).toISOString();

/** A desktop check of the front page, still running: no result, no screenshot. */
const running = (key: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
  key,
  kind: "browser",
  phase: "running",
  anchorAt: at(0),
  anchorActivityId: key,
  turnId: "turn-1",
  subject: "https://appdev.example.dev/",
  kicker: "Browser · appdev",
  voice: "Checking /",
  voiceSource: "mate",
  statusWord: "Checking",
  steps: [],
  links: [],
  callIds: [key],
  hasResult: false,
  viewport: { width: 1440, height: 900 },
  ...overrides,
});

/** The same check settled three seconds in, with its screenshot. */
const check = (key: string): ZeropsOperation => ({
  ...running(key),
  phase: "done",
  settledAt: at(3),
  statusWord: "Checked",
  hasResult: true,
  screenshot: { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 },
});

/** A settled check, then one still running. */
const LIVE: BrowserStripModel = {
  key: "strip:1",
  checks: [check("op:home"), running("op:admin", { subject: "https://appdev.example.dev/admin" })],
  views: 2,
  failures: 0,
  live: true,
};

const SETTLED: BrowserStripModel = { ...LIVE, checks: [check("op:home")], views: 1, live: false };

const render = (strip: BrowserStripModel, bare: boolean) =>
  renderToStaticMarkup(
    <BrowserStrip
      bare={bare}
      environmentId={null}
      onOpenImage={() => undefined}
      strip={strip}
      threadRef={null}
    />,
  );

/** The class list of every opening tag that carries `marker`, in document order. */

/**
 * Fills that all but vanish on one card or the other: `muted` sits 1.018
 * from the Zerops dark card, `secondary` close behind.
 */

describe("BrowserStrip", () => {
  // Live is busy, never failure: the stage's Live mark pulses the blue the
  // running take in the list pulses.
  it("marks what is live in the busy tone", () => {
    expect(markupDom(render(LIVE, true)).body.textContent).toContain("Live");
    expect(markupDom(render(SETTLED, false)).body.textContent).not.toContain("Live");
  });
});

// A check that took no picture keeps its frame and draws what it read there:
// the page itself, else what it asked of the page with the answers, else what
// its errors, console and requests came to — never an empty box and never
// the word "structure" (the owner, 2026-09-27: "show the structure output or
// mock in the space where the window would have been").
describe("a check that took no picture", () => {
  const read = (key: string, browserRead?: ZeropsOperation["browserRead"]): ZeropsOperation => {
    const { screenshot: _screenshot, ...settled } = check(key);
    return { ...settled, ...(browserRead !== undefined ? { browserRead } : {}) };
  };
  const strip = (checks: ReadonlyArray<ZeropsOperation>): BrowserStripModel => ({
    key: "strip:read",
    checks,
    views: 1,
    failures: 0,
    live: false,
  });
  const page = {
    page: {
      kind: "tree" as const,
      text: '- heading "Service status" [level=1]\n- paragraph\n  - StaticText "All good."',
    },
    answers: [],
  };

  it("stages the page it read, in its device's frame, with its words", () => {
    const markup = render(strip([read("op:status", page)]), false);
    expect(markup).toContain('data-browser-strip-stage="read"');
    expect(markup).toContain('data-page-mock="stage"');
    expect(markup).toContain("Service status");
    expect(markup).toContain("All good.");
    expect(markup).not.toMatch(/·\s*structure\b/);
    // Its take shows the page small, and can take the stage.
    expect(markup).toContain('data-page-mock="thumbnail"');
  });

  // Juno's checks of a shop page only counted things on it.
  it("stages what it asked of the page with the answers", () => {
    const markup = render(
      strip([read("op:cz", { answers: [{ asked: "main h3", answer: "6 found" }] })]),
      false,
    );
    expect(markup).toContain("data-check-answers");
    expect(markup).toMatch(/main h3<\/code><span[^>]*>6 found</);
  });

  it("stages what its errors, console and requests came to when it read nothing else", () => {
    const markup = render(
      strip([
        {
          ...read("op:errors"),
          browserSummary: { stepCount: 1, errorCount: 0, failedRequestCount: 0, line: "" },
        },
      ]),
      false,
    );
    expect(markup).toContain('data-browser-strip-stage="read"');
    expect(markup).toContain("data-check-findings");
    expect(markup).toContain("No errors");
  });

  // Settled, the stage holds the newest take with a page to show — a
  // picture or what it read; the others are one click away in the list.
  it.each([
    { name: "a read page after a picture", order: ["picture", "read"], stage: "read" },
    { name: "a picture after a read page", order: ["read", "picture"], stage: "still" },
  ])("stages the newest take: $name", ({ order, stage }) => {
    const takes = order.map((kind) =>
      kind === "picture" ? check("op:home") : read("op:status", page),
    );
    const markup = render(strip(takes), false);
    expect(markup).toContain(`data-browser-strip-stage="${stage}"`);
  });
});
