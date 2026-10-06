/**
 * What a release's review says about the release itself — and why it keeps saying it once pressed.
 *
 * The tag, what it replaces, what goes out and where each service deploys from are read from the
 * project as it is offered. A release lands by changing exactly those reads: production runs the
 * new tag, nothing waits for it, every service runs what it deploys. Read again after it lands,
 * the review would describe the release against itself — "replaces v0.1.0 · 0 changes", "stays
 * on", and a roll back to the tag that just went out (measured 2026-10-02). So the facts are taken
 * when it is pressed and carried through Releasing and Released; the live state — production runs
 * it, since when — is the outcome's, beside them.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseFacts
 */

import type { FlowReleaseRow, ReleaseComparison } from "./release.ts";
import type { Moved } from "./releaseCompare.ts";
import type { ReleaseOutcome, ReleaseReplaces, ReviewPress } from "./reviewVerdict.ts";
import { stageMarks, type StageMark, type StageStandings } from "./stageMarks.ts";

/** A release's own facts, as the review shows them. */
export interface ReleaseFacts {
  /** The version it tags. */
  readonly tag: string;
  /** What production ran as it was offered: what this one replaces, and where a roll back goes. */
  readonly replaces: ReleaseReplaces;
  /** What goes out, per comparison HQ answered (`ZeropsReleaseOffer.contents`). */
  readonly contents: ReadonlyArray<Moved>;
  /** Where: per service, what it redeploys from, or what it stays on. */
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** The production services that redeploy — every one, when the comparison moves none. */
  readonly services: ReadonlyArray<string>;
}

/** The facts as the project reads them now. */
export function releaseFacts(input: {
  readonly tag: string;
  /** The release production runs in full now (`releaseRunBy`), if any does. */
  readonly live: string | undefined;
  /** Every release of the application: the first release is one with none before it. */
  readonly releases: ReadonlyArray<Pick<FlowReleaseRow, "tag" | "verdict">>;
  readonly contents: ReadonlyArray<Moved>;
  /** Per service, `main` against production (`compareForRelease`). */
  readonly comparison: ReadonlyArray<ReleaseComparison>;
  /** Production's services, for a release that moves none of them. */
  readonly productionServices: ReadonlyArray<string>;
}): ReleaseFacts {
  const moving = input.comparison.filter((row) => row.changed).map((row) => row.service);
  return {
    tag: input.tag,
    replaces:
      input.live !== undefined && input.live !== input.tag
        ? { kind: "release", tag: input.live }
        : input.releases.some((entry) => entry.verdict !== "refused" && entry.tag !== input.tag)
          ? { kind: "unnamed" }
          : { kind: "first" },
    contents: input.contents,
    where: input.comparison.map((row) => ({
      service: row.service,
      line: row.changed
        ? `redeploys from ${row.candidate ?? "main"}`
        : `stays on ${row.production ?? "what it runs"}`,
    })),
    services: moving.length === 0 ? input.productionServices : moving,
  };
}

/**
 * The facts the review holds, given what it held and what the project reads now; `undefined`
 * while it holds nothing and shows the project as read.
 *
 * Offered and unpressed, nothing is held: the offer follows the project. From the press — or from
 * the first look at a release already on its way — the facts of that tag are held, and they stay
 * through its landing or its failure. A release that landed before anything was held has nothing
 * true left to hold: what is read now is the state it made.
 */
export function holdReleaseFacts<F extends { readonly tag: string }>(input: {
  readonly held: F | undefined;
  readonly current: F;
  readonly press: ReviewPress;
  readonly outcome: ReleaseOutcome;
}): F | undefined {
  const { held, current, outcome } = input;
  const pressed = input.press.kind === "running" || input.press.kind === "done";
  if (!pressed && outcome.kind === "offered") return undefined;
  if (held !== undefined && held.tag === current.tag) return held;
  // A release that ended before anything was held has nothing true left to hold.
  return outcome.kind === "releasing" || outcome.kind === "offered" ? current : undefined;
}

/**
 * Which tag the review follows, and whether that tag is on its way.
 *
 * The tag this review made, else the one it held — the tag on its way when it was first looked at
 * — else the one on its way now, else the next version offered. Held, because the tag on its way
 * is read from production not running it yet: it ends the moment the release lands or fails, and
 * a review opened on it (another window, a reload, reopened after "You can close this") would
 * otherwise turn to the next offer and never say how its own release ended. A refused press holds
 * nothing: the offer is back.
 */
export function releaseFollows(input: {
  /** The tag this review's own press made. */
  readonly made: string | undefined;
  readonly held: { readonly tag: string } | undefined;
  readonly press: ReviewPress;
  /** The release tag on its way to production (`releaseInFlight`). */
  readonly inFlight: string | undefined;
  /** The newest release, once HQ ended its deploy with some of it not live (`releaseStalled`). */
  readonly stalled: string | undefined;
  /** The version offered next. */
  readonly suggestion: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
}): {
  readonly tag: string;
  readonly tagged: FlowReleaseRow | undefined;
  readonly releasing: boolean;
  /**
   * HQ ended its follow and it is neither live nor failed: the review says its outcome is unknown.
   */
  readonly stalled: boolean;
  /**
   * The newer release HQ did not refuse that sits above the followed one, and what production runs
   * in full: the follow is over. `undefined` while the followed release is the newest, or live.
   */
  readonly superseded: { readonly by: string; readonly live: string | undefined } | undefined;
  /** Whether the release's clock runs: on its way, and not yet live, failed, stalled or followed. */
  readonly ticking: boolean;
} {
  const pinned = input.press.kind === "refused" ? undefined : input.held?.tag;
  const tag = input.made ?? pinned ?? input.inFlight ?? input.suggestion;
  const tagged = input.releases.find((entry) => entry.tag === tag);
  const releasing =
    input.press.kind === "running" ||
    input.press.kind === "done" ||
    input.inFlight === tag ||
    pinned === tag;
  const at = input.releases.findIndex((entry) => entry.tag === tag);
  const newer =
    releasing && at > 0 && tagged?.standing !== "live"
      ? input.releases.slice(0, at).find((entry) => entry.verdict !== "refused")
      : undefined;
  const superseded =
    newer === undefined
      ? undefined
      : { by: newer.tag, live: input.releases.find((entry) => entry.standing === "live")?.tag };
  const stalled =
    releasing &&
    input.inFlight !== tag &&
    superseded === undefined &&
    stalledAt(tagged, input.stalled);
  return {
    tag,
    tagged,
    releasing,
    stalled,
    superseded,
    ticking: releasing && tagged?.standing === undefined && !stalled && superseded === undefined,
  };
}

