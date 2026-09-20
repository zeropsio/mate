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

import {
  checkDotTone,
  checkTone,
  checkWord,
  pullRequestBlocked,
  type GitCheckTone,
} from "./gitTab.ts";
import type { GiteaCommitStatus, GiteaPullRequest } from "./giteaClient.ts";
import { mateProjectOfBranch, mateProjectOfLogin } from "./mateIdentity.ts";
import { releaseWord, type ReleaseVerdict } from "./release.ts";

/** The group repo, whose pull requests are recipe changes and whose tags are the releases. */
export const GROUP_REPOSITORY = "group";

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
  /**
   * Whether it has already landed.
   *
   * The flows every surface reads carry the open changes, so this was always
   * false and nobody needed it. A change's own page can now be asked for a
   * landed one by number, and a page that offered *Merge* on a change that had
   * merged an hour ago would be lying twice over.
   */
  readonly merged: boolean;
  /** When it landed — the moment a timeline places it. Absent unless `merged`. */
  readonly mergedAt: string | undefined;
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
    merged: pull.merged === true,
    mergedAt: pull.merged_at,
    headSha: pull.head?.sha,
    baseBranch: pull.base?.ref ?? FALLBACK_BASE,
    line,
    updatedAt: pull.updated_at,
  };
}

/**
 * One of a Mate's changes landing, as a conversation places it.
 *
 * A Mate's message is frozen when it is written, so "two pull requests wait
 * for review" goes on saying so after both have landed (the owner,
 * 2026-09-20). The chip in the message says where a change stands now; this
 * says *when* it moved, in the one place a person reads the work in order.
 */
export interface ChangeLandedEvent {
  /** Stable across reads, so a timeline can key on it. */
  readonly key: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /** `appdev #1` — the same line every other surface names a change by. */
  readonly line: string;
  readonly landedAt: string;
}

/**
 * The landings that belong on one Mate's timeline, oldest first.
 *
 * A change with no `mergedAt` has no moment to be placed at and is left out
 * rather than guessed at. A person's own branch belongs to no conversation, and
 * another Mate's change belongs to that Mate's.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 */
export function changeLandedEvents(
  changes: ReadonlyArray<FlowPullRequest>,
  mateProjectId: string | undefined,
): ReadonlyArray<ChangeLandedEvent> {
  if (mateProjectId === undefined) return [];
  const events: Array<ChangeLandedEvent> = [];
  for (const change of changes) {
    if (!change.merged || change.mateProjectId !== mateProjectId) continue;
    const landedAt = change.mergedAt;
    if (landedAt === undefined) continue;
    events.push({
      key: `change-landed:${change.repository}#${String(change.number)}`,
      repository: change.repository,
      number: change.number,
      title: change.title,
      line: change.line,
      landedAt,
    });
  }
  // `toSorted` is not in Hermes, so the copy is explicit.
  return [...events].sort((left, right) => left.landedAt.localeCompare(right.landedAt));
}

/** How many landings one turn carries. A Mate is being told, not fed. */
const AGENT_NOTE_LIMIT = 5;

/** How much of a change's title a note carries before it stops being a line. */
const AGENT_NOTE_TITLE = 80;

/**
 * What to tell a Mate that it does not know, in the turn that wakes it.
 *
 * `since` is when the agent last spoke. Without it nothing is said: with no
 * moment to compare against every landing looks new, and a Mate told the same
 * thing every turn is worse off than one told late.
 *
 * A Mate cannot merge its own change — that is beyond its token — so every
 * landing here is genuinely news to it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 */
export function agentTurnNotes(
  events: ReadonlyArray<ChangeLandedEvent>,
  since: string | undefined,
): ReadonlyArray<string> {
  if (since === undefined) return [];
  const fresh = events.filter((event) => event.landedAt.localeCompare(since) > 0);
  const kept = fresh.slice(Math.max(0, fresh.length - AGENT_NOTE_LIMIT));
  return kept.map((event) => {
    const title = event.title.trim().slice(0, AGENT_NOTE_TITLE);
    const what = `${event.repository} #${String(event.number)} landed`;
    return title.length === 0 ? `${what}.` : `${what}: ${title}`;
  });
}

/** What a stop needs somebody for, as one number. */
export interface StopAttention {
  readonly count: number;
  /**
   * What that number is about: a deploy that failed is broken, work merely
   * waiting to go live is moving. It is a tone rather than an `urgent` flag so
   * the bubble a folded stop wears and the count on *Release* are decided
   * once — folded and unfolded said different things about the same changes.
   */
  readonly tone: ServiceStatusToneId;
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
  return count === 0 ? undefined : { count, tone: failed > 0 ? "failed" : "busy" };
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

/**
 * A change's one line under its title.
 *
 * It used to be `shop · appdev · main` — the Gitea org, the repository and the
 * base branch, three bare nouns whose first is the project's name with a
 * typo's worth of difference, and whose relationship to each other the reader
 * had to guess. Meanwhile the number, the author and the age sat in a
 * definition list below, where a line of provenance has no business being.
 *
 * So the provenance is one line and reads as one: which change, in what, going
 * where, from whom, how long ago. Anything not known is left out rather than
 * drawn as a gap.
 */
export function changeSubtitle(input: {
  readonly number: number;
  readonly repository: string;
  readonly baseBranch: string;
  /** Who wrote it, already resolved to a name — never a bot login. */
  readonly author: string | undefined;
  /** How long since it last moved, as `historyAge` says it. */
  readonly age: string | undefined;
}): string {
  const parts = [`#${String(input.number)}`, `${input.repository} → ${input.baseBranch}`];
  if (input.author !== undefined) parts.push(input.author);
  if (input.age !== undefined) parts.push(input.age);
  return parts.join(" · ");
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
  // No check ran, and nothing is stopping it either. Saying nothing at all
  // left a whole column blank on an account with no CI, where "nothing wrong"
  // and "not read yet" then looked identical. Grey, because no signal is not a
  // good signal — the same colour its own page gives it (`changeVerdict`).
  if (word === undefined) return { word: "Unchecked", tone: "off" };
  // From the one table, not a ternary of its own: `failing ? failed : ok`
  // painted checks that were still *running* green, while the change's own
  // page painted them blue. One fact, two colours, on two surfaces a click
  // apart.
  return { word, tone: checkDotTone(pull) ?? "off" };
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
 * One service's read for *what would go live*: the commit production runs, and
 * the commit `main` is at.
 *
 * A service production already runs is not read at all. A service production
 * runs **nothing** of is read with no base: a first release has no `from` to
 * compare against, and skipping it is what made a brand-new production answer
 * "nothing is waiting" while the row went on offering *Release* (measured
 * 2026-09-20).
 */
export interface ReleaseRead {
  readonly service: string;
  /** Where `main` is. */
  readonly head: string;
  /** What production runs, or `undefined` when it runs nothing yet. */
  readonly from: string | undefined;
}

/**
 * What to read so a release can say what it puts live, service by service.
 *
 * Pure: the reads themselves are the caller's (rule R1).
 */
export function planReleaseReads(
  mainHeads: ReadonlyMap<string, string>,
  running: ReadonlyMap<string, string>,
): ReadonlyArray<ReleaseRead> {
  const reads: Array<ReleaseRead> = [];
  for (const [service, head] of mainHeads) {
    const from = running.get(service);
    if (from === head) continue;
    reads.push({ service, head, from });
  }
  return reads;
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
