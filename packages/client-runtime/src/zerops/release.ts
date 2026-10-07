/**
 * Release and rollback — decided here, made in HQ as the person (SPEC §3.2d; main C01–C37).
 *
 * A release is HQ's record of one tag `v{x.y.z}` on the recipe repository's `main`, listing the
 * whole commit each production service runs from then on (`@t3tools/shared/hqRelease`). HQ makes
 * it of what the offer showed, approved at birth, and production follows the newest approved one.
 *
 * ## What the button shows before it is pressed
 *
 * Per service, the commit its repository's `main` holds against what production runs — read from
 * the sha in the deployed **version's name**, never from a branch head. A service whose two shas
 * already match is not a change; the release still lists it, because a release lists what
 * production should run, not what is new.
 *
 * ## What a release lists: what is merged (D28)
 *
 * Each repository's `main`, always — never what a stage happens to be running. A project may have
 * no stage at all; one that has a stage has it as a place that runs `main` too, not as a gate the
 * release waits behind (the owner, 2026-09-18: "I hope that even with stage prod release is not
 * tied to stage in any way").
 *
 * ## Who may
 *
 * HQ's rule (SPEC §3.3a): Basic user or above on production, and only where there is one. HQ
 * streams its decision beside the application (`can`'s `release`), and the button is offered by
 * it; HQ asks it again at the press, and a refusal that arrives anyway is shown in HQ's words.
 *
 * ## Rollback
 *
 * A new release listing an earlier release's entries, under the next name: a name is never
 * reused, so going back is going forward to the same contents — which is also the only form that
 * leaves a record of when it happened.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module release
 */

import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { compareReleaseTags, type Release, type ReleaseRollout } from "@t3tools/shared/hqRelease";

import type { ReleaseDeployFailure } from "./groupDeploys.ts";
import type { EnvironmentRow } from "./groupRows.ts";
import { sameCommit } from "./versionName.ts";

/** The seven characters a person reads a commit by. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/** One service's commit in a release. */
export interface ReleaseEntry {
  readonly service: string;
  /** The full 40-hex sha; nothing shorter is a release line. */
  readonly commit: string;
}

/** A whole commit sha: 40 hex, or 64 in a SHA-256 repository (`versionName.ts`). */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

/** Whether a tag name is one of ours. */
export function isReleaseTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+$/u.test(tag);
}

/** One row of what *Release* shows before it is pressed. */
export interface ReleaseComparison {
  readonly service: string;
  /** The sha that would be released, short; `undefined` when the basis has none. */
  readonly candidate: string | undefined;
  /** The sha production runs, short; `undefined` when it runs nothing. */
  readonly production: string | undefined;
  /** Whether this release would move the service at all. */
  readonly changed: boolean;
}

/**
 * Per service, what would be released against what production runs.
 *
 * The candidate is each repository's `main` (`releaseCandidate`), production's side the sha in a
 * deployed version's name; a service whose `main` holds nothing has no candidate and is not
 * released — there is no commit to list, and a release listing a guess is one HQ deploys.
 */
export function compareForRelease(input: {
  /** `{service: full sha}` each repository's default branch holds. */
  readonly candidate: ReadonlyMap<string, string>;
  /** `{service: sha}` from production's version names, whole or short (`deployedCommit`). */
  readonly production: ReadonlyMap<string, string>;
}): ReadonlyArray<ReleaseComparison> {
  const services = [...new Set([...input.candidate.keys(), ...input.production.keys()])].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  return services.map((service) => {
    const candidate = input.candidate.get(service);
    const production = input.production.get(service);
    return {
      service,
      candidate: candidate === undefined ? undefined : candidate.slice(0, 7),
      production: production === undefined ? undefined : production.slice(0, 7),
      changed: candidate !== undefined && !sameCommit(production, candidate),
    };
  });
}

/**
 * What a release would list, from the application's repositories as HQ answers them (C01): each
 * production runtime at its repository's `main` — a runtime whose repository has nothing on `main`
 * yet lists nothing — and the recipe repository's `main`, which the release tags; `undefined` where
 * it has none.
 */
export function releaseCandidate(input: {
  /** The repository each production runtime builds from, by hostname (`AppRecipe`). */
  readonly productionRepositories: ReadonlyMap<string, string>;
  readonly repos: ReadonlyArray<RepoListEntry>;
}): { readonly candidate: ReadonlyMap<string, string>; readonly groupHead: string | undefined } {
  const heads = new Map(
    input.repos.flatMap((repo) => (repo.mainHead === null ? [] : [[repo.name, repo.mainHead]])),
  );
  const candidate = new Map(
    [...input.productionRepositories].flatMap(([hostname, repo]) => {
      const head = heads.get(repo);
      return head === undefined ? [] : [[hostname, head] as const];
    }),
  );
  return { candidate, groupHead: heads.get(RECIPE_REPO) };
}

