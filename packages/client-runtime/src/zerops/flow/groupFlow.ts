/**
 * One group's flow, as a projection over per-key facts (DESIGN §4.7): its open pull requests, its
 * stops and what each runs, and the release offer.
 *
 * - **The halves are independent.** The pull requests are known once every repository's open
 *   list is; each stop carries its own deployment. Nothing fills a missing half with `[]`.
 * - **The release offer** is known only when every input it is measured from is known — the
 *   declarations, the group repo's tags, each production service's deployment (what it runs, or
 *   what it deploys while a build runs) and the head of `main` it would release, where the
 *   repository has one — and is offered only while all of them are current. Until then the gate
 *   says why in the one phrase producer's words (`knownPresentation`, §3.4): checking, or the
 *   cause of the input that failed.
 * - **What a stop is (D7):** `environments.yaml` declares which stops exist and in what order,
 *   the project tags which Zerops projects are members. A declared stop without a member project
 *   is missing its project; a member without a declaration is not declared yet. Either takes
 *   both sides known.
 *
 * Pure (§7.2 rule 3): no network, no clock, no platform globals. The caller passes `nowMs`.
 *
 * @module flow/groupFlow
 */
import type { ServiceRef } from "../data/types.ts";
import type { MergeState } from "../forge/mergeState.ts";
import type { GiteaPullRequest, GiteaTag } from "../giteaClient.ts";
import type { GroupEnvironment } from "../groupEnvironments.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { Freshness, Known, Shown, Stamp } from "../knowledge/known.ts";
import {
  knownPresentation,
  type KnowledgeSource,
  type KnownAffordance,
} from "../knowledge/presentation.ts";
import { isReleaseTag, releaseOffer, type ReleaseGate } from "../release.ts";
import type { Deployment, StopService } from "./deployment.ts";
import { CHECKING_RELEASE } from "./release.ts";

/** A Zerops project the tags make a member of the group. */
export interface GroupFlowMember {
  readonly projectId: string;
  readonly name: string;
}

/** A pull request as the forge holds it, and how it merges. */
export interface GroupFlowPull {
  readonly pull: GiteaPullRequest;
  readonly state: MergeState;
}

/** One open pull request of the group, which `flowPullRequest` paints as a row. */
export interface GroupFlowPullRequest {
  readonly repository: string;
  readonly pull: GiteaPullRequest;
  readonly state: Extract<MergeState, { readonly kind: "open" }>;
}

export interface GroupFlowInputs {
  readonly entry: ZeropsRegistryGroup;
  readonly members: Shown<ReadonlyArray<GroupFlowMember>>;
  readonly declarations: Shown<ReadonlyArray<GroupEnvironment>>;
  /** The group org's repositories, by name. */
  readonly repos: Shown<ReadonlyArray<string>>;
  /** Each repository's open pull requests, by number. */
  readonly openPulls: ReadonlyMap<string, Shown<ReadonlyArray<number>>>;
  /** Each pull request by {@link pullKey}. */
  readonly pulls: ReadonlyMap<string, Shown<GroupFlowPull>>;
  /** The group repo's tags. */
  readonly tags: Shown<ReadonlyArray<GiteaTag>>;
  /** The sha each repository's `main` holds, by repository. */
  readonly mainHeads: ReadonlyMap<string, Shown<string>>;
  /** Each stop's runtime services and what each runs, by Zerops project id. */
  readonly stops: ReadonlyMap<string, Shown<ReadonlyArray<StopService>>>;
}

export interface GroupFlowCapabilities {
  /** The person may tag a release (`releaseGate`'s own check). */
  readonly mayRelease: boolean;
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
    }
  /** No project runs the stop, so there is nothing to read and nothing to wait for. */
  | { readonly standing: "missing-project"; readonly deployment: null; readonly services: null }
);

export type ReleaseOffer = ReturnType<typeof releaseOffer>;

