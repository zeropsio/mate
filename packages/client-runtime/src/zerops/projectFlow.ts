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
import { changeUrl, type HqChange } from "@t3tools/shared/hqChanges";

import { pullRequestBlocked } from "./gitTab.ts";
import type { MergeabilityKind } from "./changeMergeability.ts";
import type { GiteaPullRequest } from "./giteaClient.ts";
import { mateProjectOfBranch, mateProjectOfLogin } from "./mateIdentity.ts";
import { GROUP_REPOSITORY } from "./release.ts";

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
  /**
   * Gitea's answers over the reads so far (`forge/mergeState.ts`), never the
   * app's: Merge is offered only where it is `mergeable`.
   */
  readonly mergeability: MergeabilityKind;
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
  /**
   * The commit it landed as on its base — what a release's list of commits names it by. Numbers
   * are per repository, so this, not `#N`, is what ties a commit to its change.
   */
  readonly mergeCommitSha?: string | undefined;
  /**
   * `open` or `closed`, as Gitea says. A change read on its own by number may be closed without
   * ever merging: its review must not offer to merge it. Optional, as every flow built before a
   * review read it carries none.
   */
  readonly state?: string | undefined;
  readonly headSha: string | undefined;
  readonly baseBranch: string;
  /** `appdev #4`, or `appdev #4 · ada` for a person's; `recipe #6` on the group repo. */
  readonly line: string;
  readonly updatedAt: string | undefined;
  /*
   * What a review reads before anyone merges (pass 16, R4/R8). Optional, because every flow
   * built before a review existed carries none of them, and a surface that is not a review
   * never needs them.
   */
  /** The branch it comes from — `mate/mate-{projectId}` for a Mate's. */
  readonly headBranch?: string | undefined;
  /** Lines added and removed and files touched, as Gitea counts them; absent where it did not. */
  readonly additions?: number | undefined;
  readonly deletions?: number | undefined;
  readonly changedFiles?: number | undefined;
  /** The commit its branch last shared with the base, as Gitea tested it. */
  readonly mergeBase?: string | undefined;
  /** The base branch's head as read: past {@link mergeBase}, `main` moved on since. */
  readonly baseSha?: string | undefined;
  /**
   * Its description as its author wrote it, Markdown with its pictures; `undefined` where none was
   * written. What a review reads first.
   */
  readonly description?: string | undefined;
  /** How many comments were said on it, as Gitea counts them: the room its conversation takes. */
  readonly commentCount?: number | undefined;
}

/**
 * What zcp calls the pull request a Mate proposes the group's recipe in (`giteaRecipeBranchTitle`,
 * zcp `gitea_recipe_reconcile.go`): the tiers `main` lacks, `0 — AI Agent/import.yaml` among them,
 * which the broker merges by itself when it only adds files. A new Mate waits on it while `main`
 * has no recipe.
 */
export const RECIPE_PROPOSAL_TITLE = "Mate: the group's import files";

/** A Mate's proposal of the group's recipe: the group repo's change of zcp's title. */
export function isRecipeProposal(pull: Pick<FlowPullRequest, "kind" | "title">): boolean {
  return pull.kind === "recipe" && pull.title === RECIPE_PROPOSAL_TITLE;
}

/** The default branch until Gitea says otherwise. */
const FALLBACK_BASE = "main";

/** One pull request of the project, from what Gitea said about it. */
export function flowPullRequest(input: {
  readonly repository: string;
  readonly pull: GiteaPullRequest;
  /** How it merges over the reads of it so far (`forge/mergeState.ts`). */
  readonly mergeability: MergeabilityKind;
}): FlowPullRequest {
  const { pull, repository } = input;
  const kind: FlowPullRequestKind = repository === GROUP_REPOSITORY ? "recipe" : "code";
  const mateProjectId = mateProjectOfBranch(pull.head?.ref) ?? mateProjectOfLogin(pull.user?.login);
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
    mergeability: input.mergeability,
    merged: pull.merged === true,
    mergedAt: pull.merged_at,
    mergeCommitSha: pull.merge_commit_sha ?? undefined,
    state: pull.state,
    headSha: pull.head?.sha,
    baseBranch: pull.base?.ref ?? FALLBACK_BASE,
    line,
    updatedAt: pull.updated_at,
    headBranch: pull.head?.ref,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
    mergeBase: pull.merge_base,
    baseSha: pull.base?.sha,
    description: pull.body === undefined || pull.body.trim().length === 0 ? undefined : pull.body,
    commentCount: pull.comments,
  };
}

