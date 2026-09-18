/**
 * What a group's environments are running — planned, then assembled (guide
 * 4.4, 5.3).
 *
 * The projects screen shows each stage and the production with the branch it
 * follows and the commit it actually runs. Three parties hold those three
 * facts and none of them can be asked for another's:
 *
 * - **`environments.yaml` on the group repo** says which environments exist,
 *   which Zerops project each one is, and what feeds it. Read as the person,
 *   from Gitea (`groupEnvironments.ts`).
 * - **Zerops** says what is deployed, as the first token of the service's
 *   `appVersionName` (`docs/group-repo.md`; measured 2026-09-16 — the version
 *   list carries no name at all, the service's `userData` does).
 * - **Gitea's commit statuses** say how that deploy went, under the context
 *   the broker writes: `mate/deploy/{environment}/{service}` on the service
 *   repository's commit.
 *
 * So the reads are planned from what the declarations name, not from what a
 * project happens to hold: a service in a stage that no environment declares
 * is nobody's business here, and a status read needs a commit, which only the
 * version read produces. That ordering is the whole module — plan the version
 * reads, plan the status reads from their answers, then assemble the rows.
 *
 * ## A missing answer is a quieter row, never a different one
 *
 * Every environment that is declared gets a row whatever came back. Not signed
 * in to Gitea: no statuses, so the row carries the branch and the commit and no
 * dot with a word beside it. Nothing deployed yet: the branch alone. The row's
 * shape does not depend on which reads landed, which is what keeps the screen
 * from moving under the person as they arrive (`environmentRow`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupDeploys
 */

import type { GiteaCommitStatus } from "./giteaClient.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";
import {
  deployedCommit,
  environmentRow,
  type EnvironmentServiceState,
  type GroupRowTone,
} from "./groupRows.ts";

/** One runtime service of one Zerops project, as the reads need it. */
export interface GroupEnvironmentService {
  readonly projectId: string;
  readonly serviceId: string;
  /** Its hostname in the environment — `app` for a pair's promoted runtime. */
  readonly hostname: string;
}

/** A service whose deployed version name has to be read from Zerops. */
export type DeployedVersionRead = GroupEnvironmentService;

/**
 * Which services to ask Zerops about: the ones in a project some environment
 * declares, and no others.
 *
 * A Mate's own dev pair sits in the same account and is not here: it deploys
 * nothing the group declared, and reading its versions would cost a request
 * per service for a row that never shows them.
 */
export function planDeployedVersionReads(input: {
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly services: ReadonlyArray<GroupEnvironmentService>;
}): ReadonlyArray<DeployedVersionRead> {
  const projects = new Set(input.declarations.map((entry) => entry.project));
  return input.services.filter((service) => projects.has(service.projectId));
}

/** One `GET /repos/{owner}/{repo}/commits/{sha}/statuses`. */
export interface DeployStatusRead {
  /** The group's Gitea org. */
  readonly owner: string;
  /** The service's hostname in its environment — what the row is keyed by. */
  readonly hostname: string;
  /**
   * The repository the read goes to: the one the tier's `buildFromGit` names
   * (`appdev` for the promoted runtime `app` — a pair's repository is named
   * after its dev half), the hostname when the tier does not say. Reading the
   * hostname's answered `404` for every stage and production of the owner's
   * run (2026-09-17), and the rows showed no deploy at all.
   */
  readonly repo: string;
  readonly sha: string;
}

/** The key a planned status read is answered under: the hostname's, not the repository's. */
export function deployStatusKey(
  read: Pick<DeployStatusRead, "owner" | "hostname" | "sha">,
): string {
  return `${read.owner}/${read.hostname}@${read.sha}`;
}

/**
 * Which commits to ask Gitea about, from the version names that came back.
 *
 * Only a full sha is asked about: a version somebody deployed by hand is named
 * whatever they typed, and `{repo}/commits/not-a-sha/statuses` is a request
 * that can only answer `404`. Deduplicated, because a stage and a production
 * running the same commit of the same service is the normal state of a group
 * between releases and the answer is the same one.
 */
export function planDeployStatusReads(input: {
  readonly owner: string;
  readonly versions: ReadonlyArray<{
    readonly hostname: string;
    readonly appVersionName?: string | undefined;
    /** The repository's name in the org, from the tier's `buildFromGit`. */
    readonly repository?: string | undefined;
  }>;
}): ReadonlyArray<DeployStatusRead> {
  const seen = new Set<string>();
  const reads: Array<DeployStatusRead> = [];
  for (const version of input.versions) {
    const sha = deployedCommit(version.appVersionName);
    if (sha === undefined) continue;
    const read = {
      owner: input.owner,
      hostname: version.hostname,
      repo: version.repository ?? version.hostname,
      sha,
    };
    const key = deployStatusKey(read);
    if (seen.has(key)) continue;
    seen.add(key);
    reads.push(read);
  }
  return reads;
}

/** One default-branch read: the repository a production's service is built from. */
export interface MainHeadRead {
  /** The service's hostname in the production — what a release's entry is keyed by. */
  readonly hostname: string;
  readonly repo: string;
}

