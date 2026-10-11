import type { GroupFlowProduction, GroupFlowStop } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import type { ProductionChip } from "../SidebarProductionChip.logic";
import type { MateRowView } from "../SidebarMateRow.logic";
import { pull } from "./flowTestFixtures";
import {
  broughtBy,
  cardMateReading,
  cardSecondWords,
  cardPeople,
  cardReady,
  foldMates,
  foldWords,
  mateChangeForReview,
  placeLines,
  readyLine,
  readyTitle,
  rollBackTarget,
  siteOf,
  sinceWords,
} from "./projectCard.logic";

const NOW = Date.parse("2026-10-10T12:00:00Z");

function stop(over: Partial<GroupFlowStop> = {}): GroupFlowStop {
  return {
    projectId: "prod",
    name: "production",
    state: "deployed",
    version: {
      name: "v2.3.1",
      commit: undefined,
      sha: undefined,
      taggedBy: undefined,
      label: "v2.3.1",
    },
    source: "release",
    route: "https://shop.acme.com/",
    ...over,
  };
}

const LIVE: GroupFlowProduction = { kind: "live", stop: stop(), line: "v2.3.1" };

function chip(over: Partial<ProductionChip>): ProductionChip {
  return { label: "prod", state: "ok", version: "v2.3.1", ...over };
}

const words = (flow: Parameters<typeof placeLines>[0]) =>
  placeLines(flow).map((line) => ({
    dot: line.dot,
    words: line.words.join(" · "),
    named: line.named,
  }));

describe("production's line at a card's foot", () => {
  const since = sinceWords("2026-10-09T08:00:00Z", NOW);
  it.each([
    {
      case: "running, since when",
      flow: { production: LIVE, stages: [] },
      chip: undefined,
      line: { dot: "running", words: `Running · v2.3.1 · ${since}`, named: false },
    },
    {
      case: "a failed release, and what still runs",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "failed", version: "v1.8.2" }),
      line: { dot: "failed", words: "Release failed · still runs v1.8.2", named: false },
    },
    {
      case: "a release on its way",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "releasing", next: "v0.5.0" }),
      line: { dot: "releasing", words: "Releasing v0.5.0", named: false },
    },
    {
      case: "down, and its cause",
      flow: { production: LIVE, stages: [] },
      chip: chip({ state: "down" }),
      line: { dot: "down", words: "Down · app failed", named: false },
    },
    {
      case: "nothing released yet",
      flow: { production: { kind: "empty", stop: stop(), line: "" } as const, stages: [] },
      chip: undefined,
      line: { dot: "none", words: "Not released yet", named: false },
    },
    {
      case: "no production at all",
      flow: { production: { kind: "absent" } as const, stages: [stop({ name: "stage" })] },
      chip: undefined,
      line: { dot: "none", words: "Not released yet", named: false },
    },
    {
      case: "no production, and a stage in trouble: the stage's line, by name",
      flow: {
        production: { kind: "absent" } as const,
        stages: [stop({ name: "stage", projectId: "stage", state: "failed" })],
      },
      chip: undefined,
      line: { dot: "failed", words: "Deploy failed", named: true },
    },
  ] as const)("says $case", ({ flow, chip: read, line }) => {
    expect(
      words({
        flow,
        chip: read,
        since: "2026-10-09T08:00:00Z",
        down: new Map([["prod", ["app"]]]),
        nowMs: NOW,
      }),
    ).toEqual([line]);
  });

  it("says what the flow says where no chip was read: a failed deploy, and what still runs", () => {
    const failed: GroupFlowProduction = {
      kind: "deploy-failed",
      stop: stop({ version: { ...stop().version!, label: "v1.8.2" } }),
      line: "",
      candidate: undefined,
    };
    expect(words({ flow: { production: failed, stages: [] }, nowMs: NOW })).toEqual([
      { dot: "failed", words: "Release failed · still runs v1.8.2", named: false },
    ]);
  });
});

describe("since when production runs what it runs", () => {
  it.each([
    { at: "2026-10-10T09:05:00Z", expected: "since " },
    { at: "2026-10-07T09:05:00Z", expected: "since " },
    { at: "2026-09-18T09:05:00Z", expected: "since " },
  ])("is said as a time today, a weekday this week, a date before: $at", ({ at, expected }) => {
    expect(sinceWords(at, NOW)?.startsWith(expected)).toBe(true);
  });

  it("says nothing of an unknown time", () => {
    expect(sinceWords(undefined, NOW)).toBeUndefined();
    expect(sinceWords("not a date", NOW)).toBeUndefined();
  });
});

