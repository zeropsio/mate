/**
 * What a group's stages and production show on the projects screen (guide 4.4, 5.2): each
 * environment's row, and the version a service runs as a person talks about it.
 *
 * ## One line, and the dot carries the state
 *
 * A stage says the branch and the commit it actually runs. No row carries the word "deployed",
 * "running" or "ok" — that is what {@link GroupRowTone} is for, and what a `StatusDot` renders.
 *
 * ## Every fact from the party that can prove it
 *
 * The sha comes from the service's **app-version name**, which spells the
 * commit it was built from (`versionName.ts`) — never from the branch head,
 * which says what *should* be there. How the deploy went is HQ's record of it
 * (`HqEnvironment.deploys`) — never the version's existence.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupRows
 */

import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";

import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import type { HqJob, ServiceJobs } from "./hq/environments.ts";
import { isReleaseTag, shortCommit } from "./release.ts";
import { isWholeSha, parseVersionName } from "./versionName.ts";

/** What a row's dot says, for the four things a dot can honestly mean. */
export type GroupRowTone = "neutral" | "pending" | "good" | "bad";

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
   * The repository the named version was built from — or, while none is
   * named, the first service's by hostname that its tier builds — as the
   * tier's `buildFromGit` names it; never guessed from the hostname, because
   * an address built on a guess is a link that 404s.
   */
  readonly versionRepository: string | undefined;
  readonly line: string;
  readonly tone: GroupRowTone;
  /** HQ's newest job of each of its services HQ records one for (`ServiceJobs.latest`). */
  readonly deploys: ReadonlyArray<HqJob>;
  /**
   * HQ holds no deploy key that works for it (`HqEnvironment.keyHeld`, `keyInvalid`): it deploys
   * nothing there until somebody mints one.
   */
  readonly keyGap: boolean;
  /** HQ bringing it up (`HqEnvironment.birth`); absent where nothing told. */
  readonly birth?: EnvironmentBirth | null;
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
 * What is deployed, as a person talks about it: its name, and the commit
 * underneath.
 *
 * Zerops keeps one string per service — the app version's name — and the two
 * parties that write it write different things. HQ's Core names a stage
 * deploy `main {short sha}` and a release `{tag} {short sha}`, as main's
 * broker named them `{branch} {short sha}` and `{tag} {short sha}` (before
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
  /** The service's id, and the id of the version it runs; `null` for none, as the platform says. */
  readonly serviceId?: string | undefined;
  readonly activeVersionId?: string | null | undefined;
  /** Its newest deploy as HQ records it, and the newest that went live. */
  readonly deploy?: ServiceJobs | undefined;
}

/** How a deploy went, by the state HQ records its job in. */
const DEPLOY_TONES: Record<HqJob["state"], GroupRowTone> = {
  queued: "pending",
  submitting: "pending",
  building: "pending",
  live: "good",
  failed: "bad",
  refused: "bad",
  unresolved: "neutral",
  skipped: "neutral",
  superseded: "neutral",
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
  let unresolved = false;
  for (const { deploy } of services) {
    if (deploy === undefined) continue;
    unresolved ||= deploy.latest.state === "unresolved";
    const tone = DEPLOY_TONES[deploy.latest.state];
    if (tone === "bad") return "bad";
    if (tone === "pending" || seen !== "pending") seen = tone;
  }
  return unresolved && seen === "good" ? "neutral" : seen;
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
  /** Whether HQ holds its deploy key, and whether that key no longer works; unknown works. */
  readonly keyHeld?: boolean | undefined;
  readonly keyInvalid?: boolean | undefined;
  readonly birth?: EnvironmentBirth | null | undefined;
}): EnvironmentRow {
  const source = input.sources === "release" ? "release" : input.sources.join(" + ") || "—";
  // The first service that is running something names the environment: in a
  // monorepo they all carry the same release, and in a split one the row has
  // width for one answer. First by hostname, as the platform's answer for the
  // stop is (`stopDeploymentOf`): the two are compared, so they name one service.
  const byHostname = [...input.services].sort((left, right) =>
    left.hostname.localeCompare(right.hostname),
  );
  const named = byHostname
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
    // which is worse than the plain text it replaced. The tier declares it
    // whether or not a version is named yet: a stop whose store had not named
    // what it runs read "No repository is declared" (F13, 2026-10-03).
    versionRepository:
      named?.service.repository ??
      byHostname.find((service) => service.repository !== undefined)?.repository,
    line: version.label === undefined ? source : `${source} · ${version.label}`,
    tone,
    deploys: input.services.flatMap(({ deploy }) => (deploy === undefined ? [] : [deploy.latest])),
    keyGap: input.keyHeld === false || input.keyInvalid === true,
    ...(input.birth === undefined ? {} : { birth: input.birth }),
  };
}