/**
 * Which repositories' default branches a release has to read (D28, `release.ts`).
 *
 * A release lists what is merged, whether or not the group has a stage, so
 * every service the production runs is asked for — at the repository its
 * tier's `buildFromGit` names, the hostname when the tier does not say
 * (`DeployStatusRead.repo`). A group with no production declared has nothing
 * to release and is asked nothing.
 */
export function planMainHeadReads(input: {
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly services: ReadonlyArray<GroupEnvironmentService>;
  /** The repository's name in the org by hostname, from the tiers on `main`. */
  readonly repositories: ReadonlyMap<string, string>;
}): ReadonlyArray<MainHeadRead> {
  const productions = new Set(
    input.declarations.filter((entry) => entry.tier === "production").map((entry) => entry.project),
  );
  const reads = new Map<string, MainHeadRead>();
  for (const service of input.services) {
    if (!productions.has(service.projectId) || reads.has(service.hostname)) continue;
    reads.set(service.hostname, {
      hostname: service.hostname,
      repo: input.repositories.get(service.hostname) ?? service.hostname,
    });
  }
  return [...reads.values()];
}

/** What one environment's row is built from, before the row itself. */
export interface GroupEnvironmentRowInput {
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironment["tier"];
  readonly sources: GroupEnvironment["sources"];
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly environment: string;
}

/**
 * Every declared environment of one group, in the shape `environmentRow` takes.
 *
 * Named by the Zerops project when the account can see it, and by the entry in
 * `environments.yaml` when it cannot: an environment declared in a project this
 * person may not read is still an environment the group has, and dropping it
 * would make the page disagree with the file the broker deploys from.
 */
export function buildGroupEnvironmentRowInputs(input: {
  readonly owner: string;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /** What each Zerops project is called, by id. */
  readonly projectNames: ReadonlyMap<string, string>;
  readonly services: ReadonlyArray<GroupEnvironmentService>;
  /** The version name each service runs, by service id. */
  readonly versions: ReadonlyMap<string, string>;
  /** Every commit status read, by {@link deployStatusKey}. */
  readonly statuses: ReadonlyMap<string, ReadonlyArray<GiteaCommitStatus>>;
}): ReadonlyArray<GroupEnvironmentRowInput> {
  return input.declarations.map((declaration) => ({
    projectId: declaration.project,
    name: input.projectNames.get(declaration.project) ?? declaration.name,
    tier: declaration.tier,
    sources: declaration.sources,
    environment: declaration.name,
    services: input.services
      .filter((service) => service.projectId === declaration.project)
      .map((service): EnvironmentServiceState => {
        const appVersionName = input.versions.get(service.serviceId);
        const sha = deployedCommit(appVersionName);
        const statuses =
          sha === undefined
            ? undefined
            : input.statuses.get(
                deployStatusKey({ owner: input.owner, hostname: service.hostname, sha }),
              );
        return {
          hostname: service.hostname,
          ...(appVersionName === undefined ? {} : { appVersionName }),
          ...(statuses === undefined ? {} : { statuses }),
        };
      }),
  }));
}

/**
 * The rows themselves, in the file's order — `buildGroupRows` is what puts the
 * stages before the production, because it is what holds the whole list.
 */
export function buildGroupEnvironmentRows(
  input: Parameters<typeof buildGroupEnvironmentRowInputs>[0],
): ReadonlyArray<ReturnType<typeof environmentRow>> {
  return buildGroupEnvironmentRowInputs(input).map((entry) => environmentRow(entry));
}

/** `{service hostname: full sha}` per side of a release. */
export interface ReleaseDeploys {
  /** What the stage runs. Several stages: the first the file declares (D16). */
  readonly stage: ReadonlyMap<string, string>;
  /** What production runs, read the same way and never from a release tag. */
  readonly production: ReadonlyMap<string, string>;
}

/**
 * What *Release* compares, from the same snapshot the rows are built from.
 *
 * Both sides are the sha in a deployed version's name (`deployedCommit`) and
 * nothing else — not a branch head, which is what *should* be there, and not
 * the newest release tag, which is what the broker was asked to deploy rather
 * than what is running. A service whose name is not a commit has no side: it
 * was deployed by hand, and a tag listing a guess is a tag the broker deploys.
 *
 * With several stages declared (D16) the first one the file declares wins for
 * a service they both run: the file's order is the group's own, and picking by
 * anything else would make the release depend on the order of an account read.
 */
export function releaseDeploys(
  environments: ReadonlyArray<GroupEnvironmentRowInput>,
): ReleaseDeploys {
  const stage = new Map<string, string>();
  const production = new Map<string, string>();
  for (const environment of environments) {
    const side = environment.tier === "production" ? production : stage;
    for (const service of environment.services) {
      const sha = deployedCommit(service.appVersionName);
      if (sha === undefined || side.has(service.hostname)) continue;
      side.set(service.hostname, sha);
    }
  }
  return { stage, production };
}

/**
 * The one word beside a deploy's dot — never a sentence, never "configured"
 * (design system R5).
 *
 * `undefined` for a neutral environment: nothing has been deployed there, or
 * nobody signed in to Gitea to be told how it went, and a word invented for
 * either would be the screen guessing.
 */
export function deployWord(tone: GroupRowTone): string | undefined {
  switch (tone) {
    case "good":
      return "Deployed";
    case "pending":
      return "Deploying";
    case "bad":
      return "Failed";
    case "neutral":
      return undefined;
  }
}
