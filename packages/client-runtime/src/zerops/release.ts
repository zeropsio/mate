/**
 * Release and rollback — decided here, performed as the person (guide 5.5, 5.6).
 *
 * A release is an annotated tag `v{semver}` on the **group repo**, created by a
 * person through Gitea, whose message lists one line per service:
 *
 * ```
 * api 3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d
 * web 77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8
 * ```
 *
 * `{service hostname} {full 40-hex sha}`, and nothing else
 * (`../gitea-mate/docs/group-repo.md`). A short sha would never compare equal
 * to a version's name and the broker would redeploy for ever, so it is refused
 * rather than tolerated.
 *
 * ## What the button shows before it is pressed
 *
 * Per service, what the stage runs against what production runs — both read
 * from the sha in the deployed **version's name**, never from a branch head.
 * A service whose two shas already match is not a change; the tag still lists
 * it, because a tag lists what production should run, not what is new.
 *
 * ## A project with no stage (D28)
 *
 * A project may be a Mate and a production with nothing in between. There is
 * no deployed commit to list then, and nothing to have verified one on: what
 * is merged is what such a project releases, so the candidate is each
 * repository's default branch. The person's merge is the review, the tag is
 * still the approval, and the day the project declares a stage the candidate
 * is what that stage runs again (`releaseBasis`).
 *
 * ## Who may
 *
 * Two gates, and only one of them is real. Gitea's tag protection lets the
 * `release` team create `v*` and refuses everybody else — that is the one that
 * decides. The app's own gate (`groups[slug].release` from the shared role
 * function) only keeps the button from being offered to somebody it would
 * refuse; a `403` that arrives anyway is shown as what it is.
 *
 * ## Rollback
 *
 * A new tag listing an earlier tag's commits. A tag name is never reused, and
 * `POST /deploy` takes no ref, so going back is going forward to the same
 * contents under a new name — which is also the only form that leaves a record
 * of when it happened.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module release
 */

import type { GiteaCommitStatus } from "./giteaClient.ts";

/** One service's commit in a release. */
export interface ReleaseEntry {
  readonly service: string;
  /** The full 40-hex sha; nothing shorter is a release line. */
  readonly commit: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/iu;

/** What a release tag is called. */
export function releaseTagName(version: string): string {
  return `v${version}`;
}

/** The commit status the broker writes for one release tag. */
export function releaseStatusContext(tag: string): string {
  return `mate/release/${tag}`;
}

/** Whether a tag name is one of ours. */
export function isReleaseTag(tag: string): boolean {
  return /^v\d+\.\d+\.\d+$/u.test(tag);
}

/**
 * The tag's message, from the services a release covers.
 *
 * Sorted by service so two releases of the same contents produce the same
 * message, and a diff between two tags reads as the commits that moved.
 */
export function releaseMessage(entries: ReadonlyArray<ReleaseEntry>): string {
  return [...entries]
    .filter((entry) => FULL_SHA.test(entry.commit))
    .sort((left, right) => left.service.localeCompare(right.service, "en"))
    .map((entry) => `${entry.service} ${entry.commit.toLowerCase()}`)
    .join("\n");
}

/**
 * The entries a tag's message lists, or `[]` for a message this build cannot
 * read.
 *
 * Tolerant of blank lines and nothing else: a line that is not
 * `{service} {full sha}` makes the tag unparseable, and the broker refuses it.
 * Reading one leniently here would show a release the broker will never deploy.
 */
export function readReleaseMessage(message: string): ReadonlyArray<ReleaseEntry> {
  const entries: Array<ReleaseEntry> = [];
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [service, commit, ...rest] = trimmed.split(/\s+/u);
    if (service === undefined || commit === undefined || rest.length > 0) return [];
    if (!FULL_SHA.test(commit)) return [];
    entries.push({ service, commit: commit.toLowerCase() });
  }
  return entries;
}

