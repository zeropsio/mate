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

import type { ServiceStatusToneId } from "@t3tools/shared/brand";

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

/** What a stop needs somebody for, as one number. */
export interface StopAttention {
  readonly count: number;
  /** A deploy that failed outranks work merely waiting to go live. */
  readonly urgent: boolean;
}

/**
 * The bubble a stop wears when its rows are folded away.
 *
 * Folded, a project says only that it has a stage and a production — so the
 * one thing that has to survive the fold is whether either of them needs
 * somebody. A deploy that failed is one thing to deal with; a production's
 * waiting changes are one each. Nothing to do is no bubble rather than a
 * zero: a badge that is always there stops being read.
 */
export function stopAttention(input: {
  readonly failed: boolean;
  readonly production: boolean;
  readonly waiting: number;
}): StopAttention | undefined {
  const failed = input.failed ? 1 : 0;
  const waiting = input.production ? Math.max(0, Math.trunc(input.waiting)) : 0;
  const count = failed + waiting;
  return count === 0 ? undefined : { count, urgent: failed > 0 };
}

/**
 * What a change is called on the menu: `#4 Add a due date to each todo`, and
 * `· ada` after it where no Mate's row stands above to say whose it is.
 *
 * The number alone was tried and taken away again: a Mate's pull request is
 * titled with its commit message, so the row does echo the task on the row
 * above it — but stripped to `#4` the change loses its name entirely, which
 * costs more than the echo did (the owner, 2026-09-19). The fork carries the
 * distinction instead: a change is drawn branching off the line rather than
 * standing on it, so it reads as subordinate without having to go mute.
 */
