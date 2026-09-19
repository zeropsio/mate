/**
 * What a group shows on the projects screen — one row model for all three
 * kinds of thing in it (guide 4.4, 5.2).
 *
 * A group holds its **Mates** (who you talk to), its **stages and its
 * production** (where the code runs) and the **open pull requests** on its
 * group repo (changes to what those environments are made of). Each is a
 * different question, so each gets its own row kind — but one module decides
 * every one of them, because the three sit in one list and a second opinion
 * about the same fact is what rule R5 exists to prevent.
 *
 * ## One line, and the face carries the state
 *
 * A row says one thing under its name, and only when it adds something. A Mate
 * the person opens says nothing: its face and its last message already say
 * where it is. A Mate they cannot open says whose it is. A stage says the
 * branch and the commit it actually runs. No row carries the word "deployed",
 * "running" or "ok" — that is what {@link GroupRowTone} is for, and what a
 * `StatusDot` renders.
 *
 * ## Every fact from the party that can prove it
 *
 * The sha comes from the service's **app-version name**, whose first token is
 * the commit the broker built from (`docs/group-repo.md`, measured
 * 2026-09-16) — never from the branch head, which says what *should* be there.
 * The deploy outcome comes from the commit status the broker wrote,
 * `mate/deploy/{environment}/{service}` — never from the version's existence.
 * Whether a group's Gitea is ready comes from `GET /orgs/{slug}` answering as
 * the person, never from the registry tag that asked for it
 * (`groupCreation.ts`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupRows
 */

import type { GiteaCommitStatus, GiteaPullRequest } from "./giteaClient.ts";
import {
  mateAwaitingRegistryLine,
  type GroupGiteaState,
  type MateRegistration,
} from "./groupCreation.ts";
import type { GroupEnvironmentTier, GroupEnvironment } from "./groupEnvironments.ts";
import { mateOnlyOwnerOpensIt, type MateOwnerCandidate } from "./mateAccess.ts";
import type { RoleMateVisibility } from "@t3tools/shared/zeropsRoles";

/** What a row's dot says, for the four things a dot can honestly mean. */
export type GroupRowTone = "neutral" | "pending" | "good" | "bad";

export interface MateRow {
  readonly kind: "mate";
  readonly projectId: string;
  readonly name: string;
  readonly visibility: RoleMateVisibility;
  /** Empty when the row has nothing to add — the usual case for one you open. */
  readonly line: string;
  readonly tone: GroupRowTone;
}

export interface EnvironmentRow {
  readonly kind: "environment";
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  /** The branch it follows, or `release` for a production. */
  readonly source: string;
  /** The commit it actually runs, short — `undefined` until something is deployed. */
  readonly commit: string | undefined;
  /** What that deploy is called, the commit being only the fallback. */
  readonly version: DeployedVersion;
  /**
   * The repository the named version was built from, as the tier's
   * `buildFromGit` names it — never guessed from the hostname, because an
   * address built on a guess is a link that 404s.
   */
  readonly versionRepository: string | undefined;
  readonly line: string;
  readonly tone: GroupRowTone;
}

export interface PullRequestRow {
  readonly kind: "pull-request";
  readonly number: number;
  readonly title: string;
  readonly line: string;
  readonly tone: GroupRowTone;
}

/**
 * A tier the group's recipe offers and the group does not have yet — the row
 * that asks. Once the recipe is on the group repo's `main`, a stage and a
 * production are the person's next steps, and a group that showed only its
 * Mate never said so (the owner, twice, 2026-09-17: "it never asked me to
 * setup production").
 */
export interface MissingEnvironmentRow {
  readonly kind: "missing-environment";
  readonly tier: GroupEnvironmentTier;
  readonly name: string;
  readonly line: string;
}

export type GroupRow = MateRow | EnvironmentRow | PullRequestRow | MissingEnvironmentRow;

/** What a missing tier's row says. */
export const MISSING_ENVIRONMENT_LINE = "not set up yet";

/**
 * One row per tier the recipe offers on `main` and no declared environment
 * fills, stage before production — the order the person adds them in.
 */
