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
 * commit the broker built from (`versionName.ts`, `docs/group-repo.md`) —
 * never from the branch head, which says what *should* be there.
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
import type { GroupEnvironmentTier, MissingEnvironmentRow } from "./groupEnvironments.ts";
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
  /** A stage's first deploy failing on `main`'s head (`firstDeployFailure`); absent otherwise. */
  readonly firstDeployFailure?: FirstDeployFailure;
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
  /**
   * Its repository's `main` head and every status on it — read only while its stage runs
   * nothing (`planFirstDeployHeadReads`): where its first deploy failed before any build.
   */
  readonly head?: MainHeadStatuses | undefined;
}

/** A repository's `main` head, and every commit status on it as Gitea returned them. */
export interface MainHeadStatuses {
  readonly sha: string;
  readonly statuses: ReadonlyArray<GiteaCommitStatus>;
}

/** A stage's first deploy failing on `main`'s head (`firstDeployOnHead`). */
export interface FirstDeployFailure {
  /** What the job reported, where the broker's status carries its words; `undefined` otherwise. */
  readonly reason: string | undefined;
}

/** What the statuses on the head a stage deploys say of its first deploy. */
export type FirstDeployOnHead =
  /** `final`: the job's own report, which nothing after it changes for this commit. */
  | { readonly kind: "failed"; readonly reason: string | undefined; readonly final: boolean }
  /** The job got past its own steps and holds the broker's grant: the build shows next. */
  | { readonly kind: "granted" }
  /** The broker deployed it. */
  | { readonly kind: "deployed" }
  /** Nothing says it failed or got past its steps: pass 34's words stand. */
  | { readonly kind: "open" };

/** How the broker opens a job's own failure report (gitea-mate `DescriptionFailed`). */
const JOB_REPORT = "failed: ";
/** How the broker opens the status its grant writes (gitea-mate `DescriptionDeploying`). */
const GRANTED = "deploying";

const failing = (status: GiteaCommitStatus) =>
  status.state === "failure" || status.state === "error";

/**
 * Whether `candidate` is newer than `held`, by when it was posted, then by id; by Gitea's own
 * order — newest first — only where neither says.
 */
function newer(candidate: GiteaCommitStatus, held: GiteaCommitStatus): boolean {
  const [at, heldAt] = [candidate.created_at, held.created_at].map((value) =>
    value === undefined ? Number.NaN : Date.parse(value),
  ) as [number, number];
  if (!Number.isNaN(at) && !Number.isNaN(heldAt) && at !== heldAt) return at > heldAt;
  if (candidate.id !== undefined && held.id !== undefined) return candidate.id > held.id;
  return false;
}

const postedAt = (status: GiteaCommitStatus): number =>
  status.created_at === undefined ? Number.NaN : Date.parse(status.created_at);

/** A status of the broker's that says the job got past its steps: its grant, or its deploy. */
const grantedOrDeployed = (status: GiteaCommitStatus): boolean =>
  status.state === "success" ||
  (status.state === "pending" && (status.description?.trim() ?? "").startsWith(GRANTED));

/** Each context's newest status, whatever order Gitea listed them in. */
export function newestByContext(
  statuses: ReadonlyArray<GiteaCommitStatus>,
): ReadonlyMap<string, GiteaCommitStatus> {
  const newest = new Map<string, GiteaCommitStatus>();
  for (const status of statuses) {
    const held = newest.get(status.context);
    if (held === undefined || newer(status, held)) newest.set(status.context, status);
  }
  return newest;
}

