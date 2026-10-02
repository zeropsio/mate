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
 * The sha comes from the service's **app-version name**, which spells the
 * commit it was built from (`versionName.ts`) — never from the branch head,
 * which says what *should* be there. How the deploy went is HQ's record of it
 * (`HqEnvironment.deploys`) — never the version's existence.
 * Whether a group's Gitea is ready comes from `GET /orgs/{slug}` answering as
 * the person, never from the registry tag that asked for it
 * (`groupCreation.ts`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupRows
 */

import type { GiteaPullRequest } from "./giteaClient.ts";
import {
  mateAwaitingRegistryLine,
  type GroupGiteaState,
  type MateRegistration,
} from "./groupCreation.ts";
import type { GroupEnvironmentTier, MissingEnvironmentRow } from "./groupEnvironments.ts";
import type { HqDeploy } from "./hq/environments.ts";
import { mateOnlyOwnerOpensIt, type MateOwnerCandidate } from "./mateAccess.ts";
import { isReleaseTag, shortCommit } from "./release.ts";
import { isWholeSha, parseVersionName } from "./versionName.ts";
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

export type GroupRow = MateRow | EnvironmentRow | PullRequestRow | MissingEnvironmentRow;

export interface GroupRows {
  readonly groupId: string;
  readonly slug: string;
  /** Empty unless the group's Gitea side is not there yet. */
  readonly line: string;
  readonly rows: ReadonlyArray<GroupRow>;
}

/**
 * The commit an app version was built from, as its name spells it
 * (`parseVersionName`): whole in a name written before 2026-09-30, short in
 * one written since — so it is compared with `sameCommit`, never `===`.
 *
 * `undefined` for a name that is not one of ours — a version somebody deployed
 * with `zcli` by hand, say. Saying nothing is right: this row's whole job is to
 * name the commit that is running, and a name that is not a sha is not one.
 */
export function deployedCommit(appVersionName: string | undefined): string | undefined {
  return parseVersionName(appVersionName)?.sha;
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

/**
 * What is deployed, as a person talks about it: its name, and the commit
 * underneath.
 *
 * Zerops keeps one string per service — the app version's name — and the two
 * parties that write it write different things. The broker names a stage
 * deploy `{branch} {short sha}` and a release `{tag} {short sha}` (before
 * 2026-09-30: the bare sha, and `{sha} {tag} {tagger}`); somebody deploying
 * with `zcli` by hand names it whatever they typed.
 *
 * The name is what a row writes, and the commit is only its fallback: a
 * release is `v1.2.0` to everyone who talks about it, and `77ab0e1` answers a
 * question nobody asked (the owner, 2026-09-19 — "the commit hash should only
 * be a fallback to version name from Zerops"). The commit stays on the answer
 * either way, because the place that has room for both should say both.
 */
export interface DeployedVersion {
  /** The tag, or the whole of a hand-made name; `undefined` for a stage's commit. */
  readonly name: string | undefined;
  /**
   * The branch a stage deploy's name carries. The row already says the branch
   * the stage follows, so it names the commit; this keeps what the name said.
   */
  readonly branch?: string | undefined;
  /** The commit it was built from, short; `undefined` where the name is not one of ours. */
  readonly commit: string | undefined;
  /**
   * The commit as the name spells it — the whole 40-hex sha in an old name, the
   * short one in a new one. `commit` is what a person reads; this is what is
   * compared, with `sameCommit`, and resolved to a whole sha where a key needs
   * one (`resolveCommit`).
   */
  readonly sha: string | undefined;
  /** Who tagged the release, where the name carries it. */
  readonly taggedBy: string | undefined;
  /** The one thing a row writes: the name, and the commit only as its fallback. */
  readonly label: string | undefined;
}

/** Nothing is deployed, however the name said so. */
const NO_VERSION: DeployedVersion = {
  name: undefined,
  commit: undefined,
  sha: undefined,
  taggedBy: undefined,
  label: undefined,
};

export function deployedVersion(appVersionName: string | undefined): DeployedVersion {
  const whole = (appVersionName ?? "").trim().replace(/\s+/gu, " ");
  if (whole.length === 0) return NO_VERSION;
  const parsed = parseVersionName(whole);
  if (parsed === undefined) {
    // Not one of ours: the whole string is the only name it has, and it is a
    // better answer than saying nothing.
    return { name: whole, commit: undefined, sha: undefined, taggedBy: undefined, label: whole };
  }
  const { sha, label, taggedBy } = parsed;
  const commit = shortCommit(sha);
  // A new name's label is a stage's branch or a release's tag; only the tag is
  // what a person calls the version.
  const isBranch = label !== undefined && !isWholeSha(sha) && !isReleaseTag(label);
  const name = isBranch ? undefined : label;
  return {
    name,
    ...(isBranch ? { branch: label } : {}),
    commit,
    sha,
    taggedBy,
    label: name ?? commit,
  };
}

/** As much of one service as a row needs. */
export interface EnvironmentServiceState {
  readonly hostname: string;
  /** Its repository in the group's org, from the tier's `buildFromGit`. */
  readonly repository?: string | undefined;
  /** The deployed version's name — the sha first (`appVersionName`). */
  readonly appVersionName?: string | undefined;
  /** Its newest deploy as HQ records it, and the newest that went live. */
  readonly deploy?: ServiceDeploys | undefined;
}

/** A service's deploys as HQ records them (`HqEnvironment.deploys`). */
export interface ServiceDeploys {
  readonly latest: HqDeploy;
  readonly live: HqDeploy | null;
}

/** How a deploy went, by the state HQ records it in. */
const DEPLOY_TONES: Record<HqDeploy["state"], GroupRowTone> = {
  pending: "pending",
  deploying: "pending",
  live: "good",
  failed: "bad",
};

/**
 * The state of one environment's last deploy, across its services.
 *
 * The worst wins: an environment with one service failing is an environment
 * that is not running what it says it runs, and averaging that away is how a
 * screen ends up saying "configured" for a broken setup.
 */
export function deployTone(services: ReadonlyArray<EnvironmentServiceState>): GroupRowTone {
  let seen: GroupRowTone = "neutral";
  for (const { deploy } of services) {
    if (deploy === undefined) continue;
    const tone = DEPLOY_TONES[deploy.latest.state];
    if (tone === "bad") return "bad";
    if (tone === "pending" || seen !== "pending") seen = tone;
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
}): EnvironmentRow {
  const source = input.sources === "release" ? "release" : input.sources.join(" + ") || "—";
  // The first service that is running something names the environment: in a
  // monorepo they all carry the same release, and in a split one the row has
  // width for one answer.
  const named = input.services
    .map((service) => ({ service, version: deployedVersion(service.appVersionName) }))
    .find((entry) => entry.version.label !== undefined);
  const version = named?.version ?? NO_VERSION;
  const tone = deployTone(input.services);
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
