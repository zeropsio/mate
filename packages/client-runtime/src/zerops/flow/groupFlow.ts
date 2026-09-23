/**
 * One group's flow, as a projection over per-key facts (DESIGN §4.7): its open and landed pull
 * requests, its stops and what each runs, the tiers it has not added, its releases and the
 * release offer.
 *
 * - **The halves are independent.** The pull requests are known once every repository's open
 *   list is, the landings once every repository's recent landings are; each stop carries its own
 *   deployment, and a declared stop its environment row — each service's version and how its
 *   deploy went, from the statuses on that commit. Nothing fills a missing half with `[]`.
 * - **Releases** are the group repo's newest release tags, newest first, known once the tags are;
 *   each row carries the broker's verdict on its commit, and a verdict not read yet holds its own
 *   row rather than reading as not judged.
 * - **The release offer** is known only when every input it is measured from is known — the
 *   declarations, the group repo's tags, the tiers on `main`, each production service's
 *   deployment (what it runs, or what it deploys while a build runs) and the head of `main` of the
 *   repository its tier builds it from, where it has one — and is offered only while all of them
 *   are current. A service's repository is the tier's `buildFromGit`, never its hostname. Until
 *   then the gate says why in the one phrase producer's words (`knownPresentation`, §3.4):
 *   checking, or the cause of the input that failed. What a release would put live is read on
 *   top of a known offer: what `main` has over the commit production runs, or `main`'s head for a
 *   first release.
 * - **What the recipe offers:** a tier whose import is on the group repo's `main` and that no
 *   declaration and no member's role fills is a row that asks for it.
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
import type { GiteaCommit, GiteaCommitStatus, GiteaPullRequest, GiteaTag } from "../giteaClient.ts";
import {
  environmentTierForRole,
  missingEnvironmentRows,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  type MissingEnvironmentRow,
} from "../groupEnvironments.ts";
import type { GroupEnvironmentRowInput } from "../groupDeploys.ts";
import type { DeployedVersion, EnvironmentServiceState } from "../groupRows.ts";
import type { ZeropsEnvironmentRole } from "../groups.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { Freshness, Known, Shown, Stamp } from "../knowledge/known.ts";
import {
  knownPresentation,
  type KnowledgeSource,
  type KnownAffordance,
} from "../knowledge/presentation.ts";
import { importReadyTier } from "../recipeTier.ts";
import {
  GROUP_REPOSITORY,
  isReleaseTag,
  planReleaseReads,
  readReleaseMessage,
  readSemver,
  releaseOffer,
  releaseRow,
  releaseVerdict,
  shortCommit,
  type FlowRelease,
  type FlowReleaseRow,
  type ReleaseGate,
} from "../release.ts";
import type { Deployment, StopService } from "./deployment.ts";
import { CHECKING_RELEASE } from "./release.ts";

/** A Zerops project the tags make a member of the group. */
export interface GroupFlowMember {
  readonly projectId: string;
  readonly name: string;
  /**
   * Its role tag, which says which tier it fills before any declaration does; stated by every
   * binding, since a project left without one reads as filling no tier.
   */
  readonly role: ZeropsEnvironmentRole | undefined;
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

/** What the group repo's `main` offers: the tiers whose import is on it, and where code lives. */
export interface TiersOnMain {
  /** The tiers whose import is on `main` — what a person can add. */
  readonly tiers: ReadonlyArray<GroupEnvironmentTier>;
  /**
   * The repository each runtime builds from, by hostname, from the tiers' `buildFromGit`. A
   * repository's name is its own: `appdev` for a pair's promoted runtime `app`.
   */
  readonly repositories: ReadonlyMap<string, string>;
}

/** The tiers a group repo's `main` may offer, in the order they are added. */
export const TIERS_ON_MAIN: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];

/** One release of the group: its tag, and its row once the broker's verdict on it is read. */
export interface GroupFlowRelease {
  readonly tag: string;
  /** Never "not judged yet" before the verdict is read: until then it is the read's own state. */
  readonly row: Shown<FlowReleaseRow>;
}