export function missingEnvironmentRows(input: {
  /** The tiers whose import is on the group repo's `main`. */
  readonly tiersOnMain: ReadonlyArray<GroupEnvironmentTier>;
  readonly declarations: ReadonlyArray<Pick<GroupEnvironment, "tier">>;
}): ReadonlyArray<MissingEnvironmentRow> {
  const declared = new Set(input.declarations.map((entry) => entry.tier));
  const offered = new Set(input.tiersOnMain);
  const order: ReadonlyArray<GroupEnvironmentTier> = ["stage", "production"];
  return order
    .filter((tier) => offered.has(tier) && !declared.has(tier))
    .map((tier) => ({
      kind: "missing-environment",
      tier,
      name: tier === "stage" ? "Stage" : "Production",
      line: MISSING_ENVIRONMENT_LINE,
    }));
}

export interface GroupRows {
  readonly groupId: string;
  readonly slug: string;
  /** Empty unless the group's Gitea side is not there yet. */
  readonly line: string;
  readonly rows: ReadonlyArray<GroupRow>;
}

/**
 * The commit an app version was built from: the first token of its name
 * (`docs/group-repo.md`). Production's carries the tag and the tagger after
 * it; the sha is always first.
 *
 * `undefined` for a name that is not one of ours — a version somebody deployed
 * with `zcli` by hand, say. Saying nothing is right: this row's whole job is to
 * name the commit that is running, and a name that is not a sha is not one.
 */
export function deployedCommit(appVersionName: string | undefined): string | undefined {
  const first = appVersionName?.trim().split(/\s+/u)[0];
  return first !== undefined && /^[0-9a-f]{40}$/iu.test(first) ? first.toLowerCase() : undefined;
}

/**
 * An environment's name as a row under its project's own heading says it.
 *
 * A Zerops project carries its group's name — `Links - stage`, `Todo -
 * production` — so under a heading that already reads `Links`, the prefix is
 * the same word twice on two adjacent lines, and the row spends its width
 * saying nothing. Dropped, the row says the one thing that tells it from its
 * neighbour.
 *
 * Only a prefix is dropped, and only when something is left: a name somebody
 * chose that merely contains the group's, or equals it, is theirs and stays
 * whole. The separator may be a dash, an en dash or plain space, because the
 * name is typed by a person and Zerops keeps whatever they typed.
 */
export function environmentNameUnderGroup(
  groupName: string | undefined,
  environmentName: string,
): string {
  const name = environmentName.trim();
  const group = groupName?.trim();
  if (group === undefined || group.length === 0) return name;
  if (!name.toLocaleLowerCase().startsWith(group.toLocaleLowerCase())) return name;
  const rest = name
    .slice(group.length)
    .replace(/^[\s\u2010-\u2015_/:-]+/u, "")
    .trim();
  return rest.length === 0 ? name : rest;
}

/** The seven characters a person reads a commit by. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * What is deployed, as a person talks about it: its name, and the commit
 * underneath.
 *
 * Zerops keeps one string per service — the app version's name — and the two
 * parties that write it write different things. The broker names a stage
 * deploy by the commit alone, and a release by `{sha} {tag} {tagger}`
 * (measured 2026-09-16); somebody deploying with `zcli` by hand names it
 * whatever they typed.
 *
 * The name is what a row writes, and the commit is only its fallback: a
 * release is `v1.2.0` to everyone who talks about it, and `77ab0e1` answers a
 * question nobody asked (the owner, 2026-09-19 — "the commit hash should only
 * be a fallback to version name from Zerops"). The commit stays on the answer
 * either way, because the place that has room for both should say both.
 */
export interface DeployedVersion {
  /** The tag, or the whole of a hand-made name; `undefined` for a bare commit. */
  readonly name: string | undefined;
  /** The commit it was built from, short; `undefined` where the name is not one of ours. */
  readonly commit: string | undefined;
  /** Who tagged the release, where the name carries it. */
  readonly taggedBy: string | undefined;
  /** The one thing a row writes: the name, and the commit only as its fallback. */
  readonly label: string | undefined;
}

/** Nothing is deployed, however the name said so. */
const NO_VERSION: DeployedVersion = {
  name: undefined,
  commit: undefined,
  taggedBy: undefined,
  label: undefined,
};

