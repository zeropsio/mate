/**
 * What an event that asks for deploys is answered with (the deploy-jobs design,
 * `mate-hq apps/hq/src/deploys.ts`): HQ submits each of its environments' jobs in the request that asked —
 * a merge, a release, a Run again, an Add service, an environment attached, a deploy key kept — and
 * answers where each stands once it did. A deploy that did not go through never undoes the event:
 * the merge stays merged, the release made.
 *
 * @module hqDeploys
 */
import * as Schema from "effect/Schema";
import { HqGitBranch, HqTargetTimestamp } from "./hqEnvironment.ts";
import { HqRemoteIdentity, RepoName, Sha } from "./hqChanges.ts";

/** HQ's words for a deploy Zerops did not answer, with what Zerops failed at. */
export const zeropsDidNotAnswer = (detail: string): string => `Zerops did not answer: ${detail}`;

/** The retained owner facts and the next actor/action of one deploy operation. */
export const HqDeployEvidence = Schema.Struct({
  phase: Schema.optionalKey(Schema.String),
  processes: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        _version: Schema.optionalKey(Schema.Number),
        error: Schema.optionalKey(Schema.Unknown),
      }),
    ),
  ),
  version: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        _version: Schema.optionalKey(Schema.Number),
      }),
    ),
  ),
  nextActor: Schema.Literals(["hq", "person", "none"]),
  nextAction: Schema.String,
});
export type HqDeployEvidence = typeof HqDeployEvidence.Type;

/**
 * One job the event asked for, in one environment, as it stands once HQ submitted what it could:
 * `building` (its build's process), `submitting` (Zerops' answer lost: HQ reads the version it
 * made), `queued` behind the job its environment builds (`behind`), or ended — `live` (the service
 * runs it already), `failed`, `refused` or `skipped`, HQ's words why. A service HQ asked nothing
 * for is `skipped` too: it runs the commit, or a job of it is under way (`job`, else none).
 */
