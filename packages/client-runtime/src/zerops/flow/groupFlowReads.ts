/**
 * What one group's flow reads from the account's stores (DESIGN §4.7): the forge facts a view
 * demands for it, and `groupFlow`'s inputs as the forge and the deployment store hold them now.
 *
 * What is demanded grows with what is known: the org's repositories name their open lists, a
 * list names its pull requests' heads, whose checks are read, and the production's services, each
 * through the repository its tier on `main` builds it from (`tiersOnMain`), name the repositories
 * whose `main` a release would carry. A service's repository is never guessed from its hostname.
 * A group read without a forge — before the Gitea is known, or on a host with none — waits for the
 * Gitea session.
 *
 * @module flow/groupFlowReads
 */
import type { ProjectRef } from "../data/types.ts";
import type { ForgeFact, ForgeStore } from "../forge/forgeStore.ts";
import type { GiteaCommit, GiteaCommitStatus, GiteaPullRequest } from "../giteaClient.ts";
import type { GroupEnvironmentTier } from "../groupEnvironments.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { Shown } from "../knowledge/known.ts";
import { GROUP_REPOSITORY } from "../release.ts";
import { RECIPE_TIER_PATHS } from "../recipeTier.ts";
import type { StopService } from "./deployment.ts";
import type { DeploymentStore } from "./deploymentStore.ts";
import {
  groupFlowStatusReads,
  pullKey,
  releaseContentKey,
  releaseContentReads,
  statusKey,
  tiersOnMain,
  TIERS_ON_MAIN,
  type GroupFlowInputs,
  type GroupFlowMember,
  type GroupFlowPull,
  type ReleaseContentRead,
  type TiersOnMain,
} from "./groupFlow.ts";

export interface GroupFlowStores {
  /** `null` on a host that gave the forge no ports. */
  readonly forge: ForgeStore | null;
  readonly deployments: DeploymentStore;
}

/** What one group's flow is read from, beside the stores. */
export interface GroupFlowSource {
  readonly entry: ZeropsRegistryGroup;
  /** The account's Gitea for the group's organization. */
  readonly giteaOrigin: string | undefined;
  /** The Zerops projects the tags make members of the group. */
  readonly members: Shown<ReadonlyArray<GroupFlowMember & { readonly project: ProjectRef }>>;
}

const UNREAD: Shown<never> = { state: "unread", waitingFor: null };
const WAITING_FOR_GITEA: Shown<never> = { state: "unread", waitingFor: "gitea-session" };
/** Nothing is read before the epoch's first grant built the stores. */
const UNBOUND: Shown<never> = { state: "unread", waitingFor: "access-grant" };

/** Each tier's `import.yaml` on the group repo's `main`, as a forge fact. */
const tierFile = (origin: string, slug: string, tier: GroupEnvironmentTier): ForgeFact => ({
  kind: "file",
  origin,
  owner: slug,
  repo: GROUP_REPOSITORY,
  path: RECIPE_TIER_PATHS[tier],
});

/** The tiers on the group repo's `main`, as the forge holds their files. */
function readTiers(forge: ForgeStore, origin: string, slug: string): Shown<TiersOnMain> {
  return tiersOnMain(
    new Map(
      TIERS_ON_MAIN.map((tier) => [
        tier,
        forge.read(tierFile(origin, slug, tier)) as Shown<string | null>,
      ]),
    ),
  );
}

/**
 * The repositories the production stops' services build from, as the deployment store holds the
 * services and the tiers on `main` name their repositories; none before both are known.
 */
function productionRepositories(
  forge: ForgeStore,
  origin: string,
  deployments: DeploymentStore,
  source: GroupFlowSource,
): ReadonlyArray<string> {
  const declarations = forge.read({
    kind: "declarations",
    origin,
    owner: source.entry.slug,
    repo: GROUP_REPOSITORY,
  });
  const tiers = readTiers(forge, origin, source.entry.slug);
  const repositories = new Set<string>();
  if (
    declarations.state !== "known" ||
    source.members.state !== "known" ||
    tiers.state !== "known"
  ) {
    return [...repositories];
  }
  for (const declaration of declarations.value) {
    if (declaration.tier !== "production") continue;
    const member = source.members.value.find(({ projectId }) => projectId === declaration.project);
    if (member === undefined) continue;
    const stop = deployments.stop(member.project);
    if (stop.state !== "known") continue;
    for (const { hostname } of stop.value) {
      const repository = tiers.value.repositories.get(hostname);
      if (repository !== undefined) repositories.add(repository);
    }
  }
  return [...repositories].sort();
}

