// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { compareForRelease, type FlowReleaseRow, type ReleaseGate } from "./release.ts";
import type { Moved } from "./releaseCompare.ts";
import { movedCount } from "./releaseCompare.ts";
import {
  holdReleaseFacts,
  releaseFacts,
  releaseFollows,
  releaseOutcomeOf,
  releaseStageMarks,
  releaseStep,
  type ReleaseFacts,
} from "./releaseFacts.ts";
import {
  releaseReview,
  rollbackReview,
  type ReleaseOutcome,
  type ReviewPress,
} from "./reviewVerdict.ts";
import type { StageStandings } from "./stageMarks.ts";

const NOW = Date.parse("2026-09-29T10:00:00Z");
const HEAD = ["5e1d", "0a7c", "93b2", "e46f", "1d08", "c7a5", "2b9e", "f031", "6d4a", "8e72"].join(
  "",
);

const commit: CompareCommit = {
  sha: HEAD,
  subject: "Shelf labels for the tins",
  authorName: "Ada",
  at: "2026-09-29T09:00:00.000Z",
  change: { number: 1, title: "Shelf labels for the tins", mateProjectId: "p-wren" },
};
const ONE_CHANGE: ReadonlyArray<Moved> = [
  { repository: "app", services: ["app"], commits: [commit], total: 1, truncated: false },
];

/** What the project reads at one moment: the release that runs, what waits, what each service runs. */
interface Moment {
  readonly live: string | undefined;
  readonly contents: ReadonlyArray<Moved>;
  readonly production: string | undefined;
}

function current(
  tag: string,
  moment: Moment,
  releases: ReadonlyArray<FlowReleaseRow> = [],
): ReleaseFacts {
  return releaseFacts({
    tag,
    live: moment.live,
    releases,
    contents: moment.contents,
    comparison: compareForRelease({
      candidate: new Map([["app", HEAD]]),
      production:
        moment.production === undefined ? new Map() : new Map([["app", moment.production]]),
    }),
    productionServices: ["app"],
  });
}

interface Step {
  readonly name: string;
  readonly moment: Moment;
  readonly press: ReviewPress;
  /** The tag this window's press made. */
  readonly made: string | undefined;
  readonly inFlight: string | undefined;
  readonly suggestion: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /** The release HQ ended its deploy of with some of it not live (`releaseStalled`). */
  readonly stalled?: string;
  /** The minute clock the review's words are read by; `NOW` unless the step is later. */
  readonly nowMs?: number;
}

function row(
  tag: string,
  standing: FlowReleaseRow["standing"],
  over: Partial<FlowReleaseRow> = {},
): FlowReleaseRow {
  return {
    tag,
    verdict: "approved",
    detail: undefined,
    line: "app 5e1d0a7",
    entries: [{ service: "app", commit: HEAD }],
    taggedAt: new Date(NOW - 40_000).toISOString(),
    standing,
    word: "Approved",
    rollBack: false,
    failedEntry: undefined,
    ...over,
  };
}

/** The review as each step shows it, its tag followed and its facts held the way the dialog does. */
function walk(steps: ReadonlyArray<Step>) {
  let held: ReleaseFacts | undefined;
  return steps.map((step) => {
    const follows = releaseFollows({
      made: step.made,
      held,
      press: step.press,
      inFlight: step.inFlight,
      stalled: step.stalled,
      suggestion: step.suggestion,
      releases: step.releases,
    });
    const shown = releaseStep({
      follows,
      held,
      press: step.press,
      clockMs: step.nowMs ?? NOW,
      read: (tag) => current(tag, step.moment, step.releases),
    });
    held = shown.held;
    const { facts } = shown;
    const gate: ReleaseGate = { allowed: true };
    const model = releaseReview({
      tag: facts.tag,
      gate,
      permission: gate,
      changes: movedCount(facts.contents).count,
      onStage: undefined,
      services: facts.services,
      replaces: facts.replaces,
      outcome: shown.outcome,
      productionMoved: shown.productionMoved,
      now: step.nowMs ?? NOW,
    });
    return { name: step.name, facts, model, follows };
  });
}