/** What a release would list: every service the basis has a commit for. */
export function releaseEntries(
  candidate: ReadonlyMap<string, string>,
): ReadonlyArray<ReleaseEntry> {
  return [...candidate.entries()]
    .filter(([, commit]) => FULL_SHA.test(commit))
    .map(([service, commit]) => ({ service, commit: commit.toLowerCase() }));
}

export type ReleaseGate =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: string;
      /** Set where HQ's own rule said no — not where it could not be asked. */
      readonly refusedBy?: "hq";
    };

/** Nothing is on `main` to release — a group whose Mates have landed nothing. */
export const RELEASE_NOTHING_MERGED = "Nothing is merged to release.";
/**
 * Production already runs every commit `main` holds, so the release would list
 * production's own state back to it and HQ would redeploy what is live. A
 * release still lists an unchanged service (that is what a release is); one
 * where *nothing* moved is not a release.
 */
export const RELEASE_NOTHING_NEW_ON_MAIN = "Production already runs what is merged.";
/** The owner's nothing-to-release verdict, in its existing words, for every review surface. */
export function releaseNothingReason(gate: ReleaseGate | undefined): string | undefined {
  if (gate === undefined || gate.allowed) return undefined;
  return gate.reason === RELEASE_NOTHING_MERGED || gate.reason === RELEASE_NOTHING_NEW_ON_MAIN
    ? gate.reason
    : undefined;
}
/** A release is a production's: an application with none has nothing to release to. */
export const RELEASE_NO_PRODUCTION = "There is no production to release to.";
/** Who may release is not known yet: HQ's rule has nothing to be asked over. */
export const RELEASE_CHECKING = "Checking what can be released…";
/** A release tagged and not yet running: another tag now would be a second release of it. */
export function releaseInFlightReason(tag: string): string {
  return `Releasing ${tag}…`;
}

/** How HQ judged a release, at its birth: approved, or refused (`Release.state`). */
export type ReleaseVerdict = Release["state"];

/** The newest release, for {@link releaseInFlight}. */
export interface ReleaseAttempt {
  readonly tag: string;
  readonly verdict: ReleaseVerdict;
}

/**
 * Where HQ's deploy of the newest release to production stands, by what HQ streams of it in each
 * production environment (`HqEnvironment.release`, one per production): on its way until every
 * production's word on it says it ended; ended then — landed where every one says all of it went
 * live. A release HQ ended with no rollout of its own (made before rollouts were, or recorded from
 * git) is ended. Nothing where HQ says nothing of this release — a production naming another, or
 * none, an HQ that tells no release's end, no production at all — and nothing for a release HQ
 * refused, which deploys nothing: what HQ has not said is never on its way. HQ follows
 * each build to its end, so nothing here waits on a clock.
 */
function releaseDeploy(input: {
  readonly newest: ReleaseAttempt | undefined;
  /** Each production environment's newest release; `undefined` where HQ tells none. */
  readonly rollouts: ReadonlyArray<ReleaseRollout | null | undefined>;
}):
  | {
      readonly tag: string;
      readonly ended: boolean;
      /** Whether all of it went live; `undefined` where a Core does not say. */
      readonly landed: boolean | undefined;
    }
  | undefined {
  const { newest } = input;
  if (newest === undefined || newest.verdict === "refused") return undefined;
  const its = input.rollouts.filter(
    (rollout): rollout is ReleaseRollout => rollout != null && rollout.tag === newest.tag,
  );
  if (its.length === 0) return undefined;
  return {
    tag: newest.tag,
    ended: its.every((rollout) => rollout.ended),
    landed: its.some((rollout) => rollout.landed === undefined)
      ? undefined
      : its.every((rollout) => rollout.landed === true),
  };
}

/** The release tag on its way to production (`releaseDeploy`), or `undefined`. */
export function releaseInFlight(input: Parameters<typeof releaseDeploy>[0]): string | undefined {
  const deploy = releaseDeploy(input);
  return deploy === undefined || deploy.ended ? undefined : deploy.tag;
}

/**
 * The newest release, once HQ ended its deploy to production saying some of it did not go live
 * (`releaseDeploy`), or `undefined`: one that landed waits for production's own word that it runs
 * it, and one a Core says nothing of landing of is never called stalled.
 */