export const HqDeployOutcome = Schema.Struct({
  /** The environment's name. */
  environment: Schema.String,
  kind: Schema.Literals(["deploy", "delta"]),
  service: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
  job: Schema.NullOr(Schema.String),
  state: Schema.Literals([
    "queued",
    "submitting",
    "building",
    "live",
    "failed",
    "refused",
    "unresolved",
    "skipped",
    "superseded",
  ]),
  processId: Schema.NullOr(Schema.String),
  /** The job it waits behind, while queued. */
  behind: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  /** Compressed source bytes HQ measured for this job; unknown before measurement. */
  sourceArchiveBytes: Schema.optionalKey(
    Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  ),
  evidence: Schema.optionalKey(Schema.NullOr(HqDeployEvidence)),
  appVersionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  verifiedVersionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  steps: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type HqDeployOutcome = typeof HqDeployOutcome.Type;

/** A written branch's full ref, distinct from a release's tag. */
export const HqPushRef = Schema.String.check(
  Schema.makeFilter((ref: string) =>
    ref.startsWith("refs/heads/") && Schema.is(HqGitBranch)(ref.slice("refs/heads/".length))
      ? undefined
      : "Expected a direct branch ref",
  ),
);

/** Persisted before remote I/O; later observations never replace this attempted destination. */
export const HqPushAttempt = Schema.Struct({
  remote: HqRemoteIdentity,
  ref: HqPushRef,
  sha: Sha,
  credentialKeptAt: HqTargetTimestamp,
  before: Schema.NullOr(Sha),
  phase: Schema.Literals(["submitting", "recovering"]),
});
export type HqPushAttempt = typeof HqPushAttempt.Type;

/** A confirmed hand-over says nothing about what the receiver runs. */
export const HqPushReceipt = Schema.Struct({
  remote: HqRemoteIdentity,
  ref: HqPushRef,
  before: Schema.NullOr(Sha),
  after: Sha,
  at: HqTargetTimestamp,
  via: Schema.Literals(["found", "answer", "resolve"]),
});
export type HqPushReceipt = typeof HqPushReceipt.Type;

/** A check that did not pass, with the host page that says why. */
export const HqPushCiFailure = Schema.Struct({
  name: Schema.String,
  url: Schema.NullOr(Schema.String),
});
export type HqPushCiFailure = typeof HqPushCiFailure.Type;

/**
 * What the origin's CI reported for the pushed commit, as HQ last read it (`mate-hq apps/hq/src/gitCi.ts`):
 * `none` (no check reported), `running` (`done` of `total` counted checks complete), `passed`,
 * `failed` (`failed` names each counted check that did not pass) or `unreadable` (`reason` says
 * why). `required` lists the branch rules' required checks, which alone count; null counts every
 * check. `missing` names the required checks a release's gate saw no run of. `watch` is `watching` until every counted check completed (`finished`) or HQ stopped
 * reading before that (`stopped`, `reason` says why); `until` is when watching stops at the latest
 * and `readAt` when HQ first read what the record now says (HQ writes only what changed).
 * Absent where HQ does not read CI: before the hand-over is confirmed or on a host other than GitHub.
 */
export const HqPushCi = Schema.Struct({
  sha: Sha,
  verdict: Schema.Literals(["none", "running", "passed", "failed", "unreadable"]),
  done: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Array(HqPushCiFailure),
  required: Schema.NullOr(Schema.Array(Schema.String)),
  missing: Schema.optionalKey(Schema.Array(Schema.String)),
  reason: Schema.NullOr(Schema.String),
  watch: Schema.Literals(["watching", "finished", "stopped"]),
  readAt: HqTargetTimestamp,
  until: HqTargetTimestamp,
});
export type HqPushCi = typeof HqPushCi.Type;

export const HqPushEvidence = Schema.Struct({
  attempt: Schema.optionalKey(HqPushAttempt),
  confirmed: Schema.optionalKey(HqPushReceipt),
  observed: Schema.optionalKey(Schema.NullOr(Sha)),
  ci: Schema.optionalKey(HqPushCi),
  /**
   * A release to an origin's main that has a stage: stage's CI on the attempted commit, counted as
   * main's rules require it, as stage's push ran it and HQ read it before pushing.
   */
  gate: Schema.optionalKey(HqPushCi),
  nextActor: HqDeployEvidence.fields.nextActor,
  nextAction: HqDeployEvidence.fields.nextAction,
}).check(
  Schema.makeFilter((value) => {
    const a = value.attempt;
    const c = value.confirmed;
    if (value.ci !== undefined && value.ci.sha !== c?.after)
      return "Expected CI of the confirmed commit";
    if (value.gate !== undefined && value.gate.sha !== a?.sha)
      return "Expected stage's check of the attempted commit";
    return c === undefined ||
      (a !== undefined &&
        a.remote.url === c.remote.url &&
        a.remote.repositoryId === c.remote.repositoryId &&
        a.ref === c.ref &&
        a.sha === c.after &&
        a.before === c.before)
      ? undefined
      : "Expected confirmation of the retained attempt";
  }),
);
export type HqPushEvidence = typeof HqPushEvidence.Type;

/**
 * A Git environment's latest confirmed push of one repository, as a Mate of its application reads
 * it (`GET /api/mate/self`): the commit the origin took on the environment's branch and `ci`, the
 * record HQ keeps on that push's evidence, absent where HQ read none.
 */
export const MateGitPush = Schema.Struct({
  environment: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
  branch: HqGitBranch,
  repo: RepoName,
  sha: Sha,
  ci: Schema.optionalKey(HqPushCi),
}).check(
  Schema.makeFilter((value) =>
    value.ci === undefined || value.ci.sha === value.sha
      ? undefined
      : "Expected CI of the pushed commit",
  ),
);
export type MateGitPush = typeof MateGitPush.Type;

/** Additive push export: existing deploy readers retain their Zerops state contract. */
export const HqPushOutcome = Schema.Struct({
  ...HqDeployOutcome.fields,
  kind: Schema.Literal("push"),
  service: RepoName,
  sha: Sha,
  state: Schema.Literals(["queued", "submitting", "pushed", "refused", "unresolved", "superseded"]),
  processId: Schema.Null,
  appVersionId: Schema.optionalKey(Schema.Null),
  verifiedVersionId: Schema.optionalKey(Schema.Null),
  steps: Schema.optionalKey(Schema.Array(HqPushEvidence)),
  evidence: Schema.optionalKey(Schema.NullOr(HqPushEvidence)),
}).check(
  Schema.makeFilter((value) => {
    const evidence = value.evidence;
    if (value.state === "pushed" && evidence?.confirmed?.after !== value.sha)
      return "Expected a confirmed hand-over of this sha";
    if (
      (value.state === "submitting" || value.state === "unresolved") &&
      evidence?.attempt?.sha !== value.sha
    )
      return "Expected the retained attempt for this sha";
    return undefined;
  }),
);
export type HqPushOutcome = typeof HqPushOutcome.Type;
export const HqDeliveryOutcome = Schema.Union([HqDeployOutcome, HqPushOutcome]);
export type HqDeliveryOutcome = typeof HqDeliveryOutcome.Type;
export const HqDeliveryAnswer = Schema.Struct({
  jobs: Schema.Array(HqDeliveryOutcome),
  note: Schema.NullOr(Schema.String),
  planned: Schema.optionalKey(Schema.Boolean),
  rollout: Schema.optionalKey(Schema.String),
});
export type HqDeliveryAnswer = typeof HqDeliveryAnswer.Type;

/**
 * Every job an event asked for, and what HQ left out of it, in its words: what the event's own
 * answer carries as `deploys`. `planned: false` when HQ answered before the event's rollout was
 * planned — another rollout of the organisation held planning, or HQ could not plan it now — and
 * the leading HQ plans it later: its jobs come down HQ's navigation by the event (`cause`, `ref`).
 * Absent or `true`, the rollout was planned and `jobs` are all it asked for. An HQ older than the
 * field always planned before answering. `rollout` names the rollout a handed-over answer waits on,
 * by its id in HQ's navigation (`HqNavigationRollout`): once that reads planned and no job of the
 * event shows, HQ's `note` there is the answer. Absent from an older HQ: followed by its jobs only.
 */
export const HqDeployAnswer = Schema.Struct({
  jobs: Schema.Array(HqDeployOutcome),
  note: Schema.NullOr(Schema.String),
  planned: Schema.optionalKey(Schema.Boolean),
  rollout: Schema.optionalKey(Schema.String),
});
export type HqDeployAnswer = typeof HqDeployAnswer.Type;

/** An event that asked for no deploy. */
export const NO_DEPLOYS: HqDeployAnswer = { jobs: [], note: null };

/**
 * What every answer of an event that asks for deploys carries beside its own — a change merged, a
 * release made, an environment attached, a key kept — and all a Run again or an Add service
 * answers.
 */
export const WithDeploys = Schema.Struct({ deploys: HqDeployAnswer });
export type WithDeploys = typeof WithDeploys.Type;

/**
 * Whether an environment HQ brought up is up as far as HQ takes it, as its structure streams it
 * beside the environment (`mate-hq apps/hq/src/births.ts`), never stored: from the rollout its attach asked
 * for (`env_added`) to its first deploy that ran, with every deploy key kept and Run again between.
 * Ended once those rollouts were planned and their jobs ended — a first deploy HQ makes ends live
 * only after its subdomain, where one was intended, came on or said why not — and a deploy ran, or
 * the environment holds a working key. An environment HQ did not bring up has none.
 */
export const EnvironmentBirth = Schema.Struct({ ended: Schema.Boolean });
export type EnvironmentBirth = typeof EnvironmentBirth.Type;