/** A release from `before` to its own tag running, pressed in this window, through its deploy. */
function release(
  tag: string,
  next: string,
  before: Moment,
  after: Moment,
  earlier: ReadonlyArray<FlowReleaseRow> = [],
): ReadonlyArray<Step> {
  const idle = { made: undefined, inFlight: undefined, suggestion: tag, releases: earlier };
  const made = { made: tag, suggestion: next };
  return [
    { name: "ready", moment: before, press: { kind: "idle" }, ...idle },
    { name: "tagging", moment: before, press: { kind: "running" }, ...idle, made: tag },
    {
      name: "releasing",
      moment: before,
      press: { kind: "done" },
      ...made,
      inFlight: tag,
      releases: [row(tag, undefined), ...earlier],
    },
    {
      name: "released",
      moment: after,
      press: { kind: "done" },
      ...made,
      inFlight: undefined,
      releases: [row(tag, "live"), ...earlier.map((entry) => ({ ...entry, standing: undefined }))],
    },
  ];
}

describe("a finished release keeps the facts it was made with", () => {
  const first = walk(
    release(
      "v0.1.0",
      "v0.1.1",
      { live: undefined, contents: ONE_CHANGE, production: undefined },
      // After: production runs the new tag, and nothing waits for it.
      { live: "v0.1.0", contents: [], production: HEAD },
    ),
  );

  it.each(first.map((step) => [step.name, step] as const))(
    "a first release, %s: the first release, one change, app redeploys",
    (_name, step) => {
      expect(step.model.meta.join(" · ")).toBe("the first release · 1 change");
      expect(step.facts.contents).toEqual(ONE_CHANGE);
      expect(step.facts.where).toEqual([{ service: "app", line: "redeploys from 5e1d0a7" }]);
      // There is nothing it replaced: no roll back is offered, least of all to itself.
      expect(step.model.ifWrong).toBeUndefined();
      expect(step.model.consequence).not.toMatch(/roll back/u);
    },
  );

  it("a first release, released: production runs it, and the live state sits beside the facts", () => {
    const released = first.at(-1);
    expect(released?.model.verdict).toMatchObject({
      state: "released",
      title: "Released v0.1.0",
      why: "Production runs it · tagged just now",
    });
    expect(released?.model.consequence).toBe("Production runs v0.1.0.");
  });

  const second = walk(
    release(
      "v0.1.1",
      "v0.1.2",
      { live: "v0.1.0", contents: ONE_CHANGE, production: "4c3b2a1" },
      { live: "v0.1.1", contents: [], production: HEAD },
      [row("v0.1.0", "live")],
    ),
  );

  it.each(second.map((step) => [step.name, step] as const))(
    "a second release, %s: replaces v0.1.0, and rolls back to it",
    (_name, step) => {
      expect(step.model.meta.join(" · ")).toBe("replaces v0.1.0 · 1 change");
      expect(step.facts.where).toEqual([{ service: "app", line: "redeploys from 5e1d0a7" }]);
      expect(step.model.ifWrong).toBe(
        "Roll back to v0.1.0 from production's menu. It gets its own review.",
      );
    },
  );

  it("a second release, released: the foot names the release to roll back to", () => {
    expect(second.at(-1)?.model.consequence).toBe(
      "Production runs v0.1.1. If it misbehaves, roll back to v0.1.0 from production's menu.",
    );
  });
});

describe("what a release replaces: the first only when nothing was released before", () => {
  const moment = (live: string | undefined): Moment => ({
    live,
    contents: ONE_CHANGE,
    production: "4c3b2a1",
  });
  it.each<[string, string | undefined, ReadonlyArray<FlowReleaseRow>, ReleaseFacts["replaces"]]>([
    ["nothing released", undefined, [], { kind: "first" }],
    [
      "only a refused release",
      undefined,
      [row("v0.1.0", undefined, { verdict: "refused" })],
      { kind: "first" },
    ],
    ["only itself, on its way", undefined, [row("v0.1.2", undefined)], { kind: "first" }],
    ["one runs in full", "v0.1.1", [row("v0.1.1", "live")], { kind: "release", tag: "v0.1.1" }],
    [
      // v0.1.1 moved app and failed in api: production runs v0.1.1's app and v0.1.0's api.
      "none runs in full",
      undefined,
      [row("v0.1.1", "deploy-failed"), row("v0.1.0", undefined)],
      { kind: "unnamed" },
    ],
    [
      "read after it landed",
      "v0.1.2",
      [row("v0.1.2", "live"), row("v0.1.1", undefined)],
      { kind: "unnamed" },
    ],
  ])("%s", (_name, live, releases, replaces) => {
    expect(current("v0.1.2", moment(live), releases).replaces).toEqual(replaces);
  });

  it("a release after a mixed production: says what is true, and keeps the roll back", () => {
    const earlier = [
      row("v0.1.1", "deploy-failed", { failedEntry: { service: "app", commit: HEAD } }),
      row("v0.1.0", undefined),
    ];
    const steps = walk(
      release(
        "v0.1.2",
        "v0.1.3",
        { live: undefined, contents: ONE_CHANGE, production: "4c3b2a1" },
        { live: "v0.1.2", contents: [], production: HEAD },
        earlier,
      ),
    );
    for (const step of steps) {
      expect(step.model.meta.join(" · ")).toBe("replaces what production runs · 1 change");
      expect(step.model.ifWrong).toBe("Roll back from production's menu. It gets its own review.");
    }
    expect(steps.at(-1)?.model.consequence).toBe(
      "Production runs v0.1.2. If it misbehaves, roll back from production's menu.",
    );
  });
});