/**
 * The forge fact a release content read is: a comparison with what production runs, or for a
 * first release the head commit itself.
 */
function contentFact(origin: string, slug: string, read: ReleaseContentRead): ForgeFact {
  const repository = { origin, owner: slug, repo: read.repository };
  return read.from === undefined
    ? { kind: "commit", ...repository, sha: read.head }
    : { kind: "compare", ...repository, base: read.from, head: read.head };
}

/** What a release content read answered, as the commits it names. */
function contentOf(
  forge: ForgeStore,
  origin: string,
  slug: string,
  read: ReleaseContentRead,
): Shown<ReadonlyArray<GiteaCommit>> {
  const repository = { origin, owner: slug, repo: read.repository };
  if (read.from !== undefined) {
    return forge.read({ kind: "compare", ...repository, base: read.from, head: read.head });
  }
  const detail = forge.read({ kind: "commit", ...repository, sha: read.head });
  return detail.state === "known"
    ? { ...detail, value: [{ sha: detail.value.sha, subject: detail.value.subject }] }
    : detail;
}

/** The stops a group's flow demands of the deployment store: its members' projects. */
export function groupFlowStops(source: GroupFlowSource): ReadonlyArray<ProjectRef> {
  const projects: Array<ProjectRef> = [];
  if (source.members.state !== "known") return projects;
  for (const { project } of source.members.value) projects.push(project);
  return projects;
}

/** Every forge fact the group's flow reads, as far as what is known so far names them. */
export function groupFlowFacts(
  stores: GroupFlowStores,
  source: GroupFlowSource,
): ReadonlyArray<ForgeFact> {
  const { forge } = stores;
  const origin = source.giteaOrigin;
  const facts: Array<ForgeFact> = [];
  if (forge === null || origin === undefined) return facts;
  const repository = (repo: string) => ({ origin, owner: source.entry.slug, repo });
  facts.push(
    { kind: "repos", origin, org: source.entry.slug },
    { kind: "declarations", ...repository(GROUP_REPOSITORY) },
    { kind: "tags", ...repository(GROUP_REPOSITORY) },
    ...TIERS_ON_MAIN.map((tier) => tierFile(origin, source.entry.slug, tier)),
  );
  for (const name of productionRepositories(forge, origin, stores.deployments, source)) {
    facts.push({ kind: "branch", ...repository(name), branch: "main" });
  }
  const repos = forge.read({ kind: "repos", origin, org: source.entry.slug });
  if (repos.state !== "known") return facts;
  for (const { name } of repos.value) {
    facts.push(
      { kind: "open-pulls", ...repository(name) },
      { kind: "merged-pulls", ...repository(name) },
    );
    const open = forge.read({ kind: "open-pulls", ...repository(name) });
    if (open.state !== "known") continue;
    for (const number of open.value) {
      const pull = forge.read({ kind: "pull", ...repository(name), number });
      if (pull.state !== "known" || pull.value.pull.head?.sha === undefined) continue;
      facts.push({ kind: "statuses", ...repository(name), sha: pull.value.pull.head.sha });
    }
  }
  const inputs = groupFlowInputs(stores, source);
  for (const { repository: repo, sha } of groupFlowStatusReads(inputs)) {
    facts.push({ kind: "statuses", ...repository(repo), sha });
  }
  for (const read of releaseContentReads(inputs)) {
    facts.push(contentFact(origin, source.entry.slug, read));
  }
  return facts;
}

