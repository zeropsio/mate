/**
 * How an application's production releases ended, for the conversation and the Mate: each release
 * production runs now, and each that did not go live, with the cause the flow knows.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseEnded
 */
import { type HqJob, jobFailed } from "./hq/environments.ts";
import { serviceNames } from "./projectAttention.ts";
import type { ReleaseEndedEvent } from "./projectFlow.ts";
import type { FlowReleaseRow } from "./release.ts";
import type { ReleaseFailure } from "./releaseFacts.ts";

/**
 * A release that had to create services in production before deploying, and did not: its `delta`
 * job there ended without going live. HQ then deploys nothing of that release.
 */
export interface ReleaseCreationFailed {
  readonly tag: string;
  /** The services it was to create, by hostname; none from an HQ that does not name them. */
  readonly services: ReadonlyArray<string>;
  readonly endedAt: string | undefined;
}

/** The release creations that did not go through, among production's jobs as HQ lists them. */
export function releaseCreationsFailed(
  jobs: ReadonlyArray<Pick<HqJob, "kind" | "cause" | "ref" | "state" | "services" | "endedAt">>,
): ReadonlyArray<ReleaseCreationFailed> {
  return jobs.flatMap((job) =>
    job.kind === "delta" &&
    job.cause === "release" &&
    job.ref !== null &&
    (jobFailed(job) || job.state === "unresolved")
      ? [{ tag: job.ref, services: job.services ?? [], endedAt: job.endedAt ?? undefined }]
      : [],
  );
}

/** "db could not be created", "db and cache could not be created". */
export function creationFailedWords(services: ReadonlyArray<string>): string {
  return services.length === 0
    ? "a service it needs could not be created"
    : `${serviceNames(services)} could not be created`;
}

/** A failure's cause in a clause, as far as the flow knows it. */
function causeOf(failure: ReleaseFailure): string | undefined {
  if (failure.kind === "deploy-failed" && failure.services.length > 0)
    return `${serviceNames(failure.services)} did not deploy`;
  // HQ's own sentence for a refusal or a stall, its first: said once, without its full stop.
  const words = failure.error?.split(/[;\n]/u)[0]?.trim().replace(/\.$/u, "");
  return words === undefined || words.length === 0 ? undefined : words;
}

/**
 * Every release that ended as the flow can tell it, oldest first: the one production runs, and
 * each that did not go live — its creation failed, HQ refused it, its deploy failed or stalled. A
 * release on its way says nothing yet, and neither does an earlier one production has moved past:
 * what the flow no longer records is not guessed.
 */
export function releaseEndedEvents(input: {
  /** Newest first, as the flow lists them. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
  readonly failureOf: (release: FlowReleaseRow) => ReleaseFailure | undefined;
  readonly creations: ReadonlyArray<ReleaseCreationFailed>;
  /** Production's newest rollout: when the release it deploys ended there. */
  readonly rollout?: { readonly tag: string; readonly endedAt: string | null } | null | undefined;
}): ReadonlyArray<ReleaseEndedEvent> {
  const live = input.releases.find((release) => release.standing === "live");
  const rolloutEnd = (tag: string) =>
    input.rollout?.tag === tag ? (input.rollout.endedAt ?? undefined) : undefined;
  const events: Array<ReleaseEndedEvent> = [];
  for (const release of input.releases) {
    const { tag, taggedAt } = release;
    if (release.standing === "live") {
      events.push({
        key: `release-ended:${tag}:live`,
        tag,
        outcome: "live",
        taggedAt,
        endedAt: rolloutEnd(tag) ?? taggedAt,
        cause: undefined,
        stillRuns: undefined,
      });
      continue;
    }
    const creation = input.creations.find((entry) => entry.tag === tag);
    const failure = input.failureOf(release);
    if (creation === undefined && failure === undefined) continue;
    events.push({
      key: `release-ended:${tag}:failed`,
      tag,
      outcome: "failed",
      taggedAt,
      endedAt: creation?.endedAt ?? failure?.at ?? rolloutEnd(tag) ?? taggedAt,
      // What it could not create comes first: HQ refusing its deploys follows from it.
      cause:
        creation !== undefined
          ? creationFailedWords(creation.services)
          : failure === undefined
            ? undefined
            : causeOf(failure),
      // What ran when it failed is known only while production has not moved since.
      stillRuns:
        live !== undefined && Date.parse(live.taggedAt) < Date.parse(taggedAt)
          ? live.tag
          : undefined,
    });
  }
  // `toSorted` is not in Hermes, so the copy is explicit.
  return [...events].sort((left, right) => left.endedAt.localeCompare(right.endedAt));
}
