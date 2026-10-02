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

import { RELEASE_IN_FLIGHT_MS, type FlowReleaseRow, type ReleaseComparison } from "./release.ts";
import type { ReleaseOutcome, ReleaseReplaces, ReviewPress } from "./reviewVerdict.ts";
import {
  stageMarks,
  type ServiceChanges,
  type StageMark,
  type StageStandings,
} from "./stageMarks.ts";

/** A release's own facts, as the review shows them. */
export interface ReleaseFacts {
  /** The version it tags. */
  readonly tag: string;
  /** What production ran as it was offered: what this one replaces, and where a roll back goes. */
  readonly replaces: ReleaseReplaces;
  /** What goes out, service by service (`releaseContents`). */
  readonly contents: ReadonlyArray<ServiceChanges>;
  /** Where each service's `main` was, which orients its commits (`stageMarks`). */
  readonly mainHeads: ReadonlyMap<string, string> | undefined;
  /** Where: per service, what it redeploys from, or what it stays on. */
  readonly where: ReadonlyArray<{ readonly service: string; readonly line: string }>;
  /** The production services that redeploy — every one, when the comparison moves none. */
  readonly services: ReadonlyArray<string>;
  /**
   * When it was tagged, as first read once held. Only the newest tag's date is read, and a read
   * can fail: held, the age outlives a newer tag above it.
   */
  readonly taggedAt?: string | undefined;
  /** When the review first held it — the press, or the first look — for a tag whose date is unread. */
  readonly seenAt?: number | undefined;
}

/** The facts as the project reads them now. */
export function releaseFacts(input: {
  readonly tag: string;
  /** The release production runs in full now (`releaseRunBy`), if any does. */
  readonly live: string | undefined;
  /** Every release of the group: the first release is one with none before it. */
  readonly releases: ReadonlyArray<Pick<FlowReleaseRow, "tag" | "verdict">>;
  readonly contents: ReadonlyArray<ServiceChanges>;
  readonly mainHeads: ReadonlyMap<string, string> | undefined;
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
    mainHeads: input.mainHeads,
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
  readonly held: Pick<ReleaseFacts, "tag" | "taggedAt" | "seenAt"> | undefined;
  readonly press: ReviewPress;
  /** The release tag on its way to production (`releaseInFlight`). */
  readonly inFlight: string | undefined;
  /** The version offered next. */
  readonly suggestion: string;
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  /** The minute clock, for the cutoff. */
  readonly nowMs: number;
}): {
  readonly tag: string;
  readonly tagged: FlowReleaseRow | undefined;
  readonly releasing: boolean;
  /** When the followed tag was tagged, else when the review first held it; `undefined` before. */
  readonly sinceMs: number | undefined;
  /**
   * On its way longer than {@link RELEASE_IN_FLIGHT_MS} and neither live nor failed: the wait is
   * over, and the review says the tag hasn't landed.
   */
  readonly stalled: boolean;
  /**
   * The newer tag the broker did not refuse that sits above the followed one, and what production
   * runs in full: the follow is over. `undefined` while the followed tag is the newest, or live.
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
  const held = pinned === tag ? input.held : undefined;
  const sinceMs =
    [tagged?.taggedAt, held?.taggedAt]
      .map((at) => (at === undefined ? Number.NaN : Date.parse(at)))
      .find((ms) => !Number.isNaN(ms)) ?? held?.seenAt;
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
    superseded === undefined &&
    releaseStalled({ tagged, sinceMs, nowMs: input.nowMs });
  return {
    tag,
    tagged,
    releasing,
    sinceMs,
    stalled,
    superseded,
    ticking: releasing && tagged?.standing === undefined && !stalled && superseded === undefined,
  };
}

/**
 * Whether a tag on its way has waited out {@link RELEASE_IN_FLIGHT_MS} with neither a landing nor
 * a failure — the cutoff `releaseInFlight` stops holding Release back at. Measured from `sinceMs`:
 * the tag's date, else when the review first held it, so a tag whose date is never read still
 * ends. A tag not read at all yet counts from there too.
 */
export function releaseStalled(input: {
  readonly tagged: FlowReleaseRow | undefined;
  readonly sinceMs: number | undefined;
  readonly nowMs: number;
}): boolean {
  const { tagged, sinceMs } = input;
  if (tagged !== undefined && (tagged.standing !== undefined || tagged.verdict === "refused"))
    return false;
  return sinceMs !== undefined && input.nowMs - sinceMs >= RELEASE_IN_FLIGHT_MS;
}

/** Where the tag it made stands: on its way, live, or failed — `offered` before it was made. */
export function releaseOutcomeOf(input: {
  readonly tagged: FlowReleaseRow | undefined;
  readonly releasing: boolean;
  /** Past the cutoff with no landing and no failure (`releaseFollows`). */
  readonly stalled?: boolean | undefined;
  /** A newer tag above it (`releaseFollows`). */
  readonly superseded?: { readonly by: string; readonly live: string | undefined } | undefined;
  /** When it was tagged, or first held (`releaseFollows`), for its clock. */
  readonly sinceMs?: number | undefined;
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
          ? (tagged.detail ?? "The broker refused the tag")
          : service === undefined
            ? "Its production deploy failed"
            : `The deploy of ${service} failed`,
      service,
      at: tagged.taggedAt,
    };
  }
  if (!input.releasing) return { kind: "offered" };
  if (input.superseded !== undefined) return { kind: "superseded", ...input.superseded };
  const since =
    input.sinceMs ?? (tagged?.taggedAt === undefined ? Number.NaN : Date.parse(tagged.taggedAt));
  if (input.stalled === true)
    return {
      kind: "stalled",
      at: tagged?.taggedAt,
      ...(Number.isNaN(since) ? {} : { sinceMs: since }),
    };
  if (input.pressing && tagged === undefined) {
    return { kind: "releasing", progress: `Tagging main as ${input.tag}` };
  }
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
  /** The minute clock: when a review first holds a release. */
  readonly nowMs: number;
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
    sinceMs: follows.sinceMs,
    pressing: press.kind === "running",
    tag: follows.tag,
    clockMs: input.clockMs,
  });
  const current = input.read(follows.tag);
  const kept = holdReleaseFacts({ held: input.held, current, press, outcome });
  // Held, it keeps when it was first held and the tag's date once read: only the newest tag's
  // date is read, and the age has to outlive a newer tag above it.
  const taggedAt = kept?.taggedAt ?? follows.tagged?.taggedAt;
  const held =
    kept === undefined || (kept.seenAt !== undefined && kept.taggedAt === taggedAt)
      ? kept
      : { ...kept, seenAt: kept.seenAt ?? input.nowMs, taggedAt };
  const facts = held ?? current;
  return {
    outcome,
    held,
    facts,
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
  facts: Pick<ReleaseFacts, "contents" | "mainHeads">,
  stage: StageStandings | undefined,
): ReadonlyMap<string, StageMark> {
  return stageMarks({ contents: facts.contents, mainHeads: facts.mainHeads, stage });
}
