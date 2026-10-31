import { HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
/**
 * An application's stage and production as HQ's structure carries them (SPEC §3.2b): each
 * environment's record — its project, tier, name, the branches it follows, its place in the order
 * they were declared, whether HQ holds a working deploy token for it — and its newest jobs (the
 * deploy-jobs design): each a deploy of one service at one commit, or a delta importing what a
 * changed tier adds, asked for by an event, where it stands, and once it ended, when and why. HQ
 * sends them to whoever may read the application's changes (`read_change`); one who only sees the
 * application gets none.
 *
 * Decoded here against `mate-hq apps/hq/src/structure.ts`'s `EnvironmentView` until the contract moves to
 * `@t3tools/shared`; a set this build cannot read is not known, and never takes the structure
 * beside it down.
 *
 * @module hq/environments
 */
import { HqEnvironmentDeclaration, hqEnvironmentCodec } from "@t3tools/shared/hqEnvironment";
import { HqOffers } from "@t3tools/shared/hqOffers";
import { EnvironmentBirth, HqDeployEvidence, HqDeployOutcome } from "@t3tools/shared/hqDeploys";
import { ReleaseRollout, TierStop } from "@t3tools/shared/hqRelease";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A job of an environment, as HQ's record holds it. */
export const HqJob = Schema.Struct({
  declaration: Schema.optionalKey(Schema.NullOr(HqEnvironmentDeclaration)),
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
  /** What the event names: a merge's squash commit on main, a release's tag; none else. */
  ref: Schema.NullOr(Schema.String),
  /** HQ's words for how it ended. */
  reason: Schema.NullOr(Schema.String),
  sourceArchiveBytes: HqDeployOutcome.fields.sourceArchiveBytes,
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
  declaration: Schema.optionalKey(HqEnvironmentDeclaration),
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
  /** True only when HQ proves it created this production target. Older HQs make no claim. */
  deleteProjectOnRemoval: Schema.optionalKey(Schema.Boolean),
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
  /**
   * The services HQ stopped because its tier no longer declares them (`TierStop`). Absent from a
   * Core older than this client: none known.
   */
  tierStops: Schema.optionalKey(Schema.Array(TierStop)),
  /** What the reader may do with it (`@t3tools/shared/hqOffers`); absent where HQ sent none. */
  can: Schema.optional(HqOffers),
});
export type HqEnvironment = typeof HqEnvironment.Type;

const { projectId: _projectId, ...payload } = HqEnvironment.fields;
export const CanonicalHqEnvironment = hqEnvironmentCodec(payload);
export type CanonicalHqEnvironment = typeof CanonicalHqEnvironment.Type;
const readCanonicalEnvironments = Schema.decodeUnknownOption(Schema.Array(CanonicalHqEnvironment));

export function canonicalEnvironmentsOf(
  value: unknown,
): ReadonlyArray<CanonicalHqEnvironment> | undefined {
  return Option.getOrUndefined(readCanonicalEnvironments(value));
}

/** Temporary outward DTOs only address Zerops; Git has no project to project. */
export function zeropsEnvironments(
  environments: ReadonlyArray<CanonicalHqEnvironment>,
): ReadonlyArray<HqEnvironment> {
  return environments.flatMap(({ id: _id, target, projectId: _legacy, ...environment }) =>
    target.kind === "zerops" ? [{ ...environment, projectId: target.projectId }] : [],
  );
}

/** An application's environments as HQ sent them; `undefined` where it sent none it can read. */
export function environmentsOf(value: unknown): ReadonlyArray<HqEnvironment> | undefined {
  const environments = canonicalEnvironmentsOf(value);
  return environments === undefined ? undefined : zeropsEnvironments(environments);
}

const isDeclaration = Schema.is(HqEnvironmentDeclaration);

/** Retained outcomes are history; only exact captured scope is current evidence. */
export function currentEnvironmentJobs(
  environment: Pick<HqEnvironment, "declaration" | "jobs">,
): ReadonlyArray<HqJob> {
  const declaration = environment.declaration;
  return !isDeclaration(declaration)
    ? []
    : environment.jobs.filter((job) => job.declaration === declaration);
}

/** A service's deploys: its newest job, and the newest that went live. */
export interface ServiceJobs {
  readonly latest: HqJob;
  readonly live: HqJob | null;
}

/** An environment's deploys by service hostname: each one's newest job, and its newest live one. */
export function jobsByService(
  environment: Pick<HqEnvironment, "declaration" | "jobs">,
): ReadonlyMap<string, ServiceJobs> {
  const services = new Map<string, ServiceJobs>();
  for (const job of currentEnvironmentJobs(environment)) {
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

/** Additive delivery reader: Git uses its push schema; older Zerops rows normalize once. */
export type HqDeliveryEnvironment = CanonicalHqEnvironment | HqGitNavigationEnvironment;
const readDeliveryEnvironment = Schema.decodeUnknownOption(
  Schema.Union([
    HqGitNavigationEnvironment,
    CanonicalHqEnvironment.check(
      Schema.makeFilter((environment) =>
        environment.target.kind === "zerops" ? undefined : "Expected Zerops deploy jobs",
      ),
    ),
  ]),
);

/** An environment HQ sent that this build cannot read: what is still legible of it, to name it. */
export interface UnreadEnvironment {
  readonly id: string | null;
  readonly name: string | null;
  /** Its tier where that much is legible. */
  readonly tier: "stage" | "production" | null;
}

/** The one place an unreadable environment is said: every surface that draws it uses these words. */
export const UNREAD_ENVIRONMENT_LINE = "Could not be read by this version";

export function unreadEnvironmentsWords(unread: ReadonlyArray<UnreadEnvironment>): string | null {
  if (unread.length === 0) return null;
  const names = unread.map(({ name, tier }) => name ?? tier ?? "An environment");
  return `${names.join(", ")} could not be read by this version of Mate. Reload to update it; the environment is still there.`;
}

const legible = (record: unknown, key: string): string | null => {
  const value = typeof record === "object" && record !== null ? Reflect.get(record, key) : null;
  return typeof value === "string" ? value : null;
};

/**
 * Each environment is read on its own: one this build cannot read is listed as unread beside the
 * ones it can, never taking them down. `undefined` where HQ sent no list at all.
 */
export function readDeliveryEnvironments(value: unknown): {
  readonly environments: ReadonlyArray<HqDeliveryEnvironment>;
  readonly unread: ReadonlyArray<UnreadEnvironment>;
} {
  const environments: HqDeliveryEnvironment[] = [];
  const unread: UnreadEnvironment[] = [];
  for (const sent of Array.isArray(value) ? value : []) {
    const read = readDeliveryEnvironment(sent);
    if (Option.isSome(read)) environments.push(read.value);
    else {
      const tier = legible(sent, "tier");
      unread.push({
        id: legible(sent, "id"),
        name: legible(sent, "name"),
        tier: tier === "stage" || tier === "production" ? tier : null,
      });
    }
  }
  return { environments, unread };
}

export function deliveryEnvironmentsOf(
  value: unknown,
): ReadonlyArray<HqDeliveryEnvironment> | undefined {
  return Array.isArray(value) ? readDeliveryEnvironments(value).environments : undefined;
}