describe("a held release's changes follow the stage as it stands now", () => {
  const released = walk(
    release(
      "v0.1.0",
      "v0.1.1",
      { live: undefined, contents: ONE_CHANGE, production: undefined },
      { live: "v0.1.0", contents: [], production: HEAD },
    ),
  ).at(-1);
  const OLDER = HEAD.replace(/^5e1d/u, "0b2c");
  const stage = (over: Partial<StageStandings>): StageStandings => ({
    runs: new Map([["app", OLDER]]),
    deploying: new Map(),
    failed: new Map(),
    ...over,
  });

  it.each<[string, StageStandings | undefined, string]>([
    ["no stage", undefined, "none"],
    ["the stage deploys it", stage({ deploying: new Map([["app", HEAD]]) }), "deploying-on-stage"],
    ["the stage runs it", stage({ runs: new Map([["app", HEAD]]) }), "on-stage"],
    ["its stage deploy failed", stage({ failed: new Map([["app", HEAD]]) }), "failed-on-stage"],
  ])("released, %s: %s", (_name, standing, mark) => {
    if (released === undefined) throw new Error("no released step");
    expect(released.model.verdict.state).toBe("released");
    expect(releaseStageMarks(released.facts, standing).get(HEAD)).toBe(mark);
  });
});

describe("a release HQ ended without landing says so: no clock ends it", () => {
  it.each([
    {
      name: "queued",
      inFlight: "v0.1.1",
      standing: undefined,
      state: "releasing",
      title: "Releasing v0.1.1",
    },
    {
      name: "building despite an earlier stopped observation",
      inFlight: "v0.1.1",
      standing: undefined,
      state: "releasing",
      title: "Releasing v0.1.1",
    },
    {
      name: "follow lost with no outcome",
      inFlight: undefined,
      standing: undefined,
      state: "release-stalled",
      title: "Deploy status unknown for v0.1.1",
    },
    {
      name: "deploy ended and failed",
      inFlight: undefined,
      standing: "deploy-failed",
      state: "release-failed",
      title: "v0.1.1 didn't go out",
    },
    {
      name: "production runs it",
      inFlight: undefined,
      standing: "live",
      state: "released",
      title: "Released v0.1.1",
    },
  ] as const)("a just-tagged release: $name", ({ inFlight, standing, state, title }) => {
    const follows = releaseFollows({
      made: "v0.1.1",
      held: undefined,
      press: { kind: "done" },
      inFlight,
      stalled: "v0.1.1",
      suggestion: "v0.1.2",
      releases: [row("v0.1.1", standing)],
    });
    const outcome = releaseOutcomeOf({
      ...follows,
      pressing: false,
      clockMs: NOW,
    });
    const model = releaseReview({
      tag: follows.tag,
      gate: { allowed: true },
      permission: { allowed: true },
      changes: 1,
      onStage: undefined,
      services: ["app"],
      replaces: { kind: "release", tag: "v0.1.0" },
      outcome,
      now: NOW,
    });
    expect(model.verdict).toMatchObject({ state, title });
    expect(model.verdict.title).not.toContain("hasn't landed");
    if (standing === undefined && inFlight === undefined) {
      expect(follows.ticking).toBe(false);
      expect(model.consequence).toBe("Check the deploy in Zerops.");
    }
  });

  const before: Moment = { live: "v0.1.0", contents: ONE_CHANGE, production: "4c3b2a1" };
  const after: Moment = { live: "v0.1.1", contents: [], production: HEAD };
  const [, tagging, onItsWay] = release("v0.1.1", "v0.1.2", before, after, [row("v0.1.0", "live")]);
  if (tagging === undefined || onItsWay === undefined) throw new Error("no steps");
  const later = (minutes: number, tagged: FlowReleaseRow, ended: boolean): Step => ({
    ...onItsWay,
    name: `${String(minutes)} minutes on`,
    nowMs: NOW + minutes * 60_000,
    // HQ's rollout of it says whether it is on its way (`releaseInFlight`, `releaseEnded`).
    inFlight: ended ? undefined : "v0.1.1",
    ...(ended ? { stalled: "v0.1.1" } : {}),
    moment: tagged.standing === "live" ? after : before,
    releases: [tagged, row("v0.1.0", tagged.standing === "live" ? undefined : "live")],
  });

  it("on its way 70 minutes while HQ follows its build: still releasing, the clock running", () => {
    const steps = walk([tagging, onItsWay, later(70, row("v0.1.1", undefined), false)]);
    expect(steps.map((step) => step.model.verdict.state)).toEqual([
      "releasing",
      "releasing",
      "releasing",
    ]);
    expect(steps.at(-1)?.follows.ticking).toBe(true);
  });

  it("HQ ends its follow without a landing: the outcome is unknown and the clock stops", () => {
    const steps = walk([
      tagging,
      onItsWay,
      later(10, row("v0.1.1", undefined), false),
      later(31, row("v0.1.1", undefined), true),
    ]);
    expect(steps.map((step) => step.model.verdict.state)).toEqual([
      "releasing",
      "releasing",
      "releasing",
      "release-stalled",
    ]);
    expect(steps.map((step) => step.follows.ticking)).toEqual([true, true, true, false]);
    const last = steps.at(-1);
    expect(last?.model.verdict).toMatchObject({
      tone: "attention",
      title: "Deploy status unknown for v0.1.1",
      why: "HQ couldn't confirm how the deploy ended",
    });
    expect(last?.model.consequence).toBe("Check the deploy in Zerops.");
    expect(last?.model.primary).toBeUndefined();
    expect(last?.model.verdict.fix).toEqual({
      verb: "check it",
      problem: {
        what: "The deploy status of release v0.1.1 is unknown",
        at: new Date(NOW - 40_000).toISOString(),
        ask: "Check how the deploy ended in Zerops, and resolve anything that needs attention.",
      },
    });
    // An unconfirmed deploy offers no roll back based on a guessed outcome.
    expect(last?.model.ifWrong).toBeUndefined();
    expect(last?.model.meta.join(" · ")).toBe("replaces v0.1.0 · 1 change");
  });

  it("a landing after HQ ended its deploy still reads Released", () => {
    const steps = walk([
      tagging,
      onItsWay,
      later(31, row("v0.1.1", undefined), true),
      later(40, row("v0.1.1", "live"), true),
    ]);
    // The age is the tag's, not the landing's.
    expect(steps.at(-1)?.model.verdict).toMatchObject({
      state: "released",
      title: "Released v0.1.1",
      why: "Production runs it · tagged 40 minutes ago",
    });
  });

  it("a failed release whose deploy moved nothing offers no roll back; one that moved some does", () => {
    const failed = row("v0.1.1", "deploy-failed", {
      failedEntry: { service: "app", commit: HEAD },
    });
    const still = walk([tagging, onItsWay, later(5, failed, true)]).at(-1);
    expect(still?.model.verdict.state).toBe("release-failed");
    expect(still?.model.ifWrong).toBeUndefined();
    // Production moved: no release runs in full now.
    const moved = walk([
      tagging,
      onItsWay,
      {
        ...later(5, failed, true),
        moment: { ...before, live: undefined },
        releases: [failed, row("v0.1.0", undefined)],
      },
    ]).at(-1);
    expect(moved?.model.ifWrong).toBe(
      "Roll back to v0.1.0 from production's menu. It gets its own review.",
    );
  });
});

