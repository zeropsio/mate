import {
  HqGitNavigationEnvironment,
  HqNavigationEnvironment,
  type HqNavigationJob,
} from "@t3tools/shared/hqStream";
/**
 * An application's stage and production as HQ's structure carries them (SPEC §3.2b): each
 * environment's record — its project, tier, name, the branches it follows, its place in the order
 * they were declared, whether HQ holds a working deploy token for it — and its newest jobs (the
 * deploy-jobs design): each a deploy of one service at one commit, or a delta importing what a
 * changed tier adds, asked for by an event, where it stands, and once it ended, when and why. HQ
 * sends them to whoever may read the application's changes (`read_change`); one who only sees the
 * application gets none.
 *
 * The contract is `@t3tools/shared/hqStream`'s; a set this build cannot read is not known, and never
 * takes the structure beside it down.
 *
 * @module hq/environments
 */
import { HqOutsideEnvironment } from "@t3tools/shared/hqEnvironment";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** A job of an environment, as HQ's record holds it. */
export type HqJob = HqNavigationJob;

/** A job HQ has not ended: one more state of it is to come. */
export const jobInFlight = (job: Pick<HqJob, "state">): boolean =>
  job.state === "queued" || job.state === "submitting" || job.state === "building";

/** A job that ended deploying nothing: the build's own failure, or HQ's refusal. */
export const jobFailed = (job: Pick<HqJob, "state">): boolean =>
  job.state === "failed" || job.state === "refused";

/** An environment as HQ sends it: its record with its identity (id and target). */
export type CanonicalHqEnvironment = HqNavigationEnvironment;
/** An environment's record without its identity: what `CanonicalHqEnvironment` adds its id and target to. */
export type HqEnvironment = Omit<HqNavigationEnvironment, "id" | "target">;

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

/** Additive delivery reader: Git uses its push schema, Zerops its deploy jobs. */
export type HqDeliveryEnvironment = CanonicalHqEnvironment | HqGitNavigationEnvironment;
const readDeliveryEnvironment = Schema.decodeUnknownOption(
  Schema.Union([
    HqGitNavigationEnvironment,
    HqNavigationEnvironment.check(
      Schema.makeFilter((environment) =>
        environment.target.kind === "zerops" ? undefined : "Expected Zerops deploy jobs",
      ),
    ),
  ]),
);

const readOutsideEnvironment = Schema.decodeUnknownOption(HqOutsideEnvironment);

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
 * ones it can, never taking them down. The application's outside production is its production with
 * nothing to deploy, read apart from the ones it delivers to (`outside`; absent where none stands).
 */
export function readDeliveryEnvironments(value: unknown): {
  readonly environments: ReadonlyArray<HqDeliveryEnvironment>;
  readonly unread: ReadonlyArray<UnreadEnvironment>;
  readonly outside?: HqOutsideEnvironment;
} {
  const environments: HqDeliveryEnvironment[] = [];
  const unread: UnreadEnvironment[] = [];
  let outside: HqOutsideEnvironment | undefined;
  for (const sent of Array.isArray(value) ? value : []) {
    const read = readDeliveryEnvironment(sent);
    if (Option.isSome(read)) {
      environments.push(read.value);
      continue;
    }
    const said = readOutsideEnvironment(sent);
    if (Option.isSome(said)) {
      outside = said.value;
      continue;
    }
    const tier = legible(sent, "tier");
    unread.push({
      id: legible(sent, "id"),
      name: legible(sent, "name"),
      tier: tier === "stage" || tier === "production" ? tier : null,
    });
  }
  return { environments, unread, ...(outside === undefined ? {} : { outside }) };
}

export function deliveryEnvironmentsOf(
  value: unknown,
): ReadonlyArray<HqDeliveryEnvironment> | undefined {
  return Array.isArray(value) ? readDeliveryEnvironments(value).environments : undefined;
}
