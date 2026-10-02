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

function current(tag: string, moment: Moment): ReleaseFacts {
  return releaseFacts({
    tag,
    live: moment.live,
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
      suggestion: step.suggestion,
      releases: step.releases,
    });
    const shown = releaseStep({
      follows,
      held,
      press: step.press,
      clockMs: NOW,
      read: (tag) => current(tag, step.moment),
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
      now: NOW,
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
      why: "Production runs it · just now",
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
    deploying: undefined,
    failed: new Set(),
    ...over,
  });

  it.each<[string, StageStandings | undefined, string]>([
    ["no stage", undefined, "none"],
    ["the stage deploys it", stage({ deploying: HEAD }), "deploying-on-stage"],
    ["the stage runs it", stage({ runs: new Map([["app", HEAD]]) }), "on-stage"],
    [
      "its stage deploy failed",
      stage({ runs: new Map([["app", HEAD]]), failed: new Set(["app"]) }),
      "failed-on-stage",
    ],
  ])("released, %s: %s", (_name, standing, mark) => {
    if (released === undefined) throw new Error("no released step");
    expect(released.model.verdict.state).toBe("released");
    expect(releaseStageMarks(released.facts, standing).get(HEAD)).toBe(mark);
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
