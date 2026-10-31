/**
 * An application's releases to production in HQ (SPEC §3.2d). A release is an annotated tag
 * `v{x.y.z}` on the `main` of the application's recipe repository (`hqRecipe.ts` `RECIPE_REPO`),
 * the head read with the offer, whose message lists the commit each production service runs:
 * {@link releaseMessage}, read strictly by {@link parseReleaseMessage}. HQ judges a release before
 * it tags: a release it refuses is only an answer, never a tag nor a record; one it makes, Core tags
 * for the person `can`'s `release` allows (HQ's `permissions.ts`), so every release Core records
 * is approved. A refused record is either main's history, imported (T13), or one tag-record
 * recovery found refused (`mate-hq apps/hq/src/reconcile.ts`); either stays refused for ever. Releases are
 * ordered by version everywhere ({@link compareReleaseTags}): a new one must be newer than every
 * release, and production follows the newest approved one.
 *
 * A person's side, `Authorization: Bearer <session>`:
 *
 * - `GET /api/apps/:appId/releases` → {@link ReleaseListResponse}: newest first by version
 *   ({@link compareReleaseTags}), at most {@link RELEASES_SHOWN};
 * - `POST /api/apps/:appId/releases` {@link CreateReleaseRequest} → the {@link Release};
 * - `POST /api/apps/:appId/releases/:tag/rollback` {@link RollbackRequest} → a new release named
 *   the immutable review's fixed new tag, listing `:tag`'s entries; `:tag` stays as it was, and an
 *   unknown one is `404 release_not_found`.
 *
 * A refusal is `409 conflict` with one of {@link RELEASE_REFUSALS}; the words are the client's.
 *
 * @module hqRelease
 */
import { HqProblem } from "./hqProblems.ts";
import * as Schema from "effect/Schema";

import { HqRepoRemote, RepoName, Sha } from "./hqChanges.ts";
import { HqEnvironmentAttachment, HqTargetTimestamp } from "./hqEnvironment.ts";
import { HqPushRef } from "./hqDeploys.ts";

/** How many releases the history shows, as main's did (`RELEASES_SHOWN`). */
export const RELEASES_SHOWN = 10;

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
/** A Zerops service's hostname: what a release line names (main's broker's `serviceName`). */
const HOSTNAME = /^[a-z][a-z0-9]{0,39}$/u;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** A release's name: `v{major}.{minor}.{patch}`, nothing before or after. */
export const ReleaseTag = Schema.String.check(Schema.isPattern(TAG));

/** A version typed by a person or declared by code, in the release format HQ accepts. */
export function releaseTagOfVersion(version: string): string | undefined {
  const value = version.trim();
  const match = /^(?:v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(value);
  return match === null ? undefined : `v${match[1]}`;
}

/** A production service a release lists, by its hostname. */
export const ServiceName = Schema.String.check(Schema.isPattern(HOSTNAME));

/** One production service at the commit of its repository's `main` it is to run. */
export const ReleaseEntry = Schema.Struct({ service: ServiceName, sha: Sha });
export type ReleaseEntry = typeof ReleaseEntry.Type;

/** The service key is unchanged; a Git target names a repository instead of a hostname. */
export const GitReleaseEntry = Schema.Struct({ service: RepoName, sha: Sha });
export type GitReleaseEntry = typeof GitReleaseEntry.Type;
export const HqReleaseTarget = HqEnvironmentAttachment;
export type HqReleaseTarget = typeof HqReleaseTarget.Type;

const targetFields = {
  target: Schema.optionalKey(Schema.Literals(["zerops", "git"])),
  releaseTarget: Schema.optionalKey(HqReleaseTarget),
};

/** One destination/entry verdict for persisted records and incoming release requests. */
const releaseTargetMatches = (value: {
  readonly target?: "zerops" | "git";
  readonly releaseTarget?: HqReleaseTarget;
  readonly entries: ReadonlyArray<ReleaseEntry>;
}) => {
  if (value.target === "git") {
    if (
      value.releaseTarget?.target.kind !== "git" ||
      value.releaseTarget.target.delivery !== "direct"
    )
      return "Expected the accepted direct Git attachment";
  } else {
    if (
      value.releaseTarget !== undefined &&
      (value.target !== "zerops" || value.releaseTarget.target.kind !== "zerops")
    )
      return "Expected the accepted Zerops attachment";
    if (!value.entries.every((entry) => Schema.is(ServiceName)(entry.service)))
      return "Expected Zerops service hostnames";
  }
  return undefined;
};

/** One remote's review-time observation, with the host verdict and no credential values. */
export const HqGitReleasePreflight = Schema.Struct({
  repo: RepoName,
  remote: HqRepoRemote,
  ref: HqPushRef,
  before: Schema.NullOr(Sha),
  sha: Sha,
  verdict: Schema.Literals(["ready", "diverged", "credential", "declined", "unknown"]),
  reason: Schema.NullOr(Schema.String),
  checkedAt: HqTargetTimestamp,
});
export type HqGitReleasePreflight = typeof HqGitReleasePreflight.Type;

/** Domain membership recorded when a release is made; no commit content is stored here. */
export const ReleaseHistory = Schema.Struct({
  ranges: Schema.Array(Schema.Struct({ repo: RepoName, base: Schema.NullOr(Sha), head: Sha })),
  changes: Schema.Array(
    Schema.Struct({ repo: RepoName, number: Schema.Int, title: Schema.String }),
  ),
  commitCount: Schema.Int,
  outsideCommitCount: Schema.Int,
});
export type ReleaseHistory = typeof ReleaseHistory.Type;

/**
 * A release as HQ records it: its name, the recipe repository's `main` head it tags, what it lists,
 * who asked for it and when, HQ's verdict — the reason beside a refusal, none beside an approval —
 * and, for a rollback, the release it goes back to.
 */
export const Release = Schema.Struct({
  problems: Schema.optionalKey(Schema.Array(HqProblem)),
  tag: ReleaseTag,
  sha: Sha,
  entries: Schema.Array(GitReleaseEntry),
  ...targetFields,
  by: Schema.String,
  at: Schema.String,
  state: Schema.Literals(["approved", "refused"]),
  reason: Schema.NullOr(Schema.String),
  rollbackOf: Schema.NullOr(ReleaseTag),
  /** Older releases have no recorded membership; absence does not trigger a Git read. */
  history: Schema.optionalKey(ReleaseHistory),
  /** Exact copied approval; absent on historical records. */
  planHash: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))),
  /** Saved before production existed; the press requested no deployment. */
  snapshot: Schema.optionalKey(Schema.Boolean),
}).check(Schema.makeFilter(releaseTargetMatches));
export type Release = typeof Release.Type;

