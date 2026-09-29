import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import type { OutcomeModel } from "./conversation.logic";
import { TurnReport } from "./TurnReport";

const at = (second: number) => new Date(Date.UTC(2026, 8, 29, 10, 0, second)).toISOString();

/** A browser check that passed and took its picture, unless told otherwise. */
const take = (key: string, overrides: Partial<ZeropsOperation> = {}): ZeropsOperation => ({
  key,
  kind: "browser",
  phase: "done",
  anchorAt: at(0),
  anchorActivityId: key,
  settledAt: at(3),
  turnId: "turn-1",
  subject: "https://appdev-1f3c-3000.prg1.example.app/status",
  kicker: "Browser · appdev",
  voice: "Checking /status",
  voiceSource: "mate",
  statusWord: "Checked",
  steps: [],
  links: [],
  callIds: [key],
  hasResult: true,
  screenshot: { src: "data:image/png;base64,iVBORw0KGgo=", width: 1440, height: 900 },
  ...overrides,
});

/** A run that left one thing of every kind the result shows, and ran commands. */
const OUTCOME: OutcomeModel = {
  key: "outcome:turn-1",
  turnKey: "turn-1",
  live: [
    {
      hostname: "appdev",
      tone: "ok",
      word: "Dev server running",
      version: null,
      url: null,
      failure: null,
    },
    {
      hostname: "appstage",
      tone: "failed",
      word: "Build failing",
      version: null,
      url: null,
      failure: { reason: "3 type errors in session.ts", at: at(2), logLines: [] },
    },
  ],
  landed: [],
  files: { count: 3, additions: 45, deletions: 3, turnId: TurnId.make("turn-1") },
  checks: { count: 1, views: 1, failures: 0, takes: [take("op:status")] },
  created: [],
  notDone: [],
  activity: [{ kind: "command", count: 2, words: "Ran 2 commands", entries: [] }],
};

function render(props: Partial<Parameters<typeof TurnReport>[0]> = {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <TurnReport
        onOpenImage={() => undefined}
        onOpenTurnDiff={() => undefined}
        outcome={OUTCOME}
        {...props}
      />,
    );
  });
  return renderer;
}

const rowsOf = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "div" && node.props["data-result-row"] !== undefined,
  );

describe("TurnReport", () => {
  // Rows in the card's grid, most important first (K5): what is still
  // broken, then what waits for the person, then what runs.
  it("stands its rows broken, then waiting for you, then running", () => {
    const rows = rowsOf(render());
    expect(rows.map((row) => row.props["data-result-row"])).toEqual([
      "broken",
      "waiting",
      "running",
    ]);
    const markup = renderToStaticMarkup(
      <TurnReport
        onOpenImage={() => undefined}
        onOpenTurnDiff={() => undefined}
        outcome={OUTCOME}
      />,
    );
    expect(markup.indexOf("appstage")).toBeLessThan(markup.indexOf("3 files changed"));
    expect(markup.indexOf("3 files changed")).toBeLessThan(markup.indexOf("Dev server running"));
  });

  // What its calls came to is the work's, and the worked line's (K6): the
  // result never counts them again.
  it("counts no calls: the pills are gone", () => {
    const markup = renderToStaticMarkup(
      <TurnReport
        onOpenImage={() => undefined}
        onOpenTurnDiff={() => undefined}
        outcome={OUTCOME}
      />,
    );
    expect(markup).not.toContain("Ran 2 commands");
    expect(markup).not.toContain("data-pill");
    expect(markup).not.toContain("rounded-full");
  });

  it("draws nothing at all when the run left nothing open or running", () => {
    const quiet: OutcomeModel = { ...OUTCOME, live: [], files: null, checks: null };
    expect(
      renderToStaticMarkup(
        <TurnReport
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={quiet}
        />,
      ),
    ).toBe("");
  });

  // Red is only what is still broken (S3): its mark and its name.
  it.each([
    { title: "appstage", tone: "failed", broken: true },
    { title: "3 files changed", tone: "muted", broken: false },
    { title: "appdev", tone: "ok", broken: false },
  ])("marks $title in its tone", ({ title, tone, broken }) => {
    const row = rowsOf(render()).find(
      (candidate) => candidate.findAll((node) => node.children.includes(title)).length > 0,
    )!;
    const mark = row.find((node) => node.props["data-result-mark"] !== undefined);
    expect(mark.props["data-tone"]).toBe(tone);
    const name = row.find((node) => node.type === "span" && node.children.includes(title));
    expect(name.props["data-broken"] === true).toBe(broken);
  });

  it("reviews the run's diff from the files it changed", () => {
    const onOpenTurnDiff = vi.fn();
    const renderer = render({ onOpenTurnDiff });
    const review = renderer.root.find(
      (node) => node.type === "button" && node.children.includes("Review"),
    );
    act(() => review.props.onClick({ currentTarget: null }));
    expect(onOpenTurnDiff).toHaveBeenCalledWith(TurnId.make("turn-1"));
  });

  it("opens a check's picture from its row", () => {
    const onOpenImage = vi.fn();
    const renderer = render({ onOpenImage });
    const picture = renderer.root.find(
      (node) => node.type === "button" && node.props["data-result-picture"] !== undefined,
    );
    act(() => picture.props.onClick());
    expect(onOpenImage).toHaveBeenCalledWith({
      images: [{ src: "data:image/png;base64,iVBORw0KGgo=", name: "/status" }],
      index: 0,
    });
  });

  // T5: the result arriving is the moment worth seeing — once, row by row,
  // 40 ms apart, and only when the run finished while the person watched.
  it.each([
    { settling: true, rising: [true, true, true], order: [0, 1, 2] },
    { settling: false, rising: [false, false, false], order: [undefined, undefined, undefined] },
  ])("rises in row by row only when watched: settling $settling", ({ settling, rising, order }) => {
    const rows = rowsOf(render({ settling }));
    expect(rows.map((row) => row.props["data-rising"] === true)).toEqual(rising);
    expect(rows.map((row) => row.props.style?.["--row-index"])).toEqual(order);
  });
});
