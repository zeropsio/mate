/**
 * What an event that asks for deploys is answered with (the deploy-jobs design,
 * `apps/hq/src/deploys.ts`): HQ submits each of its environments' jobs in the request that asked —
 * a merge, a release, a Run again, an Add service, an environment attached, a deploy key kept — and
 * answers where each stands once it did. A deploy that did not go through never undoes the event:
 * the merge stays merged, the release made.
 *
 * @module hqDeploys
 */
import * as Schema from "effect/Schema";

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
  evidence: Schema.optionalKey(Schema.NullOr(HqDeployEvidence)),
  appVersionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  verifiedVersionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  steps: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type HqDeployOutcome = typeof HqDeployOutcome.Type;

/**
 * Every job an event asked for, and what HQ left out of it, in its words: what the event's own
 * answer carries as `deploys`.
 */
export const HqDeployAnswer = Schema.Struct({
  jobs: Schema.Array(HqDeployOutcome),
  note: Schema.NullOr(Schema.String),
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
 * beside the environment (`apps/hq/src/births.ts`), never stored: from the rollout its attach asked
 * for (`env_added`) to its first deploy that ran, with every deploy key kept and Run again between.
 * Ended once those rollouts were planned and their jobs ended — a first deploy HQ makes ends live
 * only after its subdomain, where one was intended, came on or said why not — and a deploy ran, or
 * the environment holds a working key. An environment HQ did not bring up has none.
 */
export const EnvironmentBirth = Schema.Struct({ ended: Schema.Boolean });
export type EnvironmentBirth = typeof EnvironmentBirth.Type;