export const ReleaseListResponse = Schema.Struct({ releases: Schema.Array(Release) });
export type ReleaseListResponse = typeof ReleaseListResponse.Type;

/**
 * Where HQ's deploy of an application's newest release — by version, approved — stands in one
 * production environment, as its structure streams it beside the environment: derived from the
 * release's rollout and its jobs there, never stored. Planned once a leading Core asked for its
 * jobs; ended once every job it asked for there ended, and every job of a commit it found already
 * under way there — what it left out, followed to that job — ended too; landed where each of those
 * went live and its plan left nothing undone. A release with no rollout of its own — made before
 * rollouts were, recorded from git, or a snapshot — deploys nothing more: ended as it was made, and
 * never landed by HQ's word.
 */
export const ReleaseRollout = Schema.Struct({
  /** Its rollout; none where the release has none of its own. */
  id: Schema.NullOr(Schema.String),
  ...targetFields,
  /** The release it deploys. */
  tag: Schema.String,
  planned: Schema.Boolean,
  ended: Schema.Boolean,
  /** Absent from a Core before it said so: not known — never read as landed nor as stalled. */
  landed: Schema.optionalKey(Schema.Boolean),
  /** When its last job there ended, or when it was planned where it asked for none; ISO 8601. */
  endedAt: Schema.NullOr(Schema.String),
  /** Each service it asked nothing for there, and why: the job of the commit under way, if any. */
  leftOut: Schema.Array(
    Schema.Struct({
      service: Schema.String,
      sha: Schema.String,
      job: Schema.NullOr(Schema.String),
      reason: Schema.String,
      /**
       * HQ stopped the service because the release's tier does not declare it: by a rollback to
       * `rollbackTo`, or by an ordinary release where that is `null`. Absent for anything else.
       */
      stopped: Schema.optionalKey(Schema.Struct({ rollbackTo: Schema.NullOr(Schema.String) })),
    }),
  ),
}).check(Schema.makeFilter((value) => releaseTargetMatches({ ...value, entries: [] })));
export type ReleaseRollout = typeof ReleaseRollout.Type;

/**
 * A service HQ stopped because its environment's tier no longer declares it: by a stage's recipe
 * change, a release, or a rollback to the release `rollbackTo` (none for the first two). It stands
 * stopped until a tier declares it again or a person deletes it; HQ never deletes it.
 */
export const TierStop = Schema.Struct({
  service: Schema.String,
  rollbackTo: Schema.NullOr(Schema.String),
});
export type TierStop = typeof TierStop.Type;