export interface GroupFlow {
  readonly groupId: string;
  readonly slug: string;
  /** Every repository's open pull requests, in the org's order. */
  readonly pullRequests: Shown<ReadonlyArray<GroupFlowPullRequest>>;
  /** Declared stops in the file's order, then members not declared yet. */
  readonly stops: Shown<ReadonlyArray<StopRow>>;
  readonly release: Shown<ReleaseOffer>;
  /** Whether *Release* is offered now, and why not. */
  readonly releaseGate: ReleaseGate;
  /** What the person can do about a gate an input holds shut: *Try again* after a failed read. */
  readonly releaseAffordance: KnownAffordance | null;
  /** The stage services a merge into `repository`'s `main` deploys to. */
  readonly feeds: (repository: string) => ReadonlyArray<ServiceRef>;
}

/** A pull request's key in {@link GroupFlowInputs.pulls}. */
export const pullKey = (repository: string, number: number): string =>
  `${repository}#${String(number)}`;

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

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

function pullRequestsOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<GroupFlowPullRequest>> {
  const repos = inputs.repos;
  if (!isKnown(repos)) return repos as Shown<never>;
  const parts: Array<Part> = [{ shown: repos, source: "gitea" }];
  const rows: Array<GroupFlowPullRequest> = [];
  for (const repository of repos.value) {
    const open = inputs.openPulls.get(repository) ?? UNREAD;
    parts.push({ shown: open, source: "gitea" });
    if (!isKnown(open)) continue;
    for (const number of open.value) {
      const read = inputs.pulls.get(pullKey(repository, number)) ?? UNREAD;
      parts.push({ shown: read, source: "gitea" });
      // One that landed or closed since the list was read is no longer waiting.
      if (isKnown(read) && read.value.state.kind === "open") {
        rows.push({ repository, pull: read.value.pull, state: read.value.state });
      }
    }
  }
  return withValue(combine(parts).shown, () => rows);
}

/**
 * What a stop runs, from its services: the first deploying one by hostname, else the first
 * running one, else the first that is not known, else none — which only services that each run
 * none prove.
 */