/** One pull request of the group that landed. */
export interface GroupFlowLanding {
  readonly repository: string;
  readonly pull: GiteaPullRequest;
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
  /** Each repository's recent landings, newest first. */
  readonly merged: ReadonlyMap<string, Shown<ReadonlyArray<GiteaPullRequest>>>;
  /** The group repo's tags. */
  readonly tags: Shown<ReadonlyArray<GiteaTag>>;
  /** The tiers on the group repo's `main` ({@link tiersOnMain}). */
  readonly tiers: Shown<TiersOnMain>;
  /** The sha each repository's `main` holds, by repository. */
  readonly mainHeads: ReadonlyMap<string, Shown<string>>;
  /** Each commit's statuses the flow reads ({@link groupFlowStatusReads}), by {@link statusKey}. */
  readonly statuses: ReadonlyMap<string, Shown<ReadonlyArray<GiteaCommitStatus>>>;
  /** What each release content read answered, by {@link releaseContentKey}. */
  readonly contents: ReadonlyMap<string, Shown<ReadonlyArray<GiteaCommit>>>;
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
  /** Every repository's open pull requests, in the org's order. */
  readonly pullRequests: Shown<ReadonlyArray<GroupFlowPullRequest>>;
  /** Every repository's recent landings, in the org's order: what a conversation's timeline places. */
  readonly merged: Shown<ReadonlyArray<GroupFlowLanding>>;
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

/** One commit whose statuses the flow reads. */
export interface StatusRead {
  readonly repository: string;
  readonly sha: string;
}

/** A commit's statuses' key in {@link GroupFlowInputs.statuses}. */
export const statusKey = (repository: string, sha: string): string => `${repository}@${sha}`;

/** A pull request's key in {@link GroupFlowInputs.pulls}. */
export const pullKey = (repository: string, number: number): string =>
  `${repository}#${String(number)}`;

const UNREAD: Known<never> = { state: "unread", waitingFor: null };

/** `appdev` from `https://gitea…/harbor/appdev` or `…/appdev.git`. */
function repositoryName(cloneUrl: string): string | undefined {
  const last = cloneUrl.replace(/\/+$/u, "").split("/").at(-1);
  if (last === undefined || last.length === 0) return undefined;
  return last.endsWith(".git") ? last.slice(0, -".git".length) : last;
}

/**
 * The tiers on the group repo's `main`, from each tier's `import.yaml` there (`null` where `main`
 * holds none): known once every tier's file is. A later tier names a hostname's repository over
 * an earlier one.
 */
export function tiersOnMain(
  files: ReadonlyMap<GroupEnvironmentTier, Shown<string | null>>,
): Shown<TiersOnMain> {
  const parts = TIERS_ON_MAIN.map((tier) => ({
    shown: files.get(tier) ?? UNREAD,
    source: "gitea" as const,
  }));
  return withValue(combine(parts).shown, () => {
    const tiers: Array<GroupEnvironmentTier> = [];
    const repositories = new Map<string, string>();
    for (const tier of TIERS_ON_MAIN) {
      const file = files.get(tier);
      if (file?.state !== "known" || file.value === null) continue;
      tiers.push(tier);
      for (const [hostname, source] of Object.entries(importReadyTier(file.value)?.sources ?? {})) {
        const name = repositoryName(source.repository);
        if (name !== undefined) repositories.set(hostname, name);
      }
    }
    return { tiers, repositories };
  });
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

function mergedOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<GroupFlowLanding>> {
  const repos = inputs.repos;
  if (!isKnown(repos)) return repos as Shown<never>;
  const parts: Array<Part> = [{ shown: repos, source: "gitea" }];
  const landings: Array<GroupFlowLanding> = [];
  for (const repository of repos.value) {
    const merged = inputs.merged.get(repository) ?? UNREAD;
    parts.push({ shown: merged, source: "gitea" });
    if (!isKnown(merged)) continue;
    for (const pull of merged.value) landings.push({ repository, pull });
  }
  return withValue(combine(parts).shown, () => landings);
}

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

/** The version a service's row names: what it runs, or what it builds while a build runs. */
function rowVersionOf(deployment: Deployment): DeployedVersion | undefined {
  return deployment.kind === "none" ? undefined : deployment.version;
}

/**
 * The name a version was read from, as `environmentRow` reads one back (`deployedVersion`): the
 * sha, then the name and who tagged it; a hand-made name whole.
 */
function versionName(version: DeployedVersion): string | undefined {
  if (version.sha === undefined) return version.name;
  return [version.sha, version.name, version.taggedBy]
    .filter((token) => token !== undefined)
    .join(" ");
}

/**
 * Each service a declared stop runs whose build status is read: the version it runs or builds,
 * at the repository its tier on `main` builds it from.
 */
function declaredVersions(
  inputs: GroupFlowInputs,
): ReadonlyArray<{ readonly repository: string; readonly sha: string }> {
  const { declarations, members, tiers } = inputs;
  if (!isKnown(declarations) || !isKnown(members) || !isKnown(tiers)) return [];
  const versions: Array<{ readonly repository: string; readonly sha: string }> = [];
  for (const { project } of declarations.value) {
    if (!members.value.some(({ projectId }) => projectId === project)) continue;
    const services = inputs.stops.get(project);
    if (services === undefined || !isKnown(services)) continue;
    for (const { hostname, deployment } of services.value) {
      if (!isKnown(deployment)) continue;
      const sha = rowVersionOf(deployment.value)?.sha;
      const repository = tiers.value.repositories.get(hostname);
      if (sha !== undefined && repository !== undefined) versions.push({ repository, sha });
    }
  }
  return versions;
}

/**
 * A declared stop's environment row (`environmentRow`'s input): each service's version and the
 * statuses on its commit, where the tier names its repository. Known once the services, what
 * each runs, the tiers on `main` and every status read are.
 */
function environmentOf(
  inputs: GroupFlowInputs,
  declaration: GroupEnvironment,
  name: string,
  services: Shown<ReadonlyArray<StopService>>,
): Shown<GroupEnvironmentRowInput> {
  const { tiers } = inputs;
  const parts: Array<Part> = [
    { shown: services, source: "zerops" },
    { shown: tiers, source: "gitea" },
  ];
  if (!isKnown(services) || !isKnown(tiers)) return combine(parts).shown as Shown<never>;
  const states: Array<EnvironmentServiceState> = [];
  for (const { hostname, deployment } of services.value) {
    parts.push({ shown: deployment, source: "zerops" });
    if (!isKnown(deployment)) continue;
    const version = rowVersionOf(deployment.value);
    const repository = tiers.value.repositories.get(hostname);
    const appVersionName = version === undefined ? undefined : versionName(version);
    let statuses: ReadonlyArray<GiteaCommitStatus> | undefined;
    if (version?.sha !== undefined && repository !== undefined) {
      const read = inputs.statuses.get(statusKey(repository, version.sha)) ?? UNREAD;
      parts.push({ shown: read, source: "gitea" });
      if (isKnown(read)) statuses = read.value;
    }
    states.push({
      hostname,
      ...(repository === undefined ? {} : { repository }),
      ...(appVersionName === undefined ? {} : { appVersionName }),
      ...(statuses === undefined ? {} : { statuses }),
    });
  }
  return withValue(combine(parts).shown, () => ({
    projectId: declaration.project,
    name,
    tier: declaration.tier,
    sources: declaration.sources,
    environment: declaration.name,
    services: states,
  }));
}

function stopsOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<StopRow>> {
  const { declarations, members } = inputs;
  const combined = combine([
    { shown: declarations, source: "gitea" },
    { shown: members, source: "zerops" },
  ]);
  if (!isKnown(declarations) || !isKnown(members)) return combined.shown as Shown<never>;
  const row = (projectId: string, name: string, declaration: GroupEnvironment | null): StopRow => {
    const services = inputs.stops.get(projectId) ?? UNREAD;
    return {
      projectId,
      name,
      tier: declaration?.tier ?? null,
      standing: declaration === null ? "not-declared" : "declared",
      services,
      deployment: stopDeploymentOf(services),
      environment: declaration === null ? null : environmentOf(inputs, declaration, name, services),
    };
  };
  const memberNames = new Map(members.value.map(({ projectId, name }) => [projectId, name]));
  const declared = new Set(declarations.value.map(({ project }) => project));
  return withValue(combined.shown, () => [
    ...declarations.value.map((declaration): StopRow => {
      const { project, name, tier } = declaration;
      const memberName = memberNames.get(project);
      return memberName === undefined
        ? {
            projectId: project,
            name,
            tier,
            standing: "missing-project",
            deployment: null,
            services: null,
            environment: null,
          }
        : row(project, memberName, declaration);
    }),
    // Filtered into a fresh array, so the sort touches nothing else (`toSorted` is not in Hermes).
    ...members.value
      .filter(({ projectId }) => !declared.has(projectId))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map(({ projectId, name }) => row(projectId, name, null)),
  ]);
}

/**
 * The tiers the recipe offers on `main` that no declaration and no member's role fills: a
 * declaration lands minutes after its project is made, and the row that asks must not stand under
 * the environment coming up.
 */
function missingOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<MissingEnvironmentRow>> {
  const { declarations, members, tiers } = inputs;
  const combined = combine([
    { shown: tiers, source: "gitea" },
    { shown: declarations, source: "gitea" },
    { shown: members, source: "zerops" },
  ]);
  if (!isKnown(tiers) || !isKnown(declarations) || !isKnown(members)) {
    return combined.shown as Shown<never>;
  }
  return withValue(combined.shown, () =>
    missingEnvironmentRows({
      tiersOnMain: tiers.value.tiers,
      declarations: declarations.value,
      filledTiers: members.value.flatMap(({ role }) => {
        const tier = environmentTierForRole(role);
        return tier === undefined ? [] : [tier];
      }),
    }),
  );
}

function byVersionDescending(left: GiteaTag, right: GiteaTag): number {
  const a = readSemver(left.name);
  const b = readSemver(right.name);
  if (a === undefined || b === undefined) return 0;
  return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
}

/**
 * How many of the newest releases the flow lists, and so reads the broker's verdict on (D5): one
 * read per release tag ever made grows with the group's age.
 */
export const RELEASES_SHOWN = 10;

/** The group repo's newest {@link RELEASES_SHOWN} release tags, newest version first. */
const releaseTagsOf = (tags: ReadonlyArray<GiteaTag>): ReadonlyArray<GiteaTag> =>
  // Filtered into a fresh array, so the sort touches nothing else.
  tags
    .filter(({ name }) => isReleaseTag(name))
    .sort(byVersionDescending)
    .slice(0, RELEASES_SHOWN);

/**
 * The commits whose statuses the flow reads, as far as what is known names them: each version a
 * declared stop runs, where the broker writes how its deploy went, and each listed release tag's,
 * where it writes its verdict on the release.
 */
export function groupFlowStatusReads(inputs: GroupFlowInputs): ReadonlyArray<StatusRead> {
  const reads = new Map<string, StatusRead>();
  for (const read of declaredVersions(inputs)) {
    reads.set(statusKey(read.repository, read.sha), read);
  }
  if (isKnown(inputs.tags)) {
    for (const { commit } of releaseTagsOf(inputs.tags.value)) {
      if (commit?.sha === undefined) continue;
      reads.set(statusKey(GROUP_REPOSITORY, commit.sha), {
        repository: GROUP_REPOSITORY,
        sha: commit.sha,
      });
    }
  }
  return [...reads.values()];
}

/**
 * The group's releases, newest first: known once the tags are. Each row is known once the
 * broker's verdict on its commit is; a verdict not read yet holds its own row, never the others,
 * and is never "not judged yet".
 */
function releasesOf(inputs: GroupFlowInputs): Shown<ReadonlyArray<GroupFlowRelease>> {
  const { tags } = inputs;
  if (!isKnown(tags)) return tags as Shown<never>;
  return {
    ...tags,
    value: releaseTagsOf(tags.value).map((tag, index): GroupFlowRelease => {
      const sha = tag.commit?.sha;
      // A tag naming no commit has nothing the broker could have judged.
      const statuses: Shown<ReadonlyArray<GiteaCommitStatus>> =
        sha === undefined
          ? { ...tags, value: [] }
          : (inputs.statuses.get(statusKey(GROUP_REPOSITORY, sha)) ?? UNREAD);
      const combined = combine([
        { shown: tags, source: "gitea" },
        { shown: statuses, source: "gitea" },
      ]).shown;
      return {
        tag: tag.name,
        row: withValue(combined, () => {
          const { verdict, detail } = releaseVerdict(
            tag.name,
            isKnown(statuses) ? statuses.value : [],
          );
          const release: FlowRelease = {
            tag: tag.name,
            verdict,
            detail: verdict === "refused" ? detail : undefined,
            line: readReleaseMessage(tag.message ?? "")
              .map((entry) => `${entry.service} ${shortCommit(entry.commit)}`)
              .join(" · "),
          };
          return releaseRow(release, index);
        }),
      };
    }),
  };
}

/**
 * The version a service runs now, a build of it running or not; `null` while it runs none, and
 * `undefined` while a build runs and nothing states or names what ran before it.
 */
function runningOf(
  deployment: Deployment,
): Extract<Deployment, { readonly kind: "running" }> | null | undefined {
  if (deployment.kind !== "deploying") return deployment.kind === "running" ? deployment : null;
  const { previous } = deployment;
  // Mid-build the service names the version it builds (A14): what ran with no name is unstated.
  if (previous === null || (previous.kind === "running" && previous.version.label === undefined)) {
    return undefined;
  }
  return previous.kind === "running" ? previous : null;
}

/** What a release is measured from, and per production service what runs and what would. */
interface ReleaseSides {
  readonly parts: ReadonlyArray<Part>;
  /** The commit each production service runs, by hostname. */
  readonly production: ReadonlyMap<string, string>;
  /** The commit `main` of each production service's repository holds, by hostname. */
  readonly candidate: ReadonlyMap<string, string>;
  /** Each service with a candidate's repository, by hostname. */
  readonly repositories: ReadonlyMap<string, string>;
  /** The services whose running version nothing states yet. */
  readonly unstated: ReadonlySet<string>;
}

/**
 * The declarations name the production, each of its services runs a commit, and `main` of the
 * repository its tier builds it from holds the candidate.
 */
function releaseSides(inputs: GroupFlowInputs): ReleaseSides {
  const { declarations, members, tags, tiers } = inputs;
  const parts: Array<Part> = [
    { shown: declarations, source: "gitea" },
    { shown: tags, source: "gitea" },
    { shown: tiers, source: "gitea" },
  ];
  if (!isKnown(members)) parts.push({ shown: members, source: "zerops" });
  const production = new Map<string, string>();
  const candidate = new Map<string, string>();
  const repositories = new Map<string, string>();
  const unstated = new Set<string>();
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
      parts.push({ shown: deployment, source: "zerops" });
      // A service no tier builds from a repository, or whose repository has no `main`, has no
      // candidate: it is left out of the release, never a reason to hold the others.
      const repository = isKnown(tiers) ? tiers.value.repositories.get(hostname) : undefined;
      const head = repository === undefined ? null : (inputs.mainHeads.get(repository) ?? UNREAD);
      if (head !== null && head.state !== "gone") parts.push({ shown: head, source: "gitea" });
      // A production mid-deploy is measured against what it runs: its build may yet fail. Until
      // something states that, nothing proves production runs anything older than `main`.
      const runs = isKnown(deployment) ? runningOf(deployment.value) : null;
      if (runs === undefined) {
        parts.push({ shown: UNREAD, source: "zerops" });
        unstated.add(hostname);
      }
      if (runs?.version.sha !== undefined) production.set(hostname, runs.version.sha);
      if (repository !== undefined && head !== null && isKnown(head)) {
        candidate.set(hostname, head.value);
        repositories.set(hostname, repository);
      }
    }
  }
  return { parts, production, candidate, repositories, unstated };
}