/** One of a Mate's changes in HQ as a row. */
function flowChange(change: HqChange, hqAddress: string): FlowPullRequest {
  const merged = change.state === "merged";
  return {
    repository: change.repo,
    number: change.number,
    title: change.title,
    // A recipe lives in HQ from T10 on; every change in HQ until then is code.
    kind: "code",
    mateProjectId: change.mateProjectId,
    author: undefined,
    url: changeUrl(hqAddress, change.appId, change.repo, change.number),
    // HQ's record of a change does not say yet whether it merges: checking until it does.
    mergeability: "checking",
    merged,
    mergedAt: change.mergedAt ?? undefined,
    ...(merged && change.mergedSha !== null ? { mergeCommitSha: change.mergedSha } : {}),
    state: change.state === "open" ? "open" : "closed",
    headSha: change.head ?? undefined,
    baseBranch: FALLBACK_BASE,
    // Under its Mate the row does not say whose it is.
    line: `${change.repo} #${String(change.number)}`,
    updatedAt: change.mergedAt ?? change.closedAt ?? change.openedAt,
    headBranch: `mate/${change.mateProjectId}/${String(change.number)}`,
    description: change.body.trim().length === 0 ? undefined : change.body,
  };
}

/**
 * An application's changes in HQ as every surface shows them: the open ones a push reached — an
 * open change with no head yet has nothing to show — and the landed ones, newest first. A change
 * closed without merging is in neither, as a pull request closed on main was in no flow.
 */
export function flowChanges(input: {
  readonly changes: ReadonlyArray<HqChange>;
  /** The official HQ's address, which a change's own address is at. */
  readonly hqAddress: string;
}): {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
} {
  const row = (change: HqChange) => flowChange(change, input.hqAddress);
  return {
    pullRequests: input.changes
      .filter((change) => change.state === "open" && change.head !== null)
      .map(row),
    // Filtered into a fresh array, so the sort touches nothing else.
    merged: input.changes
      .filter((change) => change.state === "merged")
      .sort((left, right) => (right.mergedAt ?? "").localeCompare(left.mergedAt ?? ""))
      .map(row),
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

type ChangeLabelOf = Pick<
  FlowPullRequest,
  "repository" | "number" | "title" | "mateProjectId" | "author"
>;

/**
 * Whether a change is named with its repository: when the changes of whoever opened it — its
 * Mate's, or a person's own — stand open in more than one repository, `#1` alone is two rows
 * that read the same (`appdev #1`, `apidev #1`).
 */
export function changeNamesRepository(
  pull: ChangeLabelOf,
  among?: ReadonlyArray<ChangeLabelOf>,
): boolean {
  if (among === undefined) return false;
  const whose = (entry: ChangeLabelOf) =>
    entry.mateProjectId === undefined
      ? `person:${entry.author ?? ""}`
      : `mate:${entry.mateProjectId}`;
  const owner = whose(pull);
  return among.some((entry) => whose(entry) === owner && entry.repository !== pull.repository);
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
 *
 * `among` is what is drawn with it: where its opener's changes span repositories, each row
 * leads with its own — `apidev #1 Rebuild the API`.
 */
export function sidebarChangeLabel(
  pull: ChangeLabelOf,
  among?: ReadonlyArray<ChangeLabelOf>,
): string {
  const number = `#${pull.number} ${pull.title}`;
  const title = changeNamesRepository(pull, among) ? `${pull.repository} ${number}` : number;
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
export function byNewest(left: FlowPullRequest, right: FlowPullRequest): number {
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
 * Where a change stands, in one vocabulary: what is stopping it, because it is
 * the thing somebody has to act on, or that nothing is. Saying nothing at all
 * for a change nothing stops left a whole column blank, where "nothing wrong"
 * and "not read yet" looked identical. Grey, because no signal is not a good
 * signal — the same quiet its own page gives it.
 */
export function changeState(pull: {
  readonly number: number;
  readonly mergeability: MergeabilityKind;
}): ChangeState | undefined {
  const blocked = pullRequestBlocked(pull);
  if (blocked !== null) {
    return {
      word: blocked.word.charAt(0).toLocaleUpperCase() + blocked.word.slice(1),
      tone: blocked.tone,
    };
  }
  return { word: "Ready to merge", tone: "off" };
}

/** How a change merges, in merge's own terms: whether it can land, and what it is waiting on. */
export function pullRequestMergeLine(pull: {
  readonly number: number;
  readonly mergeability: MergeabilityKind;
  readonly baseBranch: string;
}): string {
  const blocked = pullRequestBlocked(pull);
  if (blocked === null) return `Cleanly, into ${pull.baseBranch}`;
  if (blocked.kind === "checking") return "Still checking whether it can";
  if (blocked.kind === "empty") return `Nothing to merge into ${pull.baseBranch}`;
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

/** What a release would carry, service by service. */
type ReleaseContents = ReadonlyArray<{
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}>;

/**
 * Every commit a release would carry, once each and in order: one commit reaches several services
 * in a monorepo, and it is one change however many take it.
 */
export function releaseContentsCommits<Commit extends { readonly sha: string }>(
  contents: ReadonlyArray<{ readonly commits: ReadonlyArray<Commit> }>,
): ReadonlyArray<Commit> {
  const seen = new Set<string>();
  return contents
    .flatMap((entry) => entry.commits)
    .filter((commit) => {
      if (seen.has(commit.sha)) return false;
      seen.add(commit.sha);
      return true;
    });
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
  contents: ReleaseContents,
  limit = 4,
): ReleaseContentsSummary {
  const commits = releaseContentsCommits(contents);
  const subjects = commits
    .map((commit) => commit.subject.trim())
    .filter((subject) => subject.length > 0);
  const total = commits.length;
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