function stopDeploymentOf(services: Shown<ReadonlyArray<StopService>>): Shown<Deployment> {
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

function stopsOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<StopRow>> {
  const { declarations, members } = inputs;
  const combined = combine([
    { shown: declarations, source: "gitea" },
    { shown: members, source: "zerops" },
  ]);
  if (!isKnown(declarations) || !isKnown(members)) return combined.shown as Shown<never>;
  const row = (
    projectId: string,
    name: string,
    tier: StopRow["tier"],
    standing: Exclude<StopStanding, "missing-project">,
  ): StopRow => {
    const services = inputs.stops.get(projectId) ?? UNREAD;
    return {
      projectId,
      name,
      tier,
      standing,
      services,
      deployment: stopDeploymentOf(services),
    };
  };
  const memberNames = new Map(members.value.map(({ projectId, name }) => [projectId, name]));
  const declared = new Set(declarations.value.map(({ project }) => project));
  return withValue(combined.shown, () => [
    ...declarations.value.map(({ project, name, tier }): StopRow => {
      const memberName = memberNames.get(project);
      return memberName === undefined
        ? {
            projectId: project,
            name,
            tier,
            standing: "missing-project",
            deployment: null,
            services: null,
          }
        : row(project, memberName, tier, "declared");
    }),
    // Filtered into a fresh array, so the sort touches nothing else (`toSorted` is not in Hermes).
    ...members.value
      .filter(({ projectId }) => !declared.has(projectId))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map(({ projectId, name }) => row(projectId, name, null, "not-declared")),
  ]);
}

/**
 * The release offer, and what it is measured from: the declarations name the production, each of
 * its services runs a commit, and `main` of the repository it is built from holds the candidate.
 */
function releaseOf(
  inputs: GroupFlowInputs,
  capabilities: GroupFlowCapabilities,
): { readonly release: Shown<ReleaseOffer>; readonly source: KnowledgeSource } {
  const { declarations, members, tags } = inputs;
  const parts: Array<Part> = [
    { shown: declarations, source: "gitea" },
    { shown: tags, source: "gitea" },
  ];
  if (!isKnown(members)) parts.push({ shown: members, source: "zerops" });
  const production = new Map<string, string>();
  const candidate = new Map<string, string>();
  for (const { tier, project } of isKnown(declarations) ? declarations.value : []) {
    // A production with no member project runs nothing anybody can read.
    if (
      tier !== "production" ||
      (isKnown(members) && !members.value.some(({ projectId }) => projectId === project))
    ) {
      continue;
    }
    const services = inputs.stops.get(project) ?? UNREAD;
    parts.push({ shown: services, source: "zerops" });
    if (!isKnown(services)) continue;
    for (const { hostname, deployment } of services.value) {
      const head = inputs.mainHeads.get(hostname) ?? UNREAD;
      parts.push({ shown: deployment, source: "zerops" });
      // A service with no repository of its name (or none on Gitea at all) has no candidate:
      // it is left out of the release, never a reason to hold the others.
      if (head.state !== "gone") parts.push({ shown: head, source: "gitea" });
      // A production mid-deploy is measured against what it deploys: that is what it will run.
      if (
        isKnown(deployment) &&
        deployment.value.kind !== "none" &&
        deployment.value.version.sha !== undefined
      ) {
        production.set(hostname, deployment.value.version.sha);
      }
      if (isKnown(head)) candidate.set(hostname, head.value);
    }
  }
  const combined = combine(parts);
  return {
    source: combined.source,
    release: isKnown(tags)
      ? withValue(combined.shown, () =>
          releaseOffer({
            mayRelease: capabilities.mayRelease,
            candidate,
            production,
            tags: tags.value.map(({ name }) => name).filter((name) => isReleaseTag(name)),
          }),
        )
      : (combined.shown as Shown<never>),
  };
}

/**
 * The gate the offer's own, only while it is current; otherwise why not and what to do about it,
 * as its region says them.
 */
function releaseGateOf(
  release: Shown<ReleaseOffer>,
  source: KnowledgeSource,
  nowMs: number,
): { readonly gate: ReleaseGate; readonly affordance: KnownAffordance | null } {
  const presentation = knownPresentation(
    release,
    {
      subject: "what can be released",
      entity: "project",
      source,
      checking: CHECKING_RELEASE,
      negative: null,
    },
    { nowMs, updateOffered: false },
  );
  if (release.state === "known" && presentation.current) {
    return { gate: release.value.gate, affordance: null };
  }
  return {
    gate: {
      allowed: false,
      reason: presentation.message?.text ?? presentation.banner?.message.text ?? CHECKING_RELEASE,
    },
    affordance: presentation.affordance ?? presentation.banner?.affordance ?? null,
  };
}

export function groupFlow(
  inputs: GroupFlowInputs,
  capabilities: GroupFlowCapabilities,
  nowMs: number,
): GroupFlow {
  const stops = stopsOf(inputs);
  const { release, source } = releaseOf(inputs, capabilities);
  const { gate, affordance } = releaseGateOf(release, source, nowMs);
  const fed = new Map<string, Array<ServiceRef>>();
  if (isKnown(stops)) {
    for (const { tier, services } of stops.value) {
      if (tier !== "stage" || services === null || !isKnown(services)) continue;
      for (const { hostname, service } of services.value) {
        fed.set(hostname, [...(fed.get(hostname) ?? []), service]);
      }
    }
  }
  return {
    groupId: inputs.entry.groupId,
    slug: inputs.entry.slug,
    pullRequests: pullRequestsOf(inputs),
    stops,
    release,
    releaseGate: gate,
    releaseAffordance: affordance,
    feeds: (repository) => fed.get(repository) ?? [],
  };
}
