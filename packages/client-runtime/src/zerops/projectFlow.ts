/**
 * The project's flow: who is working, what is waiting to land, where it
 * runs, what was released (spec §10.11, D26).
 *
 * One project (a group) has Mates and environments, and its code travels one
 * way — a Mate's branch, a pull request, the stage that follows `main`, a
 * release, the production. The left menu draws that as a timeline under each
 * project, the projects screen as rows under the Mates, and a Mate's own Git
 * tab shows only its own leg of it. All three read what this module decides,
 * so no surface grows a second opinion about whose pull request a change is
 * or whether a release can be gone back to (design system R5).
 *
 * ## Whose pull request it is
 *
 * A Mate works on a branch zcp names after its bot — `mate/{login}`, the
 * login being `mate-{projectId}` (gitea-mate `mate.go`, zcp
 * `gitea_repo.go`) — and its stage deploy opens the pull request as that bot
 * (D25). So a pull request belongs to the Mate whose branch it is, and
 * failing that to the Mate whose bot opened it: a person who renamed the
 * branch in Gitea still sees it under the Mate that wrote it. A pull request
 * from a person's own branch belongs to nobody's Mate and is listed after
 * them, never dropped.
 *
 * A pull request on the group repo is a recipe change whoever opened it:
 * it changes what the environments are made of, not what runs in them
 * (`docs/group-repo.md`).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module projectFlow
 */

import { checkTone, checkWord, type GitCheckTone } from "./gitTab.ts";
import type { GiteaCommitStatus, GiteaPullRequest } from "./giteaClient.ts";
import { releaseWord, type ReleaseVerdict } from "./release.ts";

/** The group repo, whose pull requests are recipe changes and whose tags are the releases. */
export const GROUP_REPOSITORY = "group";

const BOT_LOGIN_PREFIX = "mate-";
const MATE_BRANCH_PREFIX = "mate/";

/** The bot login of a Mate's project — what the broker registers it as. */
export function mateBotLogin(projectId: string): string {
  return `${BOT_LOGIN_PREFIX}${projectId}`;
}

/** The Mate's project behind a bot login, or `undefined` for a person. */
export function mateProjectOfLogin(login: string | undefined): string | undefined {
  if (login === undefined || !login.startsWith(BOT_LOGIN_PREFIX)) return undefined;
  const projectId = login.slice(BOT_LOGIN_PREFIX.length);
  return projectId.length > 0 ? projectId : undefined;
}

/** The Mate's project behind zcp's branch name, or `undefined` for any other branch. */
export function mateProjectOfBranch(ref: string | undefined): string | undefined {
  if (ref === undefined || !ref.startsWith(MATE_BRANCH_PREFIX)) return undefined;
  return mateProjectOfLogin(ref.slice(MATE_BRANCH_PREFIX.length));
}

export type FlowPullRequestKind = "code" | "recipe";

/** One open pull request of the project, as every surface shows it. */
export interface FlowPullRequest {
  /** The repository's name in the group's org. */
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly kind: FlowPullRequestKind;
  /** The Mate it belongs to; `undefined` for a person's own branch. */
  readonly mateProjectId: string | undefined;
  readonly author: string | undefined;
  readonly url: string | undefined;
  readonly checks: GitCheckTone;
  /** The one word beside the checks' dot; `undefined` where no check ran. */
  readonly checkWord: string | undefined;
  /** Gitea's answer, never the app's: Merge is offered only where it said yes. */
  readonly mergeable: boolean;
  readonly headSha: string | undefined;
  readonly baseBranch: string;
  /** `appdev #4`, or `appdev #4 · ada` for a person's; `recipe #6` on the group repo. */
  readonly line: string;
  readonly updatedAt: string | undefined;
}

/** The default branch until Gitea says otherwise. */
const FALLBACK_BASE = "main";

/** One pull request of the project, from what Gitea said about it. */
export function flowPullRequest(input: {
  readonly repository: string;
  readonly pull: GiteaPullRequest;
  /** Every commit status on the pull request's head. */
  readonly checks: ReadonlyArray<GiteaCommitStatus>;
}): FlowPullRequest {
  const { pull, repository } = input;
  const kind: FlowPullRequestKind = repository === GROUP_REPOSITORY ? "recipe" : "code";
  const mateProjectId = mateProjectOfBranch(pull.head?.ref) ?? mateProjectOfLogin(pull.user?.login);
  const tone = checkTone(input.checks);
  const author = pull.user?.login;
  // A recipe change's row already wears the tag; a code change names its
  // repository. A Mate's pull request sits under its Mate, so the line does
  // not say who; a person's names the person, which is the only thing the
  // row cannot show otherwise.
  const what = kind === "recipe" ? `#${pull.number}` : `${repository} #${pull.number}`;
  const line = mateProjectId === undefined && author !== undefined ? `${what} · ${author}` : what;
  return {
    repository,
    number: pull.number,
    title: pull.title,
    kind,
    mateProjectId,
    author,
    url: pull.html_url,
    checks: tone,
    checkWord: checkWord(tone),
    mergeable: pull.mergeable === true,
    headSha: pull.head?.sha,
    baseBranch: pull.base?.ref ?? FALLBACK_BASE,
    line,
    updatedAt: pull.updated_at,
  };
}

