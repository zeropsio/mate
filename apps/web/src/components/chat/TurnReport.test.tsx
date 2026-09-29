import { TurnId } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { ReviewContext } from "../../zerops/review";
import type { OutcomeModel } from "./conversation.logic";
import type { ResultFacts } from "./runResult.logic";
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

/** A run that left one thing of each kind the result shows, and ran commands. */
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
      at: at(2),
      failure: null,
    },
    {
      hostname: "appstage",
      tone: "failed",
      word: "Build failing",
      version: null,
      url: null,
      at: at(2),
      failure: { reason: "3 type errors in session.ts", at: at(2), logLines: [] },
    },
  ],
  landed: [],
  files: { count: 3, additions: 45, deletions: 3, turnId: TurnId.make("turn-1") },
  checks: { count: 1, views: 1, failures: 0, takes: [take("op:status")] },
  pictures: [],
  created: [],
  notDone: [],
  planLeft: [],
  change: { repository: "app", number: 2 },
  crewTask: null,
  activity: [{ kind: "command", count: 2 }],
  later: { services: [], changes: [], tasks: [], pages: [], files: [], answered: false },
};

/** The forge knows the run's change, still open. */
const FACTS: ResultFacts = {
  changes: {
    groupId: "group-snap",
    open: [{ repository: "app", number: 2, title: "Add a /status page" }],
    merged: [],
    known: true,
  },
};

function render(props: Partial<Parameters<typeof TurnReport>[0]> = {}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <TurnReport
        facts={FACTS}
        onOpenImage={() => undefined}
        onOpenTurnDiff={() => undefined}
        outcome={OUTCOME}
        {...props}
      />,
    );
  });
  return renderer;
}

const markupOf = (props: Partial<Parameters<typeof TurnReport>[0]> = {}) =>
  renderToStaticMarkup(
    <TurnReport
      facts={FACTS}
      onOpenImage={() => undefined}
      onOpenTurnDiff={() => undefined}
      outcome={OUTCOME}
      {...props}
    />,
  );

const rowsOf = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "div" && node.props["data-result-row"] !== undefined,
  );