export function deployedVersion(appVersionName: string | undefined): DeployedVersion {
  const tokens = (appVersionName ?? "")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return NO_VERSION;
  const sha = deployedCommit(appVersionName);
  if (sha === undefined) {
    // Not one of ours: the whole string is the only name it has, and it is a
    // better answer than saying nothing.
    const name = tokens.join(" ");
    return { name, commit: undefined, taggedBy: undefined, label: name };
  }
  const [, name, taggedBy] = tokens;
  const commit = shortCommit(sha);
  return { name, commit, taggedBy, label: name ?? commit };
}

/**
 * Where a deployed version can be read: Gitea's own pages for the commit it
 * was built from.
 *
 * A row can say `v1.4.0` and a menu can say `v1.4.0 · 77ab0e1 · tagged by
 * ada`, and neither answers "what is actually in there" — the owner asked
 * twice (2026-09-19: "still can't click on the commit to show whats in there?
 * like the history etc"). The commit page is that answer for one deploy and
 * the log is that answer for the ones before it, and both already exist:
 * nothing here fetches, builds or guesses, it only addresses what Gitea
 * already serves.
 *
 * `undefined` wherever an address cannot be written honestly — nobody signed
 * in to Gitea, a version whose name is not a commit, a service whose
 * repository the recipe does not name.
 */
export interface DeployedVersionLinks {
  /** The commit itself: its message, its diff, its checks. */
  readonly commit: string;
  /** What came before it — the history, which is the question people ask. */
  readonly history: string;
}

export function deployedVersionLinks(input: {
  /** The Gitea the account is signed in to. */
  readonly origin: string | undefined;
  /** The group's org there. */
  readonly owner: string;
  /** The service's repository in that org, from the tier's `buildFromGit`. */
  readonly repository: string | undefined;
  readonly commit: string | undefined;
}): DeployedVersionLinks | undefined {
  const { origin, owner, repository, commit } = input;
  if (origin === undefined || repository === undefined || commit === undefined) return undefined;
  const base = `${origin.replace(/\/+$/u, "")}/${owner}/${repository}`;
  return { commit: `${base}/commit/${commit}`, history: `${base}/commits/commit/${commit}` };
}

/** The commit status the broker writes for one service of one environment. */
export function deployStatusContext(environment: string, service: string): string {
  return `mate/deploy/${environment}/${service}`;
}

/** As much of one service as a row needs. */
export interface EnvironmentServiceState {
  readonly hostname: string;
  /** Its repository in the group's org, from the tier's `buildFromGit`. */
  readonly repository?: string | undefined;
  /** The deployed version's name — the sha first (`appVersionName`). */
  readonly appVersionName?: string | undefined;
  /** Every commit status on that commit, as Gitea returned them. */
  readonly statuses?: ReadonlyArray<GiteaCommitStatus> | undefined;
}

/**
 * The state of one environment's last deploy, across its services.
 *
 * The worst wins: an environment with one service failing is an environment
 * that is not running what it says it runs, and averaging that away is how a
 * screen ends up saying "configured" for a broken setup.
 */
export function deployTone(input: {
  readonly environment: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
}): GroupRowTone {
  let seen: GroupRowTone = "neutral";
  for (const service of input.services) {
    const status = (service.statuses ?? []).find(
      (entry) => entry.context === deployStatusContext(input.environment, service.hostname),
    );
    if (status?.state === "failure" || status?.state === "error") return "bad";
    if (status?.state === "pending") seen = "pending";
    else if (status?.state === "success" && seen !== "pending") seen = "good";
  }
  return seen;
}

/**
 * One environment's row: what it follows, what it runs, and nothing else.
 *
 * With nothing deployed the row still exists and still names its source —
 * an environment that is declared and empty is a real, temporary state, and a
 * row that vanished until its first deploy would leave the person wondering
 * whether *Add stage* had worked at all.
 */