/** Unique services. A Native non-code release explicitly lists []; Git requires a repository. */
const Entries = Schema.Array(GitReleaseEntry).check(
  Schema.makeFilter((entries: ReadonlyArray<ReleaseEntry>) =>
    new Set(entries.map((entry) => entry.service)).size === entries.length
      ? undefined
      : "Expected each service once",
  ),
);

/** HQ's persisted exact Native production effects, always reviewed before approval. */
export const ReleaseServicePlan = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  operations: Schema.Array(
    Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("create"),
        service: Schema.String,
        settings: Schema.Record(Schema.String, Schema.Unknown),
        cost: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("deploy"),
        service: Schema.String,
        serviceId: Schema.optionalKey(Schema.String),
        sha: Sha,
      }),
      Schema.Struct({
        kind: Schema.Literal("stop"),
        service: Schema.String,
        serviceId: Schema.String,
        reason: Schema.String,
      }),
      Schema.Struct({
        kind: Schema.Literal("start"),
        service: Schema.String,
        serviceId: Schema.String,
        reason: Schema.String,
      }),
    ]),
  ),
});
export type ReleaseServicePlan = typeof ReleaseServicePlan.Type;

/** Every Native operation reviews one captured declaration before approval. */
export const ReviewReleaseRequest = Schema.Struct({
  tag: ReleaseTag,
  groupHead: Sha,
  entries: Entries,
  target: Schema.Literal("zerops"),
  releaseTarget: HqReleaseTarget,
  rollbackOf: Schema.optionalKey(ReleaseTag),
}).check(
  Schema.makeFilter((value) =>
    value.releaseTarget.target.kind === "zerops" && value.releaseTarget.declaration !== undefined
      ? releaseTargetMatches(value)
      : "Expected the exact Native declaration",
  ),
);
export type ReviewReleaseRequest = typeof ReviewReleaseRequest.Type;

/**
 * A release as the person was offered it: its name, the recipe repository's `main` head read with
 * the offer (never one read at the press), and each production service at its repository's `main`
 * head then. HQ tags that head only while it is still `main`.
 */
export const CreateReleaseRequest = Schema.Struct({
  tag: ReleaseTag,
  groupHead: Sha,
  entries: Entries,
  planHash: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))),
  ...targetFields,
  preflight: Schema.optionalKey(Schema.Array(HqGitReleasePreflight)),
}).check(
  Schema.makeFilter((value) => {
    const verdict = releaseTargetMatches(value);
    if (verdict !== undefined) return verdict;
    if (value.target !== undefined && value.releaseTarget === undefined)
      return "Expected the reviewed attachment for an explicit target";
    if (value.target !== "git") {
      if (
        value.target !== "zerops" ||
        value.planHash === undefined ||
        value.releaseTarget?.declaration === undefined
      )
        return "Expected the reviewed Native plan and declaration";
      return value.preflight === undefined ? undefined : "Expected Git preflight only for Git";
    }
    if (value.entries.length === 0) return "Expected at least one Git repository";
    const target = value.releaseTarget?.target;
    if (target?.kind !== "git" || value.preflight === undefined)
      return "Expected the reviewed direct-delivery preflight";
    const entries = new Map(value.entries.map((entry) => [entry.service, entry.sha]));
    return value.preflight.length === entries.size &&
      new Set(value.preflight.map((review) => review.repo)).size === entries.size &&
      value.preflight.every(
        (review) =>
          review.verdict === "ready" &&
          review.ref === `refs/heads/${target.branch}` &&
          entries.get(review.repo) === review.sha,
      )
      ? undefined
      : "Expected a ready preflight for each fixed repository sha";
  }),
);
export type CreateReleaseRequest = typeof CreateReleaseRequest.Type;

/** A rollback accepts the exact current target and fixed new tag already bound by its reviewed plan. */
export const RollbackRequest = Schema.Struct({
  groupHead: Sha,
  releaseTarget: HqReleaseTarget,
  planHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
}).check(
  Schema.makeFilter((value) =>
    value.releaseTarget.target.kind === "zerops" && value.releaseTarget.declaration !== undefined
      ? undefined
      : "Expected the reviewed Native declaration",
  ),
);
export type RollbackRequest = typeof RollbackRequest.Type;

/**
 * Why HQ makes no release: the recipe repository's `main` moved since the offer, or it has none; a
 * release has the name already, or one is newer by version; an entry names no production service of
 * the application, or a commit that is not its repository's `main` nor before it; the release
 * rolled back to was refused; a branch production's release came without a ready preflight of
 * what it lists, or while its previous push is still under way.
 */