describe("a followed release ends when a newer one sits above it", () => {
  const before: Moment = { live: "v0.1.0", contents: ONE_CHANGE, production: "4c3b2a1" };
  const after: Moment = { live: "v0.1.1", contents: [], production: HEAD };
  const [, tagging, onItsWay, released] = release("v0.1.1", "v0.1.2", before, after, [
    row("v0.1.0", "live"),
  ]);
  if (tagging === undefined || onItsWay === undefined || released === undefined)
    throw new Error("no steps");
  const above = (
    minutes: number,
    newer: FlowReleaseRow,
    below: ReadonlyArray<FlowReleaseRow>,
    live: string | undefined,
  ): Step => ({
    ...onItsWay,
    name: `${String(minutes)} minutes on`,
    nowMs: NOW + minutes * 60_000,
    inFlight: newer.standing === undefined ? newer.tag : undefined,
    suggestion: "v0.1.3",
    moment: { ...before, live },
    releases: [newer, ...below],
  });
  const v011 = row("v0.1.1", undefined);

  it("A: stalled, then v0.1.2 is made in another window: it ends, and never ticks again", () => {
    const steps = walk([
      tagging,
      onItsWay,
      { ...onItsWay, nowMs: NOW + 31 * 60_000, inFlight: undefined, stalled: "v0.1.1" },
      above(33, row("v0.1.2", undefined), [v011, row("v0.1.0", "live")], "v0.1.0"),
      above(40, row("v0.1.2", "live"), [v011, row("v0.1.0", undefined)], "v0.1.2"),
      above(120, row("v0.1.2", "live"), [v011, row("v0.1.0", undefined)], "v0.1.2"),
    ]);
    expect(steps.map((step) => step.model.verdict.state)).toEqual([
      "releasing",
      "releasing",
      "release-stalled",
      "release-superseded",
      "release-superseded",
      "release-superseded",
    ]);
    expect(steps.slice(2).map((step) => step.follows.ticking)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(steps[3]?.model.verdict).toMatchObject({
      title: "v0.1.2 was tagged after v0.1.1",
      why: "Production runs v0.1.0",
    });
    expect(steps.at(-1)?.model.verdict.why).toBe("Production runs v0.1.2");
    expect(steps.at(-1)?.model.consequence).toBe("The project's line in the menu follows v0.1.2.");
    expect(steps.at(-1)?.model.ifWrong).toBeUndefined();
    expect(steps.at(-1)?.model.primary).toBeUndefined();
  });

  it("B: released, then rolled back in another window as v0.1.2: it ends, never Releasing", () => {
    const steps = walk([
      tagging,
      onItsWay,
      released,
      above(10, row("v0.1.2", "live"), [v011, row("v0.1.0", undefined)], "v0.1.2"),
    ]);
    expect(steps.map((step) => step.model.verdict.state)).toEqual([
      "releasing",
      "releasing",
      "released",
      "release-superseded",
    ]);
    expect(steps.at(-1)?.follows.ticking).toBe(false);
    expect(steps.at(-1)?.model.verdict.title).toBe("v0.1.2 was tagged after v0.1.1");
  });

  it("a refused release above it is no newer release", () => {
    const steps = walk([
      tagging,
      onItsWay,
      above(
        5,
        row("v0.1.2", undefined, { verdict: "refused" }),
        [row("v0.1.1", undefined), row("v0.1.0", "live")],
        "v0.1.0",
      ),
    ]);
    expect(steps.at(-1)?.model.verdict.state).toBe("releasing");
  });
});

describe("a release opened on its way follows its own tag to the end", () => {
  const before: Moment = { live: undefined, contents: ONE_CHANGE, production: undefined };
  const after: Moment = { live: "v0.1.0", contents: [], production: HEAD };
  // Opened in another window, after a reload, or reopened: no press here, only the tag on its way.
  const onItsWay: Step = {
    name: "on its way",
    moment: before,
    press: { kind: "idle" },
    made: undefined,
    inFlight: "v0.1.0",
    suggestion: "v0.1.1",
    releases: [row("v0.1.0", undefined)],
  };
  const ended = (name: string, moment: Moment, tagged: FlowReleaseRow): Step => ({
    ...onItsWay,
    name,
    moment,
    inFlight: undefined,
    releases: [tagged],
  });

  it.each<[string, Step, Record<string, unknown>, string]>([
    [
      "landed",
      ended("landed", after, row("v0.1.0", "live")),
      { state: "released", title: "Released v0.1.0" },
      "Production runs v0.1.0.",
    ],
    [
      "its deploy failed",
      ended(
        "failed",
        before,
        row("v0.1.0", "deploy-failed", { failedEntry: { service: "app", commit: HEAD } }),
      ),
      { state: "release-failed", title: "v0.1.0 didn't go out", why: "The deploy of app failed" },
      "Production still runs what it ran before.",
    ],
    [
      "HQ refused it",
      ended(
        "refused",
        before,
        row("v0.1.0", undefined, { verdict: "refused", detail: "Production is held" }),
      ),
      { state: "release-failed", title: "v0.1.0 didn't go out", why: "Production is held" },
      "Production still runs what it ran before.",
    ],
  ])(
    "%s: it says how v0.1.0 ended, with the facts it was made with",
    (_name, end, verdict, foot) => {
      const [first, last] = walk([onItsWay, end]);
      expect(first?.model.verdict).toMatchObject({ state: "releasing", title: "Releasing v0.1.0" });
      expect(last?.model.verdict).toMatchObject(verdict);
      expect(last?.model.consequence).toBe(foot);
      expect(last?.model.meta.join(" · ")).toBe("the first release · 1 change");
      expect(last?.facts.where).toEqual([{ service: "app", line: "redeploys from 5e1d0a7" }]);
    },
  );

  it("a refused press gives the offer back", () => {
    const [ready, tagging] = release("v0.1.0", "v0.1.1", before, after);
    if (ready === undefined || tagging === undefined) throw new Error("no steps");
    const refused: Step = { ...ready, name: "refused", press: { kind: "refused", reason: "No." } };
    const last = walk([ready, tagging, refused]).at(-1);
    expect(last?.model.verdict).toMatchObject({ state: "release-ready" });
    expect(last?.model.primary?.label).toBe("Release v0.1.0");
  });
});

describe("holdReleaseFacts", () => {
  const before = current("v0.1.1", { live: "v0.1.0", contents: ONE_CHANGE, production: "4c3b2a1" });
  const after = current("v0.1.1", { live: "v0.1.1", contents: [], production: HEAD });
  const other = current("v0.1.2", { live: "v0.1.1", contents: ONE_CHANGE, production: HEAD });
  const idle: ReviewPress = { kind: "idle" };
  const done: ReviewPress = { kind: "done" };
  const releasing: ReleaseOutcome = { kind: "releasing" };
  const released: ReleaseOutcome = { kind: "released", at: undefined };

  it.each<
    [
      string,
      ReleaseFacts | undefined,
      ReleaseFacts,
      ReviewPress,
      ReleaseOutcome,
      ReleaseFacts | undefined,
    ]
  >([
    [
      "offered: nothing is held, the offer is live",
      undefined,
      before,
      idle,
      { kind: "offered" },
      undefined,
    ],
    [
      "refused: the offer is live again",
      before,
      before,
      { kind: "refused", reason: "No." },
      { kind: "offered" },
      undefined,
    ],
    [
      "pressed: the offer as it was pressed",
      undefined,
      before,
      { kind: "running" },
      { kind: "offered" },
      before,
    ],
    ["opened on its way: what it showed first", undefined, before, idle, releasing, before],
    ["landed: what was held stays", before, after, done, released, before],
    ["failed: what was held stays", before, after, done, { kind: "failed" }, before],
    ["landed, nothing held: nothing to hold", undefined, after, done, released, undefined],
    ["another tag: its own facts", before, other, done, releasing, other],
  ])("%s", (_name, held, now, press, outcome, expected) => {
    expect(holdReleaseFacts({ held, current: now, press, outcome })).toBe(expected);
  });
});

describe("rollbackReview: a roll back that landed names what it replaced", () => {
  it.each<[string, ReleaseOutcome, ReviewPress, string]>([
    ["offered", { kind: "offered" }, { kind: "idle" }, "production runs v0.1.1"],
    ["on its way", { kind: "releasing" }, { kind: "done" }, "production runs v0.1.1"],
    ["rolled back", { kind: "released", at: undefined }, { kind: "done" }, "replaces v0.1.1"],
  ])("%s", (_name, outcome, press, meta) => {
    const model = rollbackReview({
      comparisons: { leaving: "known", comingBack: "known" },
      tag: "v0.1.0",
      nextTag: "v0.1.2",
      live: "v0.1.1",
      services: ["app"],
      permission: { allowed: true },
      press,
      outcome,
      now: NOW,
    });
    expect(model.meta).toBe(meta);
  });
});