/** The group's flow inputs as the stores hold them now. */
export function groupFlowInputs(stores: GroupFlowStores, source: GroupFlowSource): GroupFlowInputs {
  const { forge, deployments } = stores;
  const origin = source.giteaOrigin;
  const slug = source.entry.slug;
  const repository = (repo: string) => ({ origin: origin ?? "", owner: slug, repo });
  const read = <F extends ForgeFact>(fact: F) =>
    forge === null || origin === undefined ? WAITING_FOR_GITEA : forge.read(fact);

  const repos = read({ kind: "repos", origin: origin ?? "", org: slug });
  const openPulls = new Map<string, Shown<ReadonlyArray<number>>>();
  const pulls = new Map<string, Shown<GroupFlowPull>>();
  const merged = new Map<string, Shown<ReadonlyArray<GiteaPullRequest>>>();
  let repoNames: Shown<ReadonlyArray<string>> = repos as Shown<never>;
  if (repos.state === "known") {
    repoNames = { ...repos, value: repos.value.map(({ name }) => name) };
    for (const { name } of repos.value) {
      merged.set(name, read({ kind: "merged-pulls", ...repository(name) }));
      const open = read({ kind: "open-pulls", ...repository(name) });
      openPulls.set(name, open);
      if (open.state !== "known") continue;
      for (const number of open.value) {
        const key = { ...repository(name), number };
        const pull = read({ kind: "pull", ...key });
        // The MergeState is a projection over the same pull request entry: known together.
        const state = forge === null ? UNREAD : forge.mergeState(key);
        pulls.set(
          pullKey(name, number),
          pull.state === "known" && state.state === "known"
            ? { ...state, value: { pull: pull.value.pull, state: state.value } }
            : (state as Shown<never>),
        );
      }
    }
  }

  const stops = new Map<string, Shown<ReadonlyArray<StopService>>>();
  if (source.members.state === "known") {
    for (const member of source.members.value) {
      stops.set(member.projectId, deployments.stop(member.project));
    }
  }

  const mainHeads = new Map<string, Shown<string>>();
  if (forge !== null && origin !== undefined) {
    for (const name of productionRepositories(forge, origin, deployments, source)) {
      mainHeads.set(name, read({ kind: "branch", ...repository(name), branch: "main" }));
    }
  }

  const inputs: GroupFlowInputs = {
    entry: source.entry,
    members: source.members,
    declarations: read({ kind: "declarations", ...repository(GROUP_REPOSITORY) }),
    repos: repoNames,
    openPulls,
    pulls,
    merged,
    tags: read({ kind: "tags", ...repository(GROUP_REPOSITORY) }),
    tiers:
      forge === null || origin === undefined ? WAITING_FOR_GITEA : readTiers(forge, origin, slug),
    mainHeads,
    statuses: new Map(),
    contents: new Map(),
    stops,
  };
  if (forge === null || origin === undefined) return inputs;
  // Which commits' statuses and what the release carries are named by what the rest answered.
  const statuses = new Map<string, Shown<ReadonlyArray<GiteaCommitStatus>>>();
  for (const { repository: repo, sha } of groupFlowStatusReads(inputs)) {
    statuses.set(statusKey(repo, sha), read({ kind: "statuses", ...repository(repo), sha }));
  }
  const contents = new Map<string, Shown<ReadonlyArray<GiteaCommit>>>();
  for (const content of releaseContentReads(inputs)) {
    contents.set(releaseContentKey(content), contentOf(forge, origin, slug, content));
  }
  return { ...inputs, statuses, contents };
}

/** A group's flow inputs before the epoch's first grant built the stores: nothing is read yet. */
export function unboundGroupFlowInputs(
  source: Pick<GroupFlowSource, "entry" | "members">,
): GroupFlowInputs {
  return {
    entry: source.entry,
    members: source.members,
    declarations: UNBOUND,
    repos: UNBOUND,
    openPulls: new Map(),
    pulls: new Map(),
    merged: new Map(),
    tags: UNBOUND,
    tiers: UNBOUND,
    mainHeads: new Map(),
    statuses: new Map(),
    contents: new Map(),
    stops: new Map(),
  };
}