/** The release offer, known once everything it is measured from is. */
function releaseOf(
  inputs: GroupFlowInputs,
  capabilities: GroupFlowCapabilities,
): { readonly release: Shown<ReleaseOffer>; readonly source: KnowledgeSource } {
  const { tags } = inputs;
  const { parts, production, candidate } = releaseSides(inputs);
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
 * One service's read of what a release would put live: what `main` of its repository has over
 * the commit production runs, or the head commit itself where production runs nothing yet.
 */
export interface ReleaseContentRead {
  readonly service: string;
  readonly repository: string;
  readonly head: string;
  /** What production runs; `undefined` for a first release. */
  readonly from: string | undefined;
}

/** A release content read's key in {@link GroupFlowInputs.contents}. */
export const releaseContentKey = (
  read: Pick<ReleaseContentRead, "repository" | "from" | "head">,
): string => `${read.repository} ${read.from ?? ""}...${read.head}`;

/**
 * The reads a release's contents take, as far as what is known names them: every production
 * service whose `main` holds a commit it does not run. A service whose running version nothing
 * states yet is not read — nobody knows what it would be compared with.
 */
export function releaseContentReads(inputs: GroupFlowInputs): ReadonlyArray<ReleaseContentRead> {
  const { production, candidate, repositories, unstated } = releaseSides(inputs);
  return planReleaseReads(candidate, production).flatMap(({ service, head, from }) => {
    const repository = repositories.get(service);
    return repository === undefined || unstated.has(service)
      ? []
      : [{ service, repository, head, from }];
  });
}

/**
 * What a release would put live, service by service — with squash merges, one commit per task
 * delivered. Known once the offer is and every read is; a commit Gitea does not have adds nothing.
 */
function releaseContentsOf(
  inputs: GroupFlowInputs,
  release: Shown<ReleaseOffer>,
): Shown<ReadonlyArray<ReleaseContent>> {
  if (!isKnown(release)) return release as Shown<never>;
  const parts: Array<Part> = [{ shown: release, source: "gitea" }];
  const contents: Array<ReleaseContent> = [];
  for (const read of releaseContentReads(inputs)) {
    const shown = inputs.contents.get(releaseContentKey(read)) ?? UNREAD;
    if (shown.state === "gone") continue;
    parts.push({ shown, source: "gitea" });
    if (isKnown(shown) && shown.value.length > 0) {
      contents.push({ service: read.service, commits: shown.value });
    }
  }
  return withValue(combine(parts).shown, () => contents);
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

/**
 * The stage services a merge into each repository's `main` deploys to, by repository: its tier on
 * `main` names where each stage service builds from. Known once every stage's services are.
 */
function feedsOf(
  inputs: GroupFlowInputs,
  stops: Shown<ReadonlyArray<StopRow>>,
): Shown<ReadonlyMap<string, ReadonlyArray<ServiceRef>>> {
  const { declarations, members, tiers } = inputs;
  const parts: Array<Part> = [
    { shown: declarations, source: "gitea" },
    { shown: members, source: "zerops" },
    { shown: tiers, source: "gitea" },
  ];
  const fed = new Map<string, Array<ServiceRef>>();
  if (isKnown(stops) && isKnown(tiers)) {
    for (const { tier, services } of stops.value) {
      // A stage missing its project runs nothing a merge could deploy to.
      if (tier !== "stage" || services === null) continue;
      parts.push({ shown: services, source: "zerops" });
      if (!isKnown(services)) continue;
      for (const { hostname, service } of services.value) {
        const repository = tiers.value.repositories.get(hostname);
        if (repository !== undefined) {
          fed.set(repository, [...(fed.get(repository) ?? []), service]);
        }
      }
    }
  }
  return withValue(combine(parts).shown, () => fed);
}

export function groupFlow(
  inputs: GroupFlowInputs,
  capabilities: GroupFlowCapabilities,
  nowMs: number,
): GroupFlow {
  const stops = stopsOf(inputs);
  const { release, source } = releaseOf(inputs, capabilities);
  const { gate, affordance } = releaseGateOf(release, source, nowMs);
  const fed = feedsOf(inputs, stops);
  return {
    groupId: inputs.entry.groupId,
    slug: inputs.entry.slug,
    pullRequests: pullRequestsOf(inputs),
    merged: mergedOf(inputs),
    stops,
    missing: missingOf(inputs),
    release,
    releaseContents: releaseContentsOf(inputs, release),
    releases: releasesOf(inputs),
    releaseGate: gate,
    releaseAffordance: affordance,
    feeds: (repository) =>
      isKnown(fed) ? { ...fed, value: fed.value.get(repository) ?? [] } : (fed as Shown<never>),
  };
}