describe("a release ready to go", () => {
  const stage = stop({ projectId: "stage", name: "stage", source: "main" });

  // D28: releasing the fix is how a broken production is mended, so the release stays offered.
  it("is offered beside a production whose last release failed, and says so plainly", () => {
    const ready = cardReady({
      production: {
        kind: "deploy-failed",
        stop: stop({ version: { ...stop().version!, label: "v1.8.2" } }),
        line: "",
        candidate: { tag: "v1.9.1", waiting: 2 },
      },
      stages: [stage],
      main: { head: undefined, hasCode: true, notLive: 2, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : [readyTitle(ready), readyLine(ready)]).toEqual([
      "2 changes ready to release",
      "On stage, tested. Production's last release failed; it still runs v1.8.2.",
    ]);
  });
  it("says how many changes, where they were tested and what production runs", () => {
    const ready = cardReady({
      production: {
        kind: "ready-to-release",
        stop: stop(),
        line: "",
        candidate: { tag: "v2.4.0", waiting: 3 },
      },
      stages: [stage],
      main: { head: undefined, hasCode: true, notLive: 3, notLiveAtLeast: false },
    });
    expect(ready === undefined ? undefined : [readyTitle(ready), readyLine(ready)]).toEqual([
      "3 changes ready to release",
      "On stage, tested. Production runs v2.3.1.",
    ]);
  });

  it.each([
    {
      case: "a release is on its way",
      production: { kind: "releasing", stop: stop(), line: "", tag: "v2.4.0" },
    },
    { case: "nothing waits", production: LIVE },
  ] as const)("is absent while $case", ({ production }) => {
    expect(
      cardReady({
        production,
        stages: [stage],
        main: { head: undefined, hasCode: true, notLive: 1, notLiveAtLeast: false },
      }),
    ).toBeUndefined();
  });
});

function view(over: Partial<MateRowView>): Pick<MateRowView, "state" | "ask" | "reply"> {
  return { state: "idle", ask: "Add a cart", reply: undefined, ...over };
}

describe("a Mate on a card", () => {
  it.each([
    {
      case: "lifts the viewer's plan with Approve plan",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Plan: move search", tone: "ink" },
        }),
        status: "planReady",
        mine: true,
        review: undefined,
      },
      expected: { text: "Plan: move search", tone: "ink", lift: { kind: "plan" } },
    },
    {
      case: "lifts the viewer's question with Answer…",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Stripe or Adyen?", tone: "ink" },
        }),
        status: "input",
        mine: true,
        review: undefined,
      },
      expected: { text: "Stripe or Adyen?", tone: "ink", lift: { kind: "question" } },
    },
    {
      case: "leaves another's question at rest",
      input: {
        view: view({
          state: "needs",
          reply: { kind: "words", text: "Stripe or Adyen?", tone: "muted" },
        }),
        status: "input",
        mine: false,
        review: undefined,
      },
      expected: { text: "Stripe or Adyen?", tone: "muted", lift: undefined },
    },
    {
      case: "lifts the viewer's failed Mate with its fix",
      input: {
        view: view({
          state: "failed",
          reply: { kind: "words", text: "EXPO_TOKEN is missing", tone: "failed" },
        }),
        status: "failed",
        mine: true,
        review: undefined,
      },
      expected: { text: "EXPO_TOKEN is missing", tone: "failed", lift: { kind: "fix" } },
    },
    {
      case: "lifts the viewer's change waiting for review",
      input: {
        view: view({ state: "needs", reply: { kind: "words", text: "#41 is ready", tone: "ink" } }),
        status: "idle",
        mine: true,
        review: pull({ number: 41 }),
      },
      expected: {
        text: "Greet with a fuller line",
        tone: "ink",
        lift: { kind: "review", pull: pull({ number: 41 }) },
      },
    },
    {
      // Its last words are of another moment, a limit it hit: the menu's row names the change.
      case: "names the change it lifts for review, not what the Mate said last",
      input: {
        view: view({
          reply: { kind: "words", text: "Usage limit reached until Friday", tone: "muted" },
        }),
        status: "idle",
        mine: true,
        review: pull({ number: 7, title: "Build a reading list" }),
      },
      expected: {
        text: "Build a reading list",
        tone: "ink",
        lift: { kind: "review", pull: pull({ number: 7, title: "Build a reading list" }) },
      },
    },
    {
      case: "says what was asked where the Mate has not answered",
      input: { view: view({ reply: undefined }), status: "idle", mine: true, review: undefined },
      expected: { text: "Add a cart", tone: "muted", lift: undefined },
    },
  ] as const)("$case", ({ input, expected }) => {
    expect(cardMateReading(input)).toEqual(expected);
  });

  it.each([
    { case: "its conversations read", read: true, text: "Nothing asked yet" },
    { case: "its conversations not read yet", read: false, text: undefined },
  ])("says nothing was asked of a Mate only once it knows: $case", ({ read, text }) => {
    const never = view({ ask: undefined, reply: undefined });
    expect(
      cardMateReading({ view: never, status: "idle", mine: true, review: undefined, read }).text,
    ).toBe(text);
  });

  it.each([
    {
      case: "a colleague's Mate waiting on its person: whom it waits on",
      second: { kind: "waits-on", text: "Waits on Karel" },
      expected: { text: "Waits on Karel", tone: "muted" },
    },
    {
      case: "the viewer's change waiting: its title, in ink",
      second: { kind: "change", title: "Spring banner", mine: true },
      expected: { text: "Spring banner", tone: "ink" },
    },
    {
      case: "a colleague's open change: its title, in review",
      second: { kind: "change", title: "Spring banner", mine: false },
      expected: { text: "Spring banner · in review", tone: "muted" },
    },
    {
      case: "at its limit: when it picks up",
      second: { kind: "paused", until: "2026-10-10T13:00:00Z" },
      expected: { text: "Paused until 1:00 PM", tone: "muted" },
    },
    {
      case: "its words in the tone the menu chose",
      second: { kind: "reply", tone: "failed" },
      expected: { text: "EXPO_TOKEN is missing", tone: "failed" },
    },
    {
      case: "what was asked",
      second: { kind: "ask", pending: false },
      expected: { text: "Add a cart", tone: "muted" },
    },
    { case: "nothing", second: { kind: "none" }, expected: { text: undefined, tone: "muted" } },
  ] as const)("says the menu row's line 2: $case", ({ second, expected }) => {
    expect(
      cardSecondWords({
        second,
        reply: { kind: "words", text: "EXPO_TOKEN is missing", tone: "muted" },
        askLine: { kind: "ask", text: "Add a cart" },
        pausedUntil: () => "1:00 PM",
      }),
    ).toEqual(expected);
  });

  it("says the menu row's line where nothing lifts it, and its own fuller words where it is lifted", () => {
    const line = { text: "Waits on Karel", tone: "muted" as const };
    const asking = view({
      state: "needs",
      reply: { kind: "words", text: "Stripe or Adyen?", tone: "ink" },
    });
    expect(
      cardMateReading({ view: asking, status: "input", mine: false, review: undefined, line }).text,
    ).toBe("Waits on Karel");
    expect(
      cardMateReading({ view: asking, status: "input", mine: true, review: undefined, line }).text,
    ).toBe("Stripe or Adyen?");
  });

  it("says what a working Mate is on", () => {
    const working = view({
      state: "working",
      reply: { kind: "live", words: "Running the cart tests" },
    });
    expect(
      cardMateReading({ view: working, status: "working", mine: true, review: undefined }),
    ).toEqual({
      text: "Running the cart tests",
      tone: "muted",
      lift: undefined,
    });
  });

  // D7, one rule with the menu (`changeShowsReview`): while Wren works, its changes show no Review.
  it.each([
    { case: "at work", review: false, expected: undefined },
    { case: "at rest", review: true, expected: 1 },
  ])(
    "shows its changes' Review by the rule the menu reads, its Mate $case",
    ({ review, expected }) => {
      const flow = { pullRequests: [{ pull: pull(), blocked: null, state: undefined, review }] };
      expect(mateChangeForReview(flow, "wren-dev")?.number).toBe(expected);
    },
  );
});