describe("TurnReport", () => {
  // Rows in the card's grid, most important first (K5): what is still
  // broken, then what waits for the person, then what runs.
  it("stands its rows broken, then waiting for you, then running", () => {
    expect(rowsOf(render()).map((row) => row.props["data-result-row"])).toEqual([
      "broken",
      "waiting",
      "running",
    ]);
    const markup = markupOf();
    expect(markup.indexOf("appstage")).toBeLessThan(markup.indexOf("#2 Add a /status page"));
    expect(markup.indexOf("#2 Add a /status page")).toBeLessThan(
      markup.indexOf("Dev server running"),
    );
  });

  // What its calls came to is the work's, and the worked line's (K6): the
  // result never counts them again.
  it("counts no calls: the pills are gone", () => {
    const markup = markupOf();
    expect(markup).not.toContain("2 commands");
    expect(markup).not.toContain("data-pill");
    expect(markup).not.toContain("rounded-full");
  });

  it("draws nothing at all when the run left nothing open or running", () => {
    expect(markupOf({ outcome: { ...OUTCOME, live: [], change: null, checks: null } })).toBe("");
  });

  // Red is only what is still broken (S3): its mark and its name.
  it.each([
    { title: "appstage", mark: "alert", tone: "failed", broken: true },
    { title: "#2 Add a /status page", mark: "change", tone: "muted", broken: false },
    { title: "appdev", mark: "dot", tone: "ok", broken: false },
  ])("marks $title in its tone", ({ title, mark, tone, broken }) => {
    const row = rowsOf(render()).find(
      (candidate) => candidate.findAll((node) => node.children.includes(title)).length > 0,
    )!;
    const glyph = row.find((node) => node.props["data-result-mark"] !== undefined);
    expect([glyph.props["data-result-mark"], glyph.props["data-tone"]]).toEqual([mark, tone]);
    const name = row.find((node) => node.type === "span" && node.children.includes(title));
    expect(name.props["data-broken"] === true).toBe(broken);
  });

  // One door (R1): Review opens the review of the change, from the word.
  it("reviews the change through the one door", () => {
    const openReview = vi.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ReviewContext value={openReview}>
          <TurnReport
            facts={FACTS}
            onOpenImage={() => undefined}
            onOpenTurnDiff={() => undefined}
            outcome={OUTCOME}
          />
        </ReviewContext>,
      );
    });
    const review = renderer.root.find(
      (node) => node.type === "button" && node.children.includes("Review"),
    );
    const from = { tagName: "BUTTON" };
    act(() => review.props.onClick({ currentTarget: from }));
    expect(openReview).toHaveBeenCalledWith(
      { kind: "change", groupId: "group-snap", repository: "app", number: 2 },
      { from },
    );
  });

  it("opens the run's own diff from the files it changed", () => {
    const onOpenTurnDiff = vi.fn();
    const files = render({ onOpenTurnDiff }).root.find(
      (node) => node.type === "button" && node.children.includes("3 files"),
    );
    act(() => files.props.onClick());
    expect(onOpenTurnDiff).toHaveBeenCalledWith(TurnId.make("turn-1"));
  });

  it("opens a check's picture from its row", () => {
    const onOpenImage = vi.fn();
    const picture = render({ onOpenImage }).root.find(
      (node) => node.type === "button" && node.props["data-result-picture"] !== undefined,
    );
    act(() => picture.props.onClick());
    expect(onOpenImage).toHaveBeenCalledWith({
      images: [{ src: "data:image/png;base64,iVBORw0KGgo=", name: "/status" }],
      index: 0,
    });
  });

  // A service that stopped since comes back in red, saying since when.
  it("says since when a service is broken", () => {
    const markup = markupOf({
      outcome: { ...OUTCOME, live: [OUTCOME.live[0]!], change: null, checks: null },
      facts: {
        services: new Map([["appdev", { status: "STOPPED", since: at(50), versionAt: null }]]),
      },
    });
    expect(markup).toContain("Stopped");
    expect(markup).toMatch(/>Since [^<]+</);
  });

  // S6: the fix goes to one of the person's own Mates; outside a Zerops
  // session there is none to ask, and the row offers nothing rather than a
  // button that does nothing.
  it("offers no fix where no Mate can be asked", () => {
    const markup = markupOf({ facts: { ...FACTS, mate: { projectId: "p-nova", groupId: "g" } } });
    expect(markup).toContain("Build failing");
    expect(markup).not.toContain("to fix it");
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

  // Once means once: a row whose rise ended never replays it when it moves
  // later — appdev stopping tonight moves it up to the broken rows, and React
  // moving its node would start a rise it still declared all over again.
  it("never replays a row's rise once it ended, when the row moves", () => {
    const renderer = render({ settling: true });
    for (const row of rowsOf(renderer)) {
      const node = { row: row.props["data-result-row"] };
      act(() => row.props.onAnimationEnd({ target: node, currentTarget: node }));
    }
    expect(rowsOf(renderer).map((row) => row.props["data-rising"] === true)).toEqual([
      false,
      false,
      false,
    ]);
    act(() =>
      renderer.update(
        <TurnReport
          facts={{
            ...FACTS,
            services: new Map([
              ["appdev", { status: "STOPPED", since: at(50), versionAt: null }],
              ["appstage", { status: "ACTIVE", since: at(0), versionAt: null }],
            ]),
          }}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={OUTCOME}
          settling
        />,
      ),
    );
    const moved = rowsOf(renderer);
    expect(moved.map((row) => row.props["data-result-row"])).toEqual([
      "broken",
      "broken",
      "waiting",
    ]);
    expect(moved.some((row) => row.props["data-rising"] === true)).toBe(false);
  });

  // Only what the result arrived with rises: a row that turns up later —
  // the forge naming the change a moment after — is simply there.
  it("rises only the rows the result arrived with", () => {
    const arrived: ResultFacts = { ...FACTS, changes: { ...FACTS.changes!, open: [] } };
    const renderer = render({ settling: true, facts: arrived });
    expect(rowsOf(renderer).map((row) => row.props["data-rising"] === true)).toEqual([true, true]);
    act(() =>
      renderer.update(
        <TurnReport
          facts={FACTS}
          onOpenImage={() => undefined}
          onOpenTurnDiff={() => undefined}
          outcome={OUTCOME}
          settling
        />,
      ),
    );
    const change = rowsOf(renderer).find((row) => row.props["data-result-row"] === "waiting");
    expect(change?.props["data-rising"]).toBeUndefined();
  });
});