export function releaseStalled(input: Parameters<typeof releaseDeploy>[0]): string | undefined {
  const deploy = releaseDeploy(input);
  return deploy?.ended === true && deploy.landed === false ? deploy.tag : undefined;
}

/** The one word beside a release's dot (R5). */
export function releaseWord(verdict: ReleaseVerdict): string {
  return verdict === "approved" ? "Approved" : "Refused";
}

/** A release as HQ records it, as the flow lists it: approved or refused, and when it was made. */
export function flowReleaseOf(release: Release): FlowRelease {
  const entries = release.entries.map(({ service, sha }) => ({ service, commit: sha }));
  return {
    tag: release.tag,
    verdict: release.state,
    detail: release.reason ?? undefined,
    line: entries.map((entry) => `${entry.service} ${shortCommit(entry.commit)}`).join(" · "),
    entries,
    taggedAt: release.at,
  };
}

/** One release of the application, as HQ judged it. */
export interface FlowRelease {
  readonly tag: string;
  readonly verdict: ReleaseVerdict;
  /** Why HQ refused it, when it did. */
  readonly detail: string | undefined;
  /** `api 3f9c1b2 · web 77ab0e1` — what it lists, short. */
  readonly line: string;
  /** What it lists, whole commits. */
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /** When HQ made it. */
  readonly taggedAt: string;
}

export interface FlowReleaseRow extends FlowRelease {
  /**
   * Where it stands against production: it runs there, or its deploy failed. `undefined` while
   * neither is known: the row says HQ's verdict.
   */
  readonly standing: "live" | "deploy-failed" | undefined;
  /** The word beside the dot — Live, Deploy failed, else HQ's Approved or Refused. */
  readonly word: string;
  /** Whether *Roll back to this* is offered. */
  readonly rollBack: boolean;
  /** The commit, and its service, whose production deploy failed; on a Deploy failed row only. */
  readonly failedEntry: ReleaseEntry | undefined;
}

/** A release as far as telling what runs it needs. */
type ReleaseListing = Pick<FlowRelease, "tag" | "entries" | "verdict">;

/**
 * The release `running` runs: the newest every commit of which it runs, commit to commit
 * (`sameCommit`), or `undefined`. A refused release never deployed, and one that lists nothing
 * names nothing it could run. `running` is `{hostname: sha}`, whole or short (`deployedCommit`).
 *
 * Over production, it is the release that reads Live. The newest, because a roll-back is a new
 * release of an earlier one's entries, and two releases then list the same commits; only the
 * later one is what production was last moved to.
 *
 * Over one stop's services, it is the release the stop is named by. A release lists every
 * service, and one that moved only some of them leaves the others running a commit an earlier tag
 * named first: Beviro's production ran medusa's commit from v0.1.9 through v0.1.13, and read
 * v0.1.9 because medusa was its first labelled service.
 */
export function releaseRunBy(
  releases: ReadonlyArray<ReleaseListing>,
  running: ReadonlyMap<string, string>,
): string | undefined {
  return releases.find((release) => release.verdict !== "refused" && runsAll(release, running))
    ?.tag;
}

/** Whether `running` runs every commit the release lists; one that lists nothing names nothing. */
function runsAll(release: Pick<FlowRelease, "entries">, running: ReadonlyMap<string, string>) {
  return (
    release.entries.length > 0 &&
    release.entries.every((entry) => sameCommit(running.get(entry.service), entry.commit))
  );
}

/**
 * The stop's row named by `tag` ({@link releaseRunBy}): its version's name and label, and the
 * line that spells them.
 *
 * The version keeps the first labelled service's commit (`sha`, `commit`) — the rule the row was
 * built by, and a commit the release lists too. That commit is what `sameVersion` compares against
 * the platform's answer, so the release name rides on the row only while the platform names the
 * same deploy. Its tagger is dropped: it tagged the release that service was last deployed by,
 * which may be an older one than the tag the stop is now named by.
 */
export function nameStopByRelease(row: EnvironmentRow, tag: string): EnvironmentRow {
  return {
    ...row,
    version: { ...row.version, name: tag, label: tag, taggedBy: undefined },
    line: `${row.source} · ${tag}`,
  };
}

/**
 * The commit the release lists, and production does not run, whose production deploy failed as
 * that release's (`ReleaseDeployFailure`: its rollout's job, or one it left a service out for);
 * `undefined` for none. Another release's failure of the same commit is that release's.
 */