/**
 * The one truth table for the head `H` a stage deploys (pass 35, after run 5), on each context's
 * newest status:
 *
 * 1. The broker's `mate/deploy/{environment}/{service}` is a `failure` opening "failed: " — the
 *    job's own report: failed, final, and the rest is why.
 * 2. The broker's is `pending` opening "deploying" — the job got past its steps and holds the
 *    grant: not failed, whatever else failed (and `success`: deployed).
 * 3. The group's workflow's own context — any the broker does not write — is a `failure` posted
 *    after the broker's last grant or deploy on `H`, or with none on it: failed, not final. Gitea
 *    posts no status for the broker's `workflow_dispatch` run, which runs the same workflow on the
 *    same commit (run 5: run 280 failed beside the push run's status and left none), so the push
 *    run's failure is the one sign of it; a dispatch that gets past its steps turns it by rule 2,
 *    and one from before the broker's last grant is an earlier try's. `deploy.sh` exits 1 on any
 *    refused grant, so a refusal fails the push run too: the stage reads failed for that try until
 *    the broker's retry writes "deploying" (2–7 min) — that try did fail.
 * 4. The broker's is a `failure` or `error` without "failed: " — a refusal it retries: not failed.
 * 5. Otherwise nothing is said.
 *
 * The exact signal would be the broker writing its own `failure` with "failed: <step>" as the run
 * it dispatched fails (a later gitea-mate pass); rule 1 reads it as it lands.
 */
export function firstDeployOnHead(input: {
  readonly environment: string;
  readonly hostname: string;
  readonly statuses: ReadonlyArray<GiteaCommitStatus>;
}): FirstDeployOnHead {
  const newest = newestByContext(input.statuses);
  const broker = newest.get(deployStatusContext(input.environment, input.hostname));
  const words = broker?.description?.trim() ?? "";
  if (broker !== undefined && failing(broker) && words.startsWith(JOB_REPORT)) {
    const reason = words.slice(JOB_REPORT.length).trim();
    return { kind: "failed", reason: reason.length === 0 ? undefined : reason, final: true };
  }
  if (broker?.state === "success") return { kind: "deployed" };
  if (broker?.state === "pending" && words.startsWith(GRANTED)) return { kind: "granted" };
  // The broker's last grant or deploy on this head: a push failure from before it is an earlier
  // try's, not the one the broker dispatched since.
  const context = deployStatusContext(input.environment, input.hostname);
  let movedOnAt: number | undefined;
  for (const status of input.statuses) {
    if (status.context !== context || !grantedOrDeployed(status)) continue;
    const at = postedAt(status);
    movedOnAt = Math.max(
      movedOnAt ?? Number.NEGATIVE_INFINITY,
      Number.isNaN(at) ? Number.POSITIVE_INFINITY : at,
    );
  }
  for (const [name, status] of newest) {
    if (name.startsWith("mate/") || !failing(status)) continue;
    const at = postedAt(status);
    if (movedOnAt === undefined || (!Number.isNaN(at) && at > movedOnAt))
      return { kind: "failed", reason: undefined, final: false };
  }
  return { kind: "open" };
}

/**
 * Whether a stage's first deploy failed on the head of any of its services' repositories
 * (`firstDeployOnHead`), with the job's own words where one says them.
 */
export function firstDeployFailure(input: {
  readonly environment: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
}): FirstDeployFailure | undefined {
  let failure: FirstDeployFailure | undefined;
  for (const service of input.services) {
    if (service.head === undefined) continue;
    const verdict = firstDeployOnHead({
      environment: input.environment,
      hostname: service.hostname,
      statuses: service.head.statuses,
    });
    if (verdict.kind !== "failed") continue;
    if (failure === undefined || (failure.reason === undefined && verdict.reason !== undefined))
      failure = { reason: verdict.reason };
  }
  return failure;
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
  // width for one answer. First by hostname, as the platform's answer for the
  // stop is (`stopDeploymentOf`): the two are compared, so they name one service.
  const named = [...input.services]
    .sort((left, right) => left.hostname.localeCompare(right.hostname))
    .map((service) => ({ service, version: deployedVersion(service.appVersionName) }))
    .find((entry) => entry.version.label !== undefined);
  const version = named?.version ?? NO_VERSION;
  const tone = deployTone({ environment: input.environment, services: input.services });
  const failure =
    input.tier === "stage"
      ? firstDeployFailure({ environment: input.environment, services: input.services })
      : undefined;
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
    ...(failure === undefined ? {} : { firstDeployFailure: failure }),
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

/**
 * How long a build step took — `4s`, `1m 32s`, `1h 04m`.
 *
 * A run with no duration on it is the one thing every other forge shows and
 * this one was dropping; a step still going has none to show yet.
 */
export function jobDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
): string | undefined {
  if (startedAt === undefined || completedAt === undefined) return undefined;
  const from = Date.parse(startedAt);
  const to = Date.parse(completedAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}