/**
 * Whether HQ ended a tag's deploy to production with neither a landing nor a failure: a job of it
 * refused, skipped or superseded, a service it left out never running its commit. One HQ says
 * landed waits for production's own word, never stalls; a release HQ has not listed has not ended.
 */
function stalledAt(tagged: FlowReleaseRow | undefined, stalled: string | undefined): boolean {
  if (tagged === undefined || tagged.standing !== undefined || tagged.verdict === "refused")
    return false;
  return tagged.tag === stalled;
}

/** Where the tag it made stands: on its way, live, or failed — `offered` before it was made. */
export function releaseOutcomeOf(input: {
  readonly tagged: FlowReleaseRow | undefined;
  readonly releasing: boolean;
  /** HQ ended its deploy with no landing and no failure (`releaseFollows`). */
  readonly stalled?: boolean | undefined;
  /** A newer release above it (`releaseFollows`). */
  readonly superseded?: { readonly by: string; readonly live: string | undefined } | undefined;
  readonly pressing: boolean;
  readonly tag: string;
  readonly clockMs: number;
}): ReleaseOutcome {
  const { tagged } = input;
  if (tagged?.standing === "live") return { kind: "released", at: tagged.taggedAt };
  if (tagged?.standing === "deploy-failed" || tagged?.verdict === "refused") {
    const service = tagged.failedEntry?.service;
    return {
      kind: "failed",
      detail:
        tagged.verdict === "refused"
          ? (tagged.detail ?? "HQ refused the release")
          : service === undefined
            ? "Its production deploy failed"
            : `The deploy of ${service} failed`,
      service,
      at: tagged.taggedAt,
    };
  }
  if (!input.releasing) return { kind: "offered" };
  if (input.superseded !== undefined) return { kind: "superseded", ...input.superseded };
  if (input.stalled === true) return { kind: "stalled", at: tagged?.taggedAt };
  if (input.pressing && tagged === undefined) {
    return { kind: "releasing", progress: `Tagging main as ${input.tag}` };
  }
  const since = tagged?.taggedAt === undefined ? Number.NaN : Date.parse(tagged.taggedAt);
  if (Number.isNaN(since)) {
    return { kind: "releasing", progress: `Production redeploys from ${input.tag}` };
  }
  const elapsed = Math.max(0, Math.floor((input.clockMs - since) / 1000));
  const clock = `${String(Math.floor(elapsed / 60))}:${String(elapsed % 60).padStart(2, "0")}`;
  return { kind: "releasing", progress: `Production redeploys from ${input.tag} · ${clock}` };
}

/**
 * One look at a release's review: where its tag stands, the facts to hold, and the facts shown.
 * `read` gives the facts of a tag as the project reads them now.
 */
export function releaseStep(input: {
  readonly follows: ReturnType<typeof releaseFollows>;
  readonly held: ReleaseFacts | undefined;
  readonly press: ReviewPress;
  readonly clockMs: number;
  readonly read: (tag: string) => ReleaseFacts;
}): {
  readonly outcome: ReleaseOutcome;
  readonly held: ReleaseFacts | undefined;
  readonly facts: ReleaseFacts;
  /** Whether production no longer runs what the release replaced (`ReleaseReviewInput`). */
  readonly productionMoved: boolean;
} {
  const { follows, press } = input;
  const outcome = releaseOutcomeOf({
    tagged: follows.tagged,
    releasing: follows.releasing,
    stalled: follows.stalled,
    superseded: follows.superseded,
    pressing: press.kind === "running",
    tag: follows.tag,
    clockMs: input.clockMs,
  });
  const current = input.read(follows.tag);
  const held = holdReleaseFacts({ held: input.held, current, press, outcome });
  return {
    outcome,
    held,
    facts: held ?? current,
    productionMoved: held !== undefined && !sameReplaces(current.replaces, held.replaces),
  };
}

function sameReplaces(left: ReleaseReplaces, right: ReleaseReplaces): boolean {
  return left.kind === "release" && right.kind === "release"
    ? left.tag === right.tag
    : left.kind === right.kind;
}

/**
 * Where each change the release carries stands on the stage that follows `main`, keyed by the
 * lower-case sha: the held changes, against the stage as it stands now. The changes are the
 * release's; the stage keeps moving after the press — a change released while the stage was still
 * deploying it is on stage, or failed there, later.
 */
export function releaseStageMarks(
  facts: Pick<ReleaseFacts, "contents">,
  stage: StageStandings | undefined,
  /** Each repository's `main` head (`ZeropsProjectFlow.repos`): a stage on it runs every change. */
  mainHeads?: ReadonlyMap<string, string>,
): ReadonlyMap<string, StageMark> {
  return stageMarks({ contents: facts.contents, stage, mainHeads });
}