export function sidebarChangeLabel(
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

/**
 * Why a pull request offers no *Merge*, in the words a row has space for —
 * `null` where Gitea says it merges and the verb speaks for itself.
 *
 * A row that simply dropped its verb was a dead end: Gitea had refused, and
 * the menu said nothing about it, so the person was left to open the request
 * to find out. Gitea's own answer is the only authority here (MU-1's
 * discipline applied to merges): nothing recomputes whether a branch merges.
 *
 * Every refusal has a word, including the red one. A row whose right edge is
 * a verb on one line and a wordless red dot on the next reads as neither, and
 * the dot's own tooltip is not an answer to a question asked by glancing (seen
 * in the harness, 2026-09-19).
 */
export function pullRequestBlockedReason(pull: {
  readonly number: number;
  readonly mergeable: boolean;
  readonly checks: GitCheckTone;
}): string | null {
  return pullRequestBlocked(pull)?.word ?? null;
}

/** Why a pull request offers no *Merge*, the tone that says it, and who moves it. */
export interface PullRequestBlocked {
  readonly kind: "checks-running" | "checks-failed" | "behind";
  readonly word: string;
  readonly tone: ServiceStatusToneId;
  /**
   * What to ask the Mate that wrote the change, where asking is what moves it
   * — and `undefined` where nothing is waiting on anyone.
   *
   * Nobody reading this menu is going to rebase a branch they have not checked
   * out, in a repository they have no session for. The Mate does it, so the
   * row that reports the problem is the row that hands it over: "who is going
   * to deal with it? you still need the agent to take care of it" (the owner,
   * 2026-09-19). Checks that are merely running are the one refusal with
   * nothing to ask for — waiting is the correct move.
   */
  readonly ask: string | undefined;
}

/**
 * The same answer with its own tone, because the dot beside the word has to
 * mean the word.
 *
 * Painting the checks' tone under every reason put a **green** dot beside
 * "needs a rebase" — the checks did pass, and the row still said the opposite
 * of what its dot showed (seen in the harness, 2026-09-19). A branch that has
 * fallen behind is nobody's failure and nothing is running: it is the one
 * thing on the row asking for a person, which is what `attention` means.
 */
export function pullRequestBlocked(pull: {
  readonly number: number;
  readonly mergeable: boolean;
  readonly checks: GitCheckTone;
}): PullRequestBlocked | null {
  if (pull.mergeable) return null;
  const change = `pull request #${pull.number}`;
  if (pull.checks === "pending")
    return { kind: "checks-running", word: "checks running", tone: "busy", ask: undefined };
  if (pull.checks === "failing")
    return {
      kind: "checks-failed",
      word: "checks failed",
      tone: "failed",
      ask: `The checks on ${change} are failing. Find out why, fix them, and push.`,
    };
  return {
    kind: "behind",
    word: "needs a rebase",
    tone: "attention",
    // Capitalised: the sentence is shown verbatim on a change's page as well
    // as written into a composer, and a page does not open mid-sentence.
    ask: `Pull request #${pull.number} no longer merges cleanly. Rebase it on main, resolve the conflicts, and push.`,
  };
}

/**
 * Who wrote a change, as a person reads it.
 *
 * `author` is the Gitea login, and a Mate's login is `mate-{projectId}` — so
 * showing it raw puts `mate-0bPLTRRSSTuV54WMpcLoww` on a page where a name
 * belongs (the owner, 2026-09-19). A Mate's change names its Mate, or says
 * nothing at all rather than saying that; a person's names the person, whose
 * login is their name here.
 *
 * Two surfaces had reached this conclusion separately and one of them had
 * already drifted, which is why it is decided here and nowhere else.
 */
export function changeAuthorName(
  pull: Pick<FlowPullRequest, "author" | "mateProjectId">,
  mateName: string | undefined,
): string | undefined {
  return pull.mateProjectId === undefined ? pull.author : mateName;
}

/** Where a change stands, as one word and the tone that means it. */
export interface ChangeState {
  readonly word: string;
  readonly tone: ServiceStatusToneId;
}

/**
 * Where a change stands, in one vocabulary.
 *
 * A list of changes used to mix two: `checkWord` answers in adjectives
 * (`Passing`, `Failing`) and `pullRequestBlocked` in phrases (`needs a
 * rebase`, `checks failed`), and both landed in the same column — so one row
 * read `Passing` and the next `needs a rebase`, in different registers, about
 * the same kind of thing. What is stopping a change outranks what its checks
 * did, because it is the thing somebody has to act on.
 */
export function changeState(pull: {
  readonly number: number;
  readonly mergeable: boolean;
  readonly checks: GitCheckTone;
}): ChangeState | undefined {
  const blocked = pullRequestBlocked(pull);
  if (blocked !== null) {
    return {
      word: blocked.word.charAt(0).toLocaleUpperCase() + blocked.word.slice(1),
      tone: blocked.tone,
    };
  }
  const word = checkWord(pull.checks);
  if (word === undefined) return undefined;
  return { word, tone: pull.checks === "failing" ? "failed" : "ok" };
}

/**
 * What pressing *Merge* actually does, said before it is pressed.
 *
 * Merging is a squash, and a squash cannot be taken back the way a release
 * can be rolled back to the tag before it — so the confirm says where the
 * change lands and what follows from it landing. A recipe change is the one
 * that reads differently: it does not deploy an application, it changes what
 * the environments are made of.
 */
export function mergeConsequence(pull: {
  readonly baseBranch: string;
  readonly kind: FlowPullRequestKind;
}): string {
  const squash = `It squashes onto ${pull.baseBranch}`;
  return pull.kind === "recipe"
    ? `${squash}, which changes what this project's environments are made of.`
    : `${squash}, and the stage runs what ${pull.baseBranch} says.`;
}

/**
 * How a change merges, in merge's own terms.
 *
 * A page that reports the checks and then reports them again under *Merges*
 * says the same words twice and answers neither question. What the checks did
 * is one fact; whether the change can land, and what it is waiting on, is
 * another — so this says the second without repeating the first.
 */
export function pullRequestMergeLine(pull: {
  readonly number: number;
  readonly mergeable: boolean;
  readonly checks: GitCheckTone;
  readonly baseBranch: string;
}): string {
  const blocked = pullRequestBlocked(pull);
  if (blocked === null) return `Cleanly, into ${pull.baseBranch}`;
  if (blocked.kind === "checks-running") return "Once the checks have finished";
  if (blocked.kind === "checks-failed") return "Not while the checks are failing";
  return `Not until it is rebased on ${pull.baseBranch}`;
}

/** What a release would carry, as much of it as a hover has room for. */
export interface ReleaseContentsSummary {
  /** The tasks, newest first, in the words the person asked for them in. */
  readonly subjects: ReadonlyArray<string>;
  /** How many more there are than the summary lists. */
  readonly more: number;
  /** Every commit the release carries, listed or not. */
  readonly total: number;
}

/**
 * The words a release is about to put in front of people.
 *
 * "Release" names the mechanism, not the thing — and someone who has never
 * merged a branch cannot tell from the verb what it would do. With squash
 * merges each commit on `main` that production is not running IS a task
 * delivered, under the words the person asked for it in, so the list reads as
 * plain English and no vocabulary has to be invented for it (the owner,
 * 2026-09-18: "it would be great if you could show like what is it going to
 * release").
 *
 * One commit reaches several services in a monorepo, so a sha is counted
 * once: the person is being told what changes, not how many services take it.
 */
export function releaseContentsSummary(
  contents: ReadonlyArray<{ readonly commits: ReadonlyArray<{ sha: string; subject: string }> }>,
  limit = 4,
): ReleaseContentsSummary {
  const seen = new Set<string>();
  const subjects: Array<string> = [];
  for (const entry of contents) {
    for (const commit of entry.commits) {
      if (seen.has(commit.sha)) continue;
      seen.add(commit.sha);
      const subject = commit.subject.trim();
      if (subject.length > 0) subjects.push(subject);
    }
  }
  const total = seen.size;
  return {
    subjects: subjects.slice(0, limit),
    more: Math.max(0, subjects.length - limit),
    total,
  };
}

/**
 * `12 waiting` — what a stop's row has width for at 256px, where the sentence
 * wrapped onto a second line and pushed the route off the row.
 *
 * Short because the row is narrow, and not shortened further: "12" alone is a
 * number with no noun, and the thing waiting is a change somebody made.
 */
export function releaseWaitingLabel(summary: ReleaseContentsSummary): string | undefined {
  return summary.total === 0 ? undefined : `${summary.total} waiting`;
}

/**
 * The same answer as one sentence, for the places a hover cannot reach — a
 * button's accessible name, a narrow row, a keyboard.
 */
export function releaseContentsSentence(summary: ReleaseContentsSummary): string | undefined {
  if (summary.total === 0) return undefined;
  const listed = summary.subjects.join("; ");
  const change = summary.total === 1 ? "1 change" : `${summary.total} changes`;
  return listed.length === 0 ? `puts ${change} live` : `puts ${change} live — ${listed}`;
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
