/**
 * An application's stage and production as HQ's structure carries them (SPEC §3.2b): each
 * environment's record — its project, tier, name, the branches it follows, its place in the order
 * they were declared, whether HQ holds a working deploy token for it — and its newest jobs (the
 * deploy-jobs design): each a deploy of one service at one commit, or a delta importing what a
 * changed tier adds, asked for by an event, where it stands, and once it ended, when and why. HQ
 * sends them to whoever may read the application's changes (`read_change`); one who only sees the
 * application gets none.
 *
 * Decoded here against `apps/hq/src/structure.ts`'s `EnvironmentView` until the contract moves to
 * `@t3tools/shared`; a set this build cannot read is not known, and never takes the structure
 * beside it down.
 *
 * @module hq/environments
 */
import { HqOffers } from "@t3tools/shared/hqOffers";
import { EnvironmentBirth, HqDeployEvidence } from "@t3tools/shared/hqDeploys";
import { ReleaseRollout } from "@t3tools/shared/hqRelease";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A job of an environment, as HQ's record holds it. */
export const HqJob = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["deploy", "delta"]),
  /** The service it deploys, by its hostname; none for a delta. */
  service: Schema.NullOr(Schema.String),
  sha: Schema.NullOr(Schema.String),
  /**
   * queued → submitting → building → live, failed (the build's own, final until a person asks
   * again), refused (what did not go through at its one try), skipped (what HQ chose not to
   * submit, and why), unresolved (a person must inspect the original handle), or superseded (a newer one came while it waited).
   */
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
  /** The event that asked for it. */
  cause: Schema.Literals([
    "merge",
    "release",
    "run_again",
    "add_service",
    "env_added",
    "key_kept",
    "import",
    "migrated",
  ]),
  /** What the event names: a merge's head, a release's tag; none else. */
  ref: Schema.NullOr(Schema.String),
  /** HQ's words for how it ended. */
  reason: Schema.NullOr(Schema.String),
  evidence: Schema.optionalKey(Schema.NullOr(HqDeployEvidence)),
  verifiedVersionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  steps: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  /** The platform's version and job it is followed by: its log. */
  appVersionId: Schema.NullOr(Schema.String),
  processId: Schema.NullOr(Schema.String),
  /** Who asked for it, where a person did; none while only HQ asked. */
  requestedBy: Schema.NullOr(Schema.String),
  /** When it was asked for, and when it ended; ISO 8601. */
  at: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  supersededBy: Schema.NullOr(Schema.String),
});
export type HqJob = typeof HqJob.Type;

/** A job HQ has not ended: one more state of it is to come. */
export const jobInFlight = (job: Pick<HqJob, "state">): boolean =>
  job.state === "queued" || job.state === "submitting" || job.state === "building";

/** A job that ended deploying nothing: the build's own failure, or HQ's refusal. */
export const jobFailed = (job: Pick<HqJob, "state">): boolean =>
  job.state === "failed" || job.state === "refused";

export const HqEnvironment = Schema.Struct({
  projectId: Schema.String,
  tier: Schema.Literals(["stage", "production"]),
  name: Schema.String,
  /** The branches it follows: a stage `main`, a production `release`. */
  sources: Schema.Array(Schema.String),
  /** Its place among the application's environments, in the order they were declared: from 1. */
  order: Schema.Number,
  /** Whether HQ holds its deploy token; the token itself is never answered. */
  keyHeld: Schema.Boolean,
  /** Whether the token held no longer answers, or reaches more than its project. */
  keyInvalid: Schema.Boolean,
  /** Its newest jobs, newest first, and each service's newest live one where it is older. */
  jobs: Schema.Array(HqJob),
  /**
   * A production's: where its application's newest release stands there; none before one, and for
   * a stage. Absent from a Core older than this client: not known, never on its way.
   */
  release: Schema.optionalKey(Schema.NullOr(ReleaseRollout)),
  /**
   * Whether HQ is still bringing it up; none where HQ did not. Absent from a Core older than this
   * client: not known, never coming up.
   */
  birth: Schema.optionalKey(Schema.NullOr(EnvironmentBirth)),
  /** What the reader may do with it (`@t3tools/shared/hqOffers`); absent where HQ sent none. */
  can: Schema.optional(HqOffers),
});
export type HqEnvironment = typeof HqEnvironment.Type;

const readEnvironments = Schema.decodeUnknownOption(Schema.Array(HqEnvironment));

/** An application's environments as HQ sent them; `undefined` where it sent none it can read. */
export function environmentsOf(value: unknown): ReadonlyArray<HqEnvironment> | undefined {
  return Option.getOrUndefined(readEnvironments(value));
}

/** A service's deploys: its newest job, and the newest that went live. */
export interface ServiceJobs {
  readonly latest: HqJob;
  readonly live: HqJob | null;
}

/** An environment's deploys by service hostname: each one's newest job, and its newest live one. */
export function jobsByService(
  environment: Pick<HqEnvironment, "jobs">,
): ReadonlyMap<string, ServiceJobs> {
  const services = new Map<string, ServiceJobs>();
  for (const job of environment.jobs) {
    if (job.kind !== "deploy" || job.service === null) continue;
    const held = services.get(job.service);
    // Newest first: a service's first job is its newest, its first live one its newest live.
    if (held === undefined) {
      services.set(job.service, { latest: job, live: job.state === "live" ? job : null });
    } else if (held.live === null && job.state === "live") {
      services.set(job.service, { ...held, live: job });
    }
  }
  return services;
}