/** A semantic version, as far as suggesting the next one needs. */
export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export function readSemver(tag: string): Semver | undefined {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(tag.trim());
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(left: Semver, right: Semver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** The newest `v*` tag on the group repo, by version rather than by name. */
export function newestReleaseTag(tags: ReadonlyArray<string>): string | undefined {
  let best: { readonly tag: string; readonly version: Semver } | undefined;
  for (const tag of tags) {
    const version = readSemver(tag);
    if (version === undefined) continue;
    if (best === undefined || compareSemver(version, best.version) > 0) best = { tag, version };
  }
  return best?.tag;
}

/**
 * What to call the next release — the newest tag's patch and minor, and
 * `v0.1.0` for a group that has never released.
 *
 * A suggestion and not a rule: the person types what they mean. Two of them
 * because that is the choice anybody actually makes at this button, and a
 * major bump is rare enough to be typed.
 */
export function suggestReleaseTags(tags: ReadonlyArray<string>): {
  readonly patch: string;
  readonly minor: string;
} {
  const newest = newestReleaseTag(tags);
  const version = newest === undefined ? undefined : readSemver(newest);
  if (version === undefined) return { patch: "v0.1.0", minor: "v0.1.0" };
  return {
    patch: `v${version.major}.${version.minor}.${version.patch + 1}`,
    minor: `v${version.major}.${version.minor + 1}.0`,
  };
}

/**
 * Where a release's commits come from: what the stage runs, or — for a project
 * that declares no stage — what each repository's default branch holds.
 */
export type ReleaseBasis = "stage" | "main";

/** `main` for a project with no stage between its Mates and its production. */
export function releaseBasis(declarations: ReadonlyArray<{ readonly tier: string }>): ReleaseBasis {
  return declarations.some((entry) => entry.tier === "stage") ? "stage" : "main";
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
 * With a stage both sides come from the sha in a deployed version's name, so a
 * service the stage has never deployed to has no side to compare and cannot be
 * released — there is no commit to list, and a tag listing a guess is a tag the
 * broker deploys. With none, the candidate is the default branch's head.
 */
export function compareForRelease(input: {
  /** `{service: full sha}` that would be released (`ReleaseBasis`). */
  readonly candidate: ReadonlyMap<string, string>;
  /** `{service: full sha}` from production's version names. */
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
      changed: candidate !== undefined && candidate !== production,
    };
  });
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
  | { readonly allowed: false; readonly reason: string };

/** What the app says when it will not offer the button. */
export const RELEASE_NOT_A_RELEASER = "Only releasers can tag.";
export const RELEASE_NOTHING_TO_LIST = "The stage has not deployed anything to release.";
/**
 * Every service of the stage already runs what production runs, so the tag
 * would list production's own state back to it and the broker would redeploy
 * what is live. A tag still lists an unchanged service (that is what a tag is);
 * a release where *nothing* moved is not a release.
 */
export const RELEASE_NOTHING_CHANGED = "Production already runs what the stage runs.";
/** The same two, for a project with no stage — never a sentence about one it lacks. */
export const RELEASE_NOTHING_MERGED = "Nothing is merged to release.";
export const RELEASE_NOTHING_NEW_ON_MAIN = "Production already runs what is merged.";

/**
 * Whether to offer *Release* at all.
 *
 * The app's own gate, from the role function's `groups[slug].release`. It is
 * not the real one — Gitea's tag protection is, and a `403` from it is shown
 * with this same sentence, because it means the same thing and the mirror
 * simply had not caught up.
 */
export function releaseGate(input: {
  readonly mayRelease: boolean;
  readonly entries: ReadonlyArray<ReleaseEntry>;
  /**
   * Per service, the stage against production. Omitted where production's
   * side is not known — then the gate says nothing about what would move.
   */
  readonly comparison?: ReadonlyArray<ReleaseComparison> | undefined;
  /** Where the entries come from; a stage unless the project has none. */
  readonly basis?: ReleaseBasis | undefined;
}): ReleaseGate {
  const onMain = input.basis === "main";
  if (!input.mayRelease) return { allowed: false, reason: RELEASE_NOT_A_RELEASER };
  if (input.entries.length === 0) {
    return { allowed: false, reason: onMain ? RELEASE_NOTHING_MERGED : RELEASE_NOTHING_TO_LIST };
  }
  const comparison = input.comparison;
  if (comparison !== undefined && comparison.length > 0 && !comparison.some((row) => row.changed)) {
    return {
      allowed: false,
      reason: onMain ? RELEASE_NOTHING_NEW_ON_MAIN : RELEASE_NOTHING_CHANGED,
    };
  }
  return { allowed: true };
}

/**
 * What the button shows before it is pressed, from what would be released and
 * what production actually runs.
 *
 * The whole offer in one answer, so no surface holds release logic of its own:
 * the comparison the person reads, the tag name that would be suggested,
 * whether it is offered at all, and the entries the tag lists — the verb tags
 * exactly what the offer showed.
 */
export function releaseOffer(input: {
  readonly mayRelease: boolean;
  readonly basis: ReleaseBasis;
  /**
   * `{service: full sha}` that would be released: what the stage runs
   * (`groupDeploys.releaseDeploys`), or each repository's default branch for a
   * project with no stage.
   */
  readonly candidate: ReadonlyMap<string, string>;
  /** `{service: full sha}` production runs. */
  readonly production: ReadonlyMap<string, string>;
  /** Every `v*` tag on the group repo, so no name is suggested twice. */
  readonly tags: ReadonlyArray<string>;
}): {
  readonly gate: ReleaseGate;
  readonly suggestion: string;
  readonly comparison: ReadonlyArray<ReleaseComparison>;
  readonly entries: ReadonlyArray<ReleaseEntry>;
} {
  const entries = releaseEntries(input.candidate);
  const comparison = compareForRelease({
    candidate: input.candidate,
    production: input.production,
  });
  return {
    gate: releaseGate({ mayRelease: input.mayRelease, entries, comparison, basis: input.basis }),
    suggestion: suggestReleaseTags(input.tags).patch,
    comparison,
    entries,
  };
}

/**
 * A rollback's tag: a new name, the earlier tag's message verbatim.
 *
 * Verbatim and not re-derived, because the earlier tag is the record of what
 * production ran and a re-derivation would quietly release whatever the stage
 * holds now (guide 5.6). `undefined` when the earlier tag's message cannot be
 * read — there is nothing to go back to that the broker would accept.
 */
export function rollbackTo(input: {
  readonly tag: string;
  readonly message: string;
  readonly existingTags: ReadonlyArray<string>;
}): { readonly tag: string; readonly message: string } | undefined {
  const entries = readReleaseMessage(input.message);
  if (entries.length === 0) return undefined;
  const next = suggestReleaseTags(input.existingTags).patch;
  return { tag: next, message: releaseMessage(entries) };
}

/** What the broker said about a release tag — approved, refused, or not yet. */
export type ReleaseVerdict = "approved" | "refused" | "pending" | "unknown";

/**
 * The broker's verdict on one tag, from the commit statuses on the tagged
 * commit (`mate/release/{tag}`).
 *
 * `unknown` when there is no status for that tag: the webhook has not been
 * processed, or nobody is signed in to Gitea to read one. Never read as
 * approved — a tag the broker refused looks exactly like a tag it has not
 * seen, and only one of them ever deploys.
 */
export function releaseVerdict(
  tag: string,
  statuses: ReadonlyArray<GiteaCommitStatus>,
): { readonly verdict: ReleaseVerdict; readonly detail: string | undefined } {
  const status = statuses.find((entry) => entry.context === releaseStatusContext(tag));
  if (status === undefined) return { verdict: "unknown", detail: undefined };
  const verdict: ReleaseVerdict =
    status.state === "success"
      ? "approved"
      : status.state === "failure" || status.state === "error"
        ? "refused"
        : "pending";
  return { verdict, detail: status.description };
}

/** The one word beside a release's dot (R5). */
export function releaseWord(verdict: ReleaseVerdict): string | undefined {
  switch (verdict) {
    case "approved":
      return "Approved";
    case "refused":
      return "Refused";
    case "pending":
      return "Checking";
    case "unknown":
      return undefined;
  }
}