function deployFailed(
  release: FlowRelease,
  production: ReadonlyMap<string, string>,
  failed: ReadonlyArray<ReleaseDeployFailure>,
): ReleaseEntry | undefined {
  return release.entries.find(
    (entry) =>
      !sameCommit(production.get(entry.service), entry.commit) &&
      failed.some(
        (failure) =>
          failure.tag === release.tag &&
          failure.service === entry.service &&
          (sameCommit(failure.sha, entry.commit) || sameCommit(entry.commit, failure.sha)),
      ),
  );
}

/**
 * A release's row, given its place in the newest-first list and what production runs.
 *
 * `deploys.live` says whether this is the release {@link releaseRunBy} names over production — the caller decides,
 * since only the newest of the releases that match reads Live. The live release offers no roll
 * back: going back to it would be a tag that changes nothing — nor does an older tag listing the
 * same commits, which a roll-back leaves behind (the live one's entries, released again). Nor does
 * the newest, which is what production was last moved to; a release HQ refused was never
 * deployed, so there is nothing to go back to.
 */
export function releaseRow(
  release: FlowRelease,
  index: number,
  deploys: {
    /** `{service: sha}` production runs, whole or short (`deployedCommit`). */
    readonly production: ReadonlyMap<string, string>;
    /** The production deploys that failed, each as a release's (`ReleaseDeploys.failed`). */
    readonly failed: ReadonlyArray<ReleaseDeployFailure>;
    readonly live: boolean;
  },
): FlowReleaseRow {
  const line =
    release.verdict === "refused" && release.detail !== undefined ? release.detail : release.line;
  if (deploys.live && release.verdict !== "refused")
    return {
      ...release,
      line,
      standing: "live",
      word: "Live",
      rollBack: false,
      failedEntry: undefined,
    };
  const failedEntry =
    release.verdict === "refused"
      ? undefined
      : deployFailed(release, deploys.production, deploys.failed);
  if (failedEntry !== undefined)
    return {
      ...release,
      line,
      standing: "deploy-failed",
      word: "Deploy failed",
      rollBack: false,
      failedEntry,
    };
  return {
    ...release,
    failedEntry: undefined,
    line,
    standing: undefined,
    word: releaseWord(release.verdict),
    rollBack: index > 0 && release.verdict === "approved" && !runsAll(release, deploys.production),
  };
}

/** Whether two releases list the same commits, service by service. */
function sameEntries(left: ReleaseListing, right: ReleaseListing): boolean {
  const commits = (release: ReleaseListing) =>
    release.entries
      .map(({ service, commit }) => `${service}=${commit.toLowerCase()}`)
      .sort()
      .join(",");
  return left.entries.length > 0 && commits(left) === commits(right);
}

/**
 * The release a roll back went back to: a roll back is a new tag listing an earlier release's
 * commits (`rollBack`), so a release listing exactly an earlier one's — the one that first shipped
 * them, HQ refused none — is that one again. What it carried, compared from the release before it,
 * goes back and lists nothing, so its row says this instead. `undefined` for any other release, and
 * for one listing what the release just before it listed: nothing went back.
 */
export function rolledBackTo(
  release: ReleaseListing,
  releases: ReadonlyArray<ReleaseListing>,
): string | undefined {
  const earlier = releases
    .filter(
      (entry) => entry.verdict !== "refused" && compareReleaseTags(entry.tag, release.tag) < 0,
    )
    .sort((left, right) => compareReleaseTags(left.tag, right.tag));
  const previous = earlier.at(-1);
  if (previous === undefined || sameEntries(previous, release)) return undefined;
  return earlier.find((entry) => sameEntries(entry, release))?.tag;
}

/**
 * What becomes of a production just added (P7): its first release's review opens by itself once the
 * production is there and the gate offers the release — main has code and this person may release
 * it — and never otherwise. `wait` while HQ has not yet said so; `drop` where it will not be
 * offered, and the production's row says it waits for its first release.
 */
export function firstReleaseHandoff(input: {
  /** Whether HQ holds the production now. */
  readonly hasProduction: boolean;
  /** The flow's release gate (`releaseGate`). */
  readonly gate: ReleaseGate;
}): "wait" | "open" | "drop" {
  if (!input.hasProduction) return "wait";
  if (input.gate.allowed) return "open";
  // Only what will not change by waiting ends it: nothing merged, nothing new, HQ's own refusal.
  // HQ not answering, a comparison not yet read, a release under way all pass.
  const { reason } = input.gate;
  return reason === RELEASE_NOTHING_MERGED ||
    reason === RELEASE_NOTHING_NEW_ON_MAIN ||
    input.gate.refusedBy === "hq"
    ? "drop"
    : "wait";
}
