/**
 * One group's flow, as the account runtime's commands read it (DESIGN §4.7): its stops and what
 * each runs, the tiers it has not added, its releases and the release offer — and what a stop
 * runs, from its services (`stopDeploymentOf`), which every surface reads.
 *
 * Pure (§7.2 rule 3): no network, no clock, no platform globals.
 *
 * @module flow/groupFlow
 */
import type { ServiceRef } from "../data/types.ts";
import type { GiteaCommit } from "../giteaClient.ts";
import type { GroupEnvironment, MissingEnvironmentRow } from "../groupEnvironments.ts";
import type { GroupEnvironmentRowInput } from "../groupDeploys.ts";
import type { Freshness, Shown, Stamp } from "../knowledge/known.ts";
import type { KnowledgeSource, KnownAffordance } from "../knowledge/presentation.ts";
import type { FlowReleaseRow, ReleaseGate, releaseOffer } from "../release.ts";
import type { Deployment, StopService } from "./deployment.ts";

/** One release of the group: its tag, and its row once the broker's verdict on it is read. */
export interface GroupFlowRelease {
  readonly tag: string;
  /** Never "not judged yet" before the verdict is read: until then it is the read's own state. */
  readonly row: Shown<FlowReleaseRow>;
}

/** Where a stop stands between the declarations and the project tags (D7). */
export type StopStanding = "declared" | "missing-project" | "not-declared";

export type StopRow = {
  readonly projectId: string;
  /** The member project's name, else the declaration's. */
  readonly name: string;
  /** `null` for a member not declared yet. */
  readonly tier: GroupEnvironment["tier"] | null;
} & (
  | {
      readonly standing: Exclude<StopStanding, "missing-project">;
      /** What the stop runs: its first running service by hostname, or none once each runs none. */
      readonly deployment: Shown<Deployment>;
      readonly services: Shown<ReadonlyArray<StopService>>;
      /**
       * The declared environment's row: the version each service runs and how its deploy went;
       * `null` for a member not declared yet, whose statuses nothing names.
       */
      readonly environment: Shown<GroupEnvironmentRowInput> | null;
    }
  /** No project runs the stop, so there is nothing to read and nothing to wait for. */
  | {
      readonly standing: "missing-project";
      readonly deployment: null;
      readonly services: null;
      readonly environment: null;
    }
);

export type ReleaseOffer = ReturnType<typeof releaseOffer>;

/** One production service's share of what a release would carry. */
export interface ReleaseContent {
  readonly service: string;
  readonly commits: ReadonlyArray<GiteaCommit>;
}

export interface GroupFlow {
  readonly groupId: string;
  readonly slug: string;
  /** Declared stops in the file's order, then members not declared yet. */
  readonly stops: Shown<ReadonlyArray<StopRow>>;
  /** The tiers the recipe on `main` offers and the group has not added: the rows that ask. */
  readonly missing: Shown<ReadonlyArray<MissingEnvironmentRow>>;
  readonly release: Shown<ReleaseOffer>;
  /** What pressing *Release* would put live: per service, the commits production does not run. */
  readonly releaseContents: Shown<ReadonlyArray<ReleaseContent>>;
  /** The group repo's releases, newest first, known once its tags are; each row with its verdict. */
  readonly releases: Shown<ReadonlyArray<GroupFlowRelease>>;
  /** Whether *Release* is offered now, and why not. */
  readonly releaseGate: ReleaseGate;
  /** What the person can do about a gate an input holds shut: *Try again* after a failed read. */
  readonly releaseAffordance: KnownAffordance | null;
  /**
   * The stage services a merge into `repository`'s `main` deploys to: known once the stops, the
   * tiers on `main` and every stage's services are.
   */
  readonly feeds: (repository: string) => Shown<ReadonlyArray<ServiceRef>>;
}

/** An input and who answers for it, as a combination names the cause of one that failed. */
interface Part {
  readonly shown: Shown<unknown>;
  readonly source: KnowledgeSource;
}

/** The worst freshness first: a combination is as current as its least current part. */
const FRESHNESS_RANK: Record<Freshness["kind"], number> = {
  live: 0,
  settled: 1,
  revalidating: 2,
  paused: 3,
  stale: 4,
};

/** Which non-known state a combination takes: withheld, then failed, gone, reading, unread. */
const STATE_RANK: Record<Exclude<Shown<unknown>["state"], "known">, number> = {
  withheld: 0,
  failed: 1,
  gone: 2,
  reading: 3,
  unread: 4,
};

/**
 * Several inputs as one: known with the worst freshness and the narrowest coverage when every
 * part is, else the most telling part that is not, with the source that answers for it.
 */
function combine(parts: ReadonlyArray<Part>): {
  readonly shown: Shown<null>;
  readonly source: KnowledgeSource;
} {
  let blocking: Part | null = null;
  let freshness: Freshness = { kind: "live" };
  let asOf: Stamp = { ordinal: 0, atMs: 0 };
  let complete = true;
  let source: KnowledgeSource = "zerops";
  for (const part of parts) {
    const shown = part.shown;
    if (shown.state !== "known") {
      if (
        blocking === null ||
        STATE_RANK[shown.state] < STATE_RANK[blocking.shown.state as keyof typeof STATE_RANK]
      ) {
        blocking = part;
      }
      continue;
    }
    if (FRESHNESS_RANK[shown.freshness.kind] > FRESHNESS_RANK[freshness.kind]) {
      freshness = shown.freshness;
      source = part.source;
    }
    if (shown.asOf.ordinal > asOf.ordinal) asOf = shown.asOf;
    complete &&= shown.coverage === "complete";
  }
  if (blocking !== null) {
    return { shown: blocking.shown as Shown<never>, source: blocking.source };
  }
  return {
    shown: {
      state: "known",
      value: null,
      asOf,
      coverage: complete ? "complete" : "partial",
      freshness,
    },
    source,
  };
}

/** `value` under the combination's state, when it is known. */
function withValue<T>(combined: Shown<null>, value: () => T): Shown<T> {
  return combined.state === "known" ? { ...combined, value: value() } : combined;
}

const isKnown = <T>(shown: Shown<T>): shown is Extract<Shown<T>, { readonly state: "known" }> =>
  shown.state === "known";

/**
 * What a stop runs, from its services: the first deploying one by hostname, else the first
 * running one, else the first that is not known, else none — which only services that each run
 * none prove.
 */
export function stopDeploymentOf(services: Shown<ReadonlyArray<StopService>>): Shown<Deployment> {
  if (!isKnown(services)) return services as Shown<never>;
  const first = (kind: Deployment["kind"]) =>
    services.value.find(
      ({ deployment }) => deployment.state === "known" && deployment.value.kind === kind,
    );
  const answer = first("deploying") ?? first("running");
  if (answer !== undefined) return answer.deployment;
  const combined = combine([
    { shown: services, source: "zerops" },
    ...services.value.map(({ deployment }) => ({ shown: deployment, source: "zerops" as const })),
  ]);
  return withValue(combined.shown, (): Deployment => ({ kind: "none" }));
}

/**
 * How many of the newest releases the flow lists, and so reads the broker's verdict on (D5): one
 * read per release tag ever made grows with the group's age.
 */
export const RELEASES_SHOWN = 10;