/**
 * `#4 Add a due date to each todo` — a menu row, where the Mate above it says
 * whose; a person's own, which sits under no Mate, names them after the title.
 */
export function sidebarPullRequestTitle(
  pull: Pick<FlowPullRequest, "number" | "title" | "mateProjectId" | "author">,
): string {
  const title = `#${pull.number} ${pull.title}`;
  return pull.mateProjectId === undefined && pull.author !== undefined
    ? `${title} · ${pull.author}`
    : title;
}

/**
 * The line with the Mate's name on it — `appdev #4 · Vera` — for a row that
 * does not sit under its Mate. A person's line already names them.
 */
export function pullRequestLineWith(
  pull: Pick<FlowPullRequest, "line" | "mateProjectId">,
  mateName: string | undefined,
): string {
  return pull.mateProjectId !== undefined && mateName !== undefined
    ? `${pull.line} · ${mateName}`
    : pull.line;
}

/** Newest first — the one a person is most likely waiting on. */
function byNewest(left: FlowPullRequest, right: FlowPullRequest): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || right.number - left.number;
}

/**
 * Each Mate's open pull requests, newest first, and the ones that are
 * nobody's Mate's — a person's own branch, or a Mate the caller does not list
 * (one the person may not open, say). Nothing is dropped: a change waiting to
 * land is waiting whoever wrote it.
 */
export function pullRequestsByMate(
  pulls: ReadonlyArray<FlowPullRequest>,
  mateProjectIds: ReadonlyArray<string>,
): {
  readonly byMate: ReadonlyMap<string, ReadonlyArray<FlowPullRequest>>;
  readonly others: ReadonlyArray<FlowPullRequest>;
} {
  const known = new Set(mateProjectIds);
  const byMate = new Map<string, Array<FlowPullRequest>>(
    mateProjectIds.map((projectId) => [projectId, []]),
  );
  const others: Array<FlowPullRequest> = [];
  for (const pull of [...pulls].sort(byNewest)) {
    const mate = pull.mateProjectId;
    if (mate !== undefined && known.has(mate)) byMate.get(mate)?.push(pull);
    else others.push(pull);
  }
  return { byMate, others };
}

/** How many pull requests a Mate shows before its list folds. */
const PULL_REQUESTS_SHOWN = 3;

/**
 * Whether a Mate's pull requests start folded. A handful reads at a glance;
 * more than that is a list, and a list under every Mate is a menu nobody can
 * scan (the owner: "smartly expandable").
 */
export function pullRequestsFolded(count: number): boolean {
  return count > PULL_REQUESTS_SHOWN;
}

/** One release of the group, as the broker judged it (`release.ts`). */
export interface FlowRelease {
  readonly tag: string;
  readonly verdict: ReleaseVerdict;
  /** Why the broker refused it, when it did. */
  readonly detail: string | undefined;
  /** `api 3f9c1b2 · web 77ab0e1` — what the tag lists, short. */
  readonly line: string;
}

export interface FlowReleaseRow extends FlowRelease {
  /** The word beside the dot — Approved, Refused, Checking; `undefined` before the broker spoke. */
  readonly word: string | undefined;
  /** Whether *Roll back to this* is offered. */
  readonly rollBack: boolean;
}

/**
 * A release's row, given its place in the newest-first list.
 *
 * The newest release is what production already runs, so rolling back to it
 * would be a tag that changes nothing; a release the broker refused was never
 * deployed, so there is nothing to go back to; one still being judged is not
 * yet a state production was ever in.
 */
export function releaseRow(release: FlowRelease, index: number): FlowReleaseRow {
  return {
    ...release,
    line:
      release.verdict === "refused" && release.detail !== undefined ? release.detail : release.line,
    word: releaseWord(release.verdict),
    rollBack: index > 0 && release.verdict === "approved",
  };
}

/** A verb the person runs on the flow, as the surfaces key its progress. */
export type FlowVerb =
  | {
      readonly kind: "merge";
      readonly slug: string;
      readonly repository: string;
      readonly number: number;
    }
  | {
      readonly kind: "open";
      readonly slug: string;
      readonly repository: string;
      readonly head: string;
    }
  | { readonly kind: "release"; readonly groupId: string }
  | { readonly kind: "roll-back"; readonly groupId: string; readonly tag: string };

/**
 * One key per verb and target: a row shows its own verb running and takes
 * no second click, and no other row's verb changes it (the audit run,
 * 2026-09-17: *Merge* and *Release* gave no sign where they were pressed).
 */
export function flowVerbKey(verb: FlowVerb): string {
  switch (verb.kind) {
    case "merge":
      return `merge ${verb.slug}/${verb.repository}#${verb.number}`;
    case "open":
      return `open ${verb.slug}/${verb.repository} ${verb.head}`;
    case "release":
      return `release ${verb.groupId}`;
    case "roll-back":
      return `roll-back ${verb.groupId} ${verb.tag}`;
  }
}

/** The verb's word on a row: what it does, or what it is doing while it runs. */
export function flowVerbLabel(kind: FlowVerb["kind"], running: boolean): string {
  switch (kind) {
    case "merge":
      return running ? "Merging…" : "Merge";
    case "open":
      return running ? "Opening…" : "Open pull request";
    case "release":
      return running ? "Releasing…" : "Release";
    case "roll-back":
      return running ? "Rolling back…" : "Roll back to this";
  }
}