describe("a card's Mates", () => {
  it("fold the quiet ones past four, keeping the loud ones and the person's order", () => {
    const mates = ["a", "B", "c", "d", "E", "f"];
    const { shown, folded } = foldMates(mates, (mate) => mate === mate.toUpperCase());
    expect(shown).toEqual(["a", "B", "c", "E"]);
    expect(folded).toEqual(["d", "f"]);
    expect(foldWords(folded.length)).toBe("2 more Mates");
  });

  it("all stand when there are four or fewer", () => {
    expect(foldMates(["a", "b", "c", "d"], () => false).folded).toEqual([]);
  });
});

describe("a card's header", () => {
  it("names production's address as a person reads it", () => {
    expect(siteOf("https://shop.acme.com/")).toBe("shop.acme.com");
    expect(siteOf(undefined)).toBeUndefined();
  });

  it("draws the people on it only when more than one, each once", () => {
    const ada = { userId: "ada" };
    const kai = { userId: "kai" };
    expect(cardPeople([ada, null, ada])).toEqual([]);
    expect(cardPeople([ada, kai, ada, undefined])).toEqual([ada, kai]);
  });
});

describe("production's panel", () => {
  const release = (tag: string, taggedAt: string, standing?: "live", rollBack = true) => ({
    tag,
    taggedAt,
    standing,
    rollBack,
  });
  const releases = [
    release("v2.4.0", "2026-10-09T10:00:00Z", undefined),
    release("v2.3.1", "2026-10-07T10:00:00Z", "live"),
    release("v2.3.0", "2026-10-01T10:00:00Z", undefined, false),
    release("v2.2.0", "2026-09-20T10:00:00Z"),
  ];

  it("says what the version production runs brought: what was merged since the release before", () => {
    const merged = [
      pull({ number: 1, mergedAt: "2026-09-30T10:00:00Z" }),
      pull({ number: 2, mergedAt: "2026-10-03T10:00:00Z" }),
      pull({ number: 3, mergedAt: "2026-10-08T10:00:00Z" }),
    ];
    expect(broughtBy(merged, releases).map((entry) => entry.number)).toEqual([2]);
    expect(broughtBy(merged, [])).toEqual([]);
  });

  it("offers going back to the newest release before it that may be rolled back to", () => {
    expect(rollBackTarget(releases)).toBe("v2.2.0");
    expect(rollBackTarget([release("v1.0.0", "2026-09-01T00:00:00Z", "live")])).toBeUndefined();
  });
});