export const RELEASE_REFUSALS = [
  "group_moved",
  "production_moved",
  "no_group_main",
  "tag_taken",
  "tag_not_newer",
  "unknown_service",
  "entry_not_on_main",
  "release_not_approved",
  "git_release_blocked",
  "release_running",
] as const;

export type ReleaseRefusal = (typeof RELEASE_REFUSALS)[number];

/**
 * Why a tag's message is no release: it lists no service, has a line that is not `{service} {full
 * sha}`, or lists a service at two commits.
 */
export const RELEASE_MESSAGE_REFUSALS = [
  "release_empty",
  "release_line_unreadable",
  "release_service_twice",
] as const;

/** The message of a release listing `entries`: one `{service} {sha}` line each, by service. */
export function releaseMessage(entries: ReadonlyArray<ReleaseEntry>): string {
  return [...entries]
    .sort((left, right) => (left.service < right.service ? -1 : 1))
    .map((entry) => `${entry.service} ${entry.sha}\n`)
    .join("");
}

/**
 * What a release's message lists, by service, as main's broker read it: blank lines pass, any other
 * line that is not `{hostname} {full sha}` refuses the whole message — half a release would deploy
 * half an application — as does a service at two commits, or no service at all.
 */
export function parseReleaseMessage(
  message: string,
  target: "zerops" | "git" = "zerops",
):
  | { readonly entries: ReadonlyArray<ReleaseEntry> }
  | { readonly refused: (typeof RELEASE_MESSAGE_REFUSALS)[number] } {
  const found = new Map<string, string>();
  for (const raw of message.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const space = line.indexOf(" ");
    const service = space === -1 ? line : line.slice(0, space);
    const sha = space === -1 ? "" : line.slice(space + 1).trim();
    if (
      !(target === "git" ? Schema.is(RepoName)(service) : HOSTNAME.test(service)) ||
      !FULL_SHA.test(sha)
    )
      return { refused: "release_line_unreadable" };
    const listed = found.get(service);
    if (listed !== undefined && listed !== sha) return { refused: "release_service_twice" };
    found.set(service, sha);
  }
  if (found.size === 0) return { refused: "release_empty" };
  return {
    entries: [...found]
      .map(([service, sha]) => ({ service, sha }))
      .sort((left, right) => (left.service < right.service ? -1 : 1)),
  };
}

const versionOf = (tag: string) => {
  const match = TAG.exec(tag);
  return match === null ? undefined : [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)];
};

/**
 * Two release names by version, numerically: `v0.10.0` after `v0.9.0`, whatever its digits; a name
 * that is no release before every one that is.
 */
export function compareReleaseTags(left: string, right: string): number {
  const a = versionOf(left);
  const b = versionOf(right);
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 1 : -1;
  }
  return 0;
}

/** The name the next release is offered: the patch over the newest by version; `v0.1.0` first. */
export function nextPatch(tags: ReadonlyArray<string>): string {
  const newest = tags
    .filter((tag) => versionOf(tag) !== undefined)
    .reduce<string | undefined>(
      (best, tag) => (best === undefined || compareReleaseTags(tag, best) > 0 ? tag : best),
      undefined,
    );
  const version = newest === undefined ? undefined : versionOf(newest);
  if (version === undefined) return "v0.1.0";
  const [major, minor, patch] = version;
  return `v${String(major)}.${String(minor)}.${String(patch! + 1n)}`;
}

/** Original captured Native command; a historical omission proves nothing. */
export interface NativeReleaseIdentity {
  readonly tag: string;
  readonly groupHead: string;
  readonly entries: ReadonlyArray<ReleaseEntry>;
  readonly planHash: string;
  readonly releaseTarget: HqReleaseTarget;
  readonly principal: string;
  readonly rollbackOf?: string;
}
export function matchesNativeRelease(record: Release, original: NativeReleaseIdentity): boolean {
  const target = record.releaseTarget,
    expected = original.releaseTarget;
  return (
    record.target === "zerops" &&
    record.planHash === original.planHash &&
    /^[0-9a-f]{64}$/u.test(original.planHash) &&
    original.principal.length > 0 &&
    record.by === original.principal &&
    record.tag === original.tag &&
    record.sha === original.groupHead &&
    record.rollbackOf === (original.rollbackOf ?? null) &&
    target?.target.kind === "zerops" &&
    expected.target.kind === "zerops" &&
    expected.declaration !== undefined &&
    target.declaration === expected.declaration &&
    target.environmentId === expected.environmentId &&
    target.createdAt === expected.createdAt &&
    target.target.projectId === expected.target.projectId &&
    record.entries.length === original.entries.length &&
    original.entries.every((entry) =>
      record.entries.some((other) => entry.service === other.service && entry.sha === other.sha),
    )
  );
}