export function environmentRow(input: {
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  readonly sources: ReadonlyArray<string> | "release";
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  /** The environment's name in `environments.yaml`, which the statuses name. */
  readonly environment: string;
}): EnvironmentRow {
  const source = input.sources === "release" ? "release" : input.sources.join(" + ") || "—";
  // The first service that is running something names the environment: in a
  // monorepo they all carry the same release, and in a split one the row has
  // width for one answer.
  const named = input.services
    .map((service) => ({ service, version: deployedVersion(service.appVersionName) }))
    .find((entry) => entry.version.label !== undefined);
  const version = named?.version ?? NO_VERSION;
  const tone = deployTone({ environment: input.environment, services: input.services });
  return {
    kind: "environment",
    projectId: input.projectId,
    name: input.name,
    tier: input.tier,
    source,
    commit: version.commit,
    version,
    // Only what the recipe names. The hostname is the fallback a *status*
    // read uses, and reading by it answered 404 for every stage and production
    // of the owner's 2026-09-17 run — a link built on that guess goes nowhere,
    // which is worse than the plain text it replaced.
    versionRepository: named?.service.repository,
    line: version.label === undefined ? source : `${source} · ${version.label}`,
    tone,
  };
}

/** As much of one Mate as a row needs. */
export interface MateRowState {
  readonly projectId: string;
  readonly name: string;
  readonly visibility: RoleMateVisibility;
  readonly registration: MateRegistration;
  /** Who owns it, when the account can be read for a name. */
  readonly ownerName?: string | undefined;
}

/**
 * One Mate's row.
 *
 * Three cases, and only two of them say anything. A Mate the person opens gets
 * an empty line on purpose: its face, its name and its last message are the
 * row, and a status word beside them would be the same fact twice.
 */
export function mateRow(
  mate: MateRowState,
  admins: ReadonlyArray<MateOwnerCandidate> = [],
): MateRow {
  if (mate.visibility !== "open") {
    return {
      kind: "mate",
      projectId: mate.projectId,
      name: mate.name,
      visibility: mate.visibility,
      line: mateOnlyOwnerOpensIt(mate.ownerName),
      tone: "neutral",
    };
  }
  if (mate.registration === "awaiting-owner") {
    return {
      kind: "mate",
      projectId: mate.projectId,
      name: mate.name,
      visibility: mate.visibility,
      line: mateAwaitingRegistryLine(admins),
      tone: "pending",
    };
  }
  return {
    kind: "mate",
    projectId: mate.projectId,
    name: mate.name,
    visibility: mate.visibility,
    line: "",
    tone: "neutral",
  };
}

/** A recipe change waiting on somebody — the group repo's open pull requests. */
export function pullRequestRow(pull: GiteaPullRequest): PullRequestRow {
  const who = pull.user?.login;
  return {
    kind: "pull-request",
    number: pull.number,
    title: pull.title,
    line: who === undefined ? `#${pull.number}` : `#${pull.number} · ${who}`,
    tone: "pending",
  };
}

/** What a group whose Gitea the broker has not finished says about itself. */
export const GROUP_BEING_SET_UP_LINE = "Setting up its repositories…";

/**
 * Every row of one group, in the order they are read: who you talk to, where
 * the code runs, what is waiting to change.
 */
export function buildGroupRows(input: {
  readonly groupId: string;
  readonly slug: string;
  readonly gitea: GroupGiteaState;
  readonly mates: ReadonlyArray<MateRowState>;
  readonly environments: ReadonlyArray<Parameters<typeof environmentRow>[0]>;
  readonly pullRequests: ReadonlyArray<GiteaPullRequest>;
  readonly admins?: ReadonlyArray<MateOwnerCandidate> | undefined;
}): GroupRows {
  const environments = [...input.environments].sort(byTierThenName);
  return {
    groupId: input.groupId,
    slug: input.slug,
    // `unknown` says nothing: the org has not been asked about yet, and a line
    // that appears and then disappears is the layout shift this screen refuses.
    line: input.gitea === "being-set-up" ? GROUP_BEING_SET_UP_LINE : "",
    rows: [
      ...input.mates.map((mate) => mateRow(mate, input.admins ?? [])),
      ...environments.map((environment) => environmentRow(environment)),
      ...input.pullRequests.map((pull) => pullRequestRow(pull)),
    ],
  };
}

/** Stages first, in name order, then the production — the order code travels. */
function byTierThenName(
  left: { readonly tier: GroupEnvironmentTier; readonly name: string },
  right: { readonly tier: GroupEnvironmentTier; readonly name: string },
): number {
  if (left.tier !== right.tier) return left.tier === "stage" ? -1 : 1;
  return left.name.localeCompare(right.name, "en");
}
