// @effect-diagnostics globalDate:off -- fixture timestamps are offsets from a fixed instant, not wall-clock reads.
import type { CompareCommit } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import { compareForRelease, type ReleaseGate } from "./release.ts";
import type { Moved } from "./releaseCompare.ts";
import { movedCount } from "./releaseCompare.ts";
import {
  holdReleaseFacts,
  releaseFacts,
  releaseStageMarks,
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
  readonly outcome: ReleaseOutcome;
}

/** The review as each step shows it, its facts held the way the dialog holds them. */
function walk(tag: string, steps: ReadonlyArray<Step>) {
  let held: ReleaseFacts | undefined;
  return steps.map((step) => {
    const now = current(tag, step.moment);
    held = holdReleaseFacts({ held, current: now, press: step.press, outcome: step.outcome });
    const facts = held ?? now;
    const gate: ReleaseGate = { allowed: true };
    const model = releaseReview({
      tag: facts.tag,
      gate,
      permission: gate,
      changes: movedCount(facts.contents).count,
      onStage: undefined,
      services: facts.services,
      replaces: facts.replaces,
      outcome: step.outcome,
      now: NOW,
    });
    return { name: step.name, facts, model };
  });
}

/** A release from `before` to its own tag running, through the press and the deploy. */
function release(tag: string, before: Moment, after: Moment): ReadonlyArray<Step> {
  return [
    { name: "ready", moment: before, press: { kind: "idle" }, outcome: { kind: "offered" } },
    {
      name: "tagging",
      moment: before,
      press: { kind: "running" },
      outcome: { kind: "releasing", progress: `Tagging main as ${tag}` },
    },
    {
      name: "releasing",
      moment: before,
      press: { kind: "done" },
      outcome: { kind: "releasing", progress: `Production redeploys from ${tag} · 0:40` },
    },
    {
      name: "released",
      moment: after,
      press: { kind: "done" },
      outcome: { kind: "released", at: new Date(NOW).toISOString() },
    },
  ];
}

describe("a finished release keeps the facts it was made with", () => {
  const first = walk(
    "v0.1.0",
    release(
      "v0.1.0",
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
    "v0.1.1",
    release(
      "v0.1.1",
      { live: "v0.1.0", contents: ONE_CHANGE, production: "4c3b2a1" },
      { live: "v0.1.1", contents: [], production: HEAD },
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
    "v0.1.0",
    release(
      "v0.1.0",
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
