/**
 * The Git tab's join: a branch, the pull request open from it, and the
 * environment that picks it up (guide 4.5).
 *
 * ## Two sources, and neither may answer for the other
 *
 * Which branch a Mate is on is the **working copy's** fact. It lives in the dev
 * container and the Mate server streams it (`subscribeVcsStatus`). What that
 * branch *means* outside the container is **Gitea's**: whether a pull request
 * is open from it, how its checks went, what this person may do in that
 * repository. And which environment would pick it up on merge is the **group
 * repo's**, from `environments.yaml`.
 *
 * Nothing here infers one from another. In particular:
 *
 * - *what the person may do* comes from the repository probe's `permissions`,
 *   never from the role the app happens to know — the mirror lags a role
 *   change by minutes;
 * - *that the remote is healthy* — which is also the only proof the Mate holds
 *   the Gitea access the broker's rights loop writes onto it — comes from a
 *   live `git ls-remote`, never from the last push having worked or from a
 *   `GITEA_TOKEN` key being present.
 *
 * A tab that mixes them shows "configured" for a broken setup, which is the one
 * outcome 4.5 names.
 *
 * ## One block per repository, one answer, one verb
 *
 * A block opens with where the work stands — `Open as #12, waiting for
 * somebody to merge it.` — and carries the verb that moves it. Under the
 * answer, quietly, the checkout it was read from: the branch, what is unpushed
 * and what is uncommitted, and which environment the work lands on.
 *
 * At most one verb, and it is the one the work needs next: you cannot open a
 * pull request for a branch you have not pushed, and updating from `main`
 * before pushing is how a person loses work, so the order the verbs are
 * offered in is the order the work actually happens in. A state that offers no
 * verb says why it offers none.
 *
 * Checks are a tone and one word, never a sentence (design system R5). A block
 * whose setup has been *proved* broken says what was proved — git's own line
 * for a remote that refused — and offers no verb that would run against it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module gitTab
 */

import { ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { GiteaCommitStatus, GiteaPullRequest, GiteaRepository } from "./giteaClient.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";
import { branchLabel } from "./mateIdentity.ts";
import { foldedStageHostnames } from "./serviceMap.ts";
import type { ZeropsTopologyService } from "./topology.ts";

/** What the container says about one checkout (`subscribeVcsStatus`). */
export interface GitCheckoutState {
  /** The service's hostname, which is its repository's name in the group's org. */
  readonly repository: string;
  readonly isRepo: boolean;
  /** Whether a remote is configured at all — not whether it answers. */
  readonly hasRemote: boolean;
  readonly headRef: string | null;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly hasUpstream: boolean;
  /**
   * What the Mate has changed and not committed, file by file.
   *
   * The count alone used to be all the tab kept of this, which made the one
   * fact nothing outside the container can prove — what is on disk right
   * now — into a number with nothing behind it.
   */
  readonly changed: ReadonlyArray<GitChangedFile>;
}

/** One file the working tree has changed, with its diffstat. */
export interface GitChangedFile {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
}

/** What Gitea says about that repository and branch, answering as the person. */
export interface GitForgeState {
  /**
   * Whether the forge answered at all.
   *
   * `false` is not an answer about the repository, it is the absence of one.
   * The field below has always said so in a comment, and `stateOf` read it as
   * "there is none" anyway: the Git tab opened by telling a person their work
   * did not exist, listed five of their commits under that sentence, and then
   * took the whole thing back (measured on the live account, 2026-09-19).
   */
  readonly read: boolean;
  /** `undefined` while nothing has been asked — not "it is not there". */
  readonly repository: GiteaRepository | undefined;
  /** The pull request whose head is this branch, open or freshly merged. */
  readonly pullRequest: GiteaPullRequest | undefined;
  /** Every commit status on the pull request's head. */
  readonly checks: ReadonlyArray<GiteaCommitStatus>;
}

/**
 * The fact that has to be proved rather than assumed. `undefined` means not
 * asked yet, which says nothing — never "fine".
 */
export interface GitBlockEvidence {
  /** A live `git ls-remote` answered (`zerops.git.probeRemote`). */
  readonly remoteReachable: boolean | undefined;
  /**
   * What git said when it refused — its own `remote:` line, as the probe
   * capped it. A person fixes a permission or a URL from that sentence and
   * from nothing the app could have written instead.
   */
  readonly remoteDetail?: string | undefined;
}

/** What the person is looking at, in one word the block is built around. */
export type GitBlockState =
  /** The forge has not answered. Says nothing, and must not be made to. */
  "unread" | "no-repository" | "untouched" | "unpushed" | "behind" | "in-review" | "merged";

/** How the checks on the branch's head went — a dot's tone, with one word. */
export type GitCheckTone = "none" | "pending" | "passing" | "failing";

export type GitBlockActionKind = "open-pull-request" | "update-from-main" | "push" | "merge";

export interface GitBlockAction {
  readonly kind: GitBlockActionKind;
  readonly label: string;
  /** The verb's word while it runs — "Merging…" — so the row says so where it was pressed. */
  readonly running: string;
  /**
   * The verb runs in the container, through the Mate server, as the agent's
   * user — so only the Mate's owner may press it (D11). A verb that runs in
   * Gitea as the person is not owner-only: Gitea polices it.
   */
  readonly ownerOnly: boolean;
}

export interface GitBlock {
  readonly repository: string;
  /** The branch the container is on. `main` for a codebase nobody has touched. */
  readonly branch: string;
  /**
   * Where this repository's work stands, and in what colour. `undefined`
   * while the forge has not answered — the block holds the place open rather
   * than filling it with a sentence it would have to withdraw.
   */
  readonly verdict: GitVerdict | undefined;
  /** `feature/invoices ↑3 · 2 files changed` — the checkout, under the answer. */
  readonly checkoutLine: string;
  readonly state: GitBlockState;
  readonly checks: GitCheckTone;
  /** `undefined` when no word belongs beside the dot — no checks ran. */
  readonly checkWord: string | undefined;
  /** Every check on the head, by name — empty where none ran. */
  readonly checkRows: ReadonlyArray<GitCheckRow>;
  /** What is changed on disk and not committed — the container's own fact. */
  readonly changed: ReadonlyArray<GitChangedFile>;
  readonly pullRequestNumber: number | undefined;
  readonly pullRequestUrl: string | undefined;
  /** The branch a pull request from `branch` targets — the repository's default, `main` until Gitea says. */
  readonly baseBranch: string;
  /** `stage picks it up on merge`, or empty when nothing would. */
  readonly destination: string;
  readonly action: GitBlockAction | undefined;
  /**
   * What is actually wrong with the setup, when something is — proved, not
   * inferred. Empty when nothing is known to be wrong.
   */
  readonly trouble: string;
}

/** The default branch when Gitea has not been asked yet. */
const FALLBACK_DEFAULT_BRANCH = "main";

/**
 * Which environment picks a branch up, from `environments.yaml`.
 *
 * The first declaration that lists the branch among its sources. A production
 * never matches: its source is `release`, and a merge to a branch does not
 * release anything (`docs/group-repo.md`).
 */
export function environmentForBranch(
  declarations: ReadonlyArray<GroupEnvironment>,
  branch: string | null,
): string | undefined {
  if (branch === null || branch.length === 0) return undefined;
  return declarations.find((entry) => entry.sources !== "release" && entry.sources.includes(branch))
    ?.name;
}

/** How the checks on one commit went, worst-first — a green among reds is not green. */
export function checkTone(statuses: ReadonlyArray<GiteaCommitStatus>): GitCheckTone {
  // The broker's own deploy statuses are not checks on the change: they are
  // what happened after it landed, and counting them would make a stage's
  // failed deploy read as a failing pull request.
  const checks = statuses.filter((status) => !status.context.startsWith("mate/"));
  if (checks.length === 0) return "none";
  if (checks.some((status) => status.state === "failure" || status.state === "error")) {
    return "failing";
  }
  if (checks.some((status) => status.state === "pending")) return "pending";
  return checks.some((status) => status.state === "success") ? "passing" : "none";
}

/**
 * The checks' tone as a status dot's — `undefined` where no check ran and no
 * dot belongs.
 *
 * Here rather than beside a component: four surfaces paint this fact (a
 * change's row on the projects screen, the merge dialog, the left menu, the
 * Git tab), and a tone table that lives in one of them is a table the other
 * three are one edit away from disagreeing with.
 */
export function checkDotTone(input: {
  readonly checks: GitCheckTone;
}): ServiceStatusToneId | undefined {
  switch (input.checks) {
    case "passing":
      return "ok";
    case "pending":
      return "busy";
    case "failing":
      return "failed";
    case "none":
      return undefined;
  }
}

/** One check on the branch's head, as the tab lists it. */
export interface GitCheckRow {
  /** The check's own name, as the forge reports it. */
  readonly name: string;
  readonly tone: ServiceStatusToneId;
  readonly word: string;
}

const CHECK_STATE: Record<string, { readonly tone: ServiceStatusToneId; readonly word: string }> = {
  success: { tone: "ok", word: "Passed" },
  pending: { tone: "busy", word: "Running" },
  failure: { tone: "failed", word: "Failed" },
  error: { tone: "failed", word: "Failed" },
};

/**
 * Every check on the head, by name.
 *
 * One collapsed word answers "can it land"; it does not answer "which one
 * broke", which is the question a person opens a Git panel with. The broker's
 * own deploy statuses stay out for the same reason they stay out of
 * `checkTone`: they are what happened after a change landed, not a verdict on
 * the change.
 */
export function gitChecks(statuses: ReadonlyArray<GiteaCommitStatus>): ReadonlyArray<GitCheckRow> {
  return statuses
    .filter((status) => !status.context.startsWith("mate/"))
    .map((status) => ({
      name: status.context,
      tone: CHECK_STATE[status.state]?.tone ?? "off",
      word: CHECK_STATE[status.state]?.word ?? "Unknown",
    }));
}

/** The one word beside the checks' dot (R5). */
export function checkWord(tone: GitCheckTone): string | undefined {
  switch (tone) {
    case "passing":
      return "Passing";
    case "pending":
      return "Running";
    case "failing":
      return "Failing";
    case "none":
      return undefined;
  }
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
 * The quiet line under a repository's name: `feature/invoices ↑3 · 2 files
 * changed`.
 *
 * Not the repository — that is the name this line sits under, and repeating it
 * spent the first third of every row saying what the row already said. Not two
 * zeros either: `↑0 ↓0` is the one case where the arrows carry nothing, and a
 * person who reads them learns exactly what their absence would have told them.
 */
export function gitCheckoutLine(
  checkout: GitCheckoutState,
  /** Whose checkout it is, so its own branch reads as a name (`branchLabel`). */
  mateName?: string | undefined,
): string {
  if (!checkout.isRepo) return "no repository yet";
  const branch = branchLabel(checkout.headRef, mateName);
  const ahead = checkout.aheadCount > 0 ? ` ↑${String(checkout.aheadCount)}` : "";
  const behind = checkout.behindCount > 0 ? ` ↓${String(checkout.behindCount)}` : "";
  const counts = checkout.hasUpstream ? `${ahead}${behind}` : " · never pushed";
  const count = checkout.changed.length;
  const changed = count === 0 ? "" : ` · ${String(count)} file${count === 1 ? "" : "s"} changed`;
  return `${branch}${counts}${changed}`;
}

/** Where one repository's work stands, as the tab opens with it. */
export interface GitVerdict {
  readonly tone: ServiceStatusToneId;
  /** One sentence: what is true of this repository's work right now. */
  readonly text: string;
  /**
   * The exact words that move it, where handing it back to the Mate is what
   * moves it — `undefined` where nothing is waiting on anybody, or where the
   * block already offers the verb itself.
   *
   * The tab has always said pushing is the agent's ("the tab says what is
   * unpushed and the person asks their Mate, rather than the app committing
   * for them") and then offered no way to ask. This is that way.
   */
  readonly ask: string | undefined;
}

/** `3 commits` / `1 commit`, with the verb that agrees with it. */
function commits(count: number): { readonly subject: string; readonly verb: string } {
  return count === 1
    ? { subject: "1 commit", verb: "is" }
    : { subject: `${String(count)} commits`, verb: "are" };
}

/**
 * The sentence the tab opens each repository with.
 *
 * The tab used to open on `api · feature/invoices ↑0 ↓0` — a machine-generated
 * branch name and two zeros — and left the one word that mattered
 * (`data-zerops-git-state`) in the DOM where nobody reads it. A person came to
 * this tab to learn where their Mate's work had got to and had to assemble it
 * from a ref, two arrows and a pull request number (the owner, 2026-09-19:
 * "this tab is pretty shit isn't it").
 *
 * So it answers, worst-first, in the same voice as a change's page: what has
 * been *proved* wrong beats anything that would have been inferred, and every
 * state that offers no verb says why it offers none — a pull request that
 * looks fine and cannot move is the trap `changeVerdict` was written to close.
 */
export function gitVerdict(input: {
  readonly state: GitBlockState;
  readonly checks: GitCheckTone;
  readonly checkout: GitCheckoutState;
  readonly pullRequestNumber: number | undefined;
  /** Whether the forge would take the merge. Not whether it is a good idea. */
  readonly mergeable: boolean;
  readonly baseBranch: string;
  readonly trouble: string;
}): GitVerdict | undefined {
  // Proved beats inferred: a remote that refused is the whole story, and a
  // count of unpushed commits under it would be an invitation to a verb that
  // cannot run.
  if (input.trouble.length > 0) return { tone: "failed", text: input.trouble, ask: undefined };
  switch (input.state) {
    case "unread":
      // Nothing has been asked yet, so there is nothing to say. The change's
      // own page already opens this way — its title, then its panel when the
      // read lands — and a panel that speaks here is a panel that takes it
      // back.
      return undefined;
    case "no-repository":
      return { tone: "off", text: "No code here yet.", ask: undefined };
    case "merged":
      return { tone: "ok", text: `Merged into ${input.baseBranch}.`, ask: undefined };
    case "in-review":
      // The same pull request has a page of its own, and `changeVerdict` is
      // what that page opens with. Two surfaces answering the same question in
      // two colours is how a release came to wear a rebase's amber, so the
      // tones here are the tones there — held to it by a test that reads both
      // (`changeVerdict.test.ts`). Only the words are shorter: the number and
      // the branch are already on the line above this panel.
      return {
        ...IN_REVIEW[input.mergeable ? "mergeable" : "refused"][input.checks],
        ask: inReviewAsk(input),
      };
    case "behind": {
      const { subject, verb } = commits(input.checkout.behindCount);
      return {
        tone: "attention",
        text: `${subject} on the remote ${verb} not in this checkout yet.`,
        // `Update from main` is right here, and it is the person's to press.
        ask: undefined,
      };
    }
    case "unpushed": {
      const what = input.checkout.repository;
      if (!input.checkout.hasUpstream) {
        return {
          tone: "busy",
          text: "This branch has never been pushed.",
          ask: `Your work on ${what} has never been pushed. Push the branch.`,
        };
      }
      const { subject, verb } = commits(input.checkout.aheadCount);
      return {
        tone: "busy",
        text: `${subject} here ${verb} not pushed yet.`,
        ask: `${subject} on ${what} ${verb} not pushed. Push them.`,
      };
    }
    case "untouched":
      // Grey, not green: a repository nobody has touched is the absence of
      // news, and a wall of green for idle rows would spend the colour that
      // says work has actually landed.
      return { tone: "off", text: "Nothing new here.", ask: undefined };
  }
}

/**
 * What to hand back about a change that is open, and nothing where there is
 * nothing to hand back.
 *
 * A change the forge *would* take and whose checks went red is still worth
 * somebody's time, so it is offered the same words a refused one is — which is
 * what `changeVerdict` does, and why the mergeable flag is forced here. A
 * change with nothing wrong with it asks for nothing: passing it to the Mate
 * anyway would be work invented by the surface reporting it.
 */
function inReviewAsk(input: {
  readonly checks: GitCheckTone;
  readonly mergeable: boolean;
  readonly pullRequestNumber: number | undefined;
}): string | undefined {
  if (input.pullRequestNumber === undefined) return undefined;
  if (input.mergeable && input.checks !== "failing") return undefined;
  return pullRequestBlocked({
    number: input.pullRequestNumber,
    mergeable: false,
    checks: input.checks,
  })?.ask;
}

/**
 * A pull request's answer, by whether the forge would take it and how its
 * checks went — the tone table `changeVerdict` uses, in this tab's words.
 *
 * A forge refuses a merge when required checks failed, and allows one when
 * nothing required them; the first says it cannot land, the second says only
 * that the checks failed, because greying out a verb the forge would accept is
 * a lie and leaving it lit with no explanation is a trap.
 */
const IN_REVIEW: Record<"mergeable" | "refused", Record<GitCheckTone, Omit<GitVerdict, "ask">>> = {
  mergeable: {
    failing: { tone: "failed", text: "Its checks failed." },
    pending: { tone: "busy", text: "Its checks are still running." },
    none: { tone: "off", text: "No checks ran. Nothing is stopping it." },
    passing: { tone: "ok", text: "The checks passed. Nothing is stopping it." },
  },
  refused: {
    failing: { tone: "failed", text: "Its checks failed, and it cannot land until they pass." },
    pending: { tone: "busy", text: "Its checks are still running." },
    none: { tone: "attention", text: "It no longer merges cleanly." },
    passing: { tone: "attention", text: "It no longer merges cleanly." },
  },
};

/**
 * What is provably wrong with this Mate's Git setup, in the order a person
 * would fix it. Empty when nothing has been proved wrong — which is not the
 * same as everything being fine, and is why nothing is ever phrased as "ready".
 */
export function gitTrouble(evidence: GitBlockEvidence): string {
  if (evidence.remoteReachable === false) {
    const detail = evidence.remoteDetail?.trim() ?? "";
    return detail.length === 0
      ? "Its remote did not answer."
      : detail.slice(0, ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS);
  }
  return "";
}

/**
 * Whether a verb runs in the Mate's container, against the remote.
 *
 * The same verbs the owner-only gate covers, and for the same reason — they
 * run as the agent's user, over the container's own credential. A setup proved
 * broken is exactly the setup those verbs need, so they are not offered:
 * pressing one would spend a round trip to arrive at the sentence the block is
 * already showing. Gitea-side verbs are unaffected — they run as the person,
 * from the browser, and the container's remote is not in their path.
 */
function runsInTheContainer(action: GitBlockAction): boolean {
  return action.kind === "push" || action.kind === "update-from-main";
}

function stateOf(checkout: GitCheckoutState, forge: GitForgeState): GitBlockState {
  if (!forge.read) return "unread";
  if (!checkout.isRepo || forge.repository === undefined) return "no-repository";
  if (forge.pullRequest?.merged === true) return "merged";
  if (forge.pullRequest !== undefined && forge.pullRequest.state === "open") return "in-review";
  if (!checkout.hasUpstream || checkout.aheadCount > 0) return "unpushed";
  if (checkout.behindCount > 0) return "behind";
  return "untouched";
}

/**
 * The one verb, in the order the work happens: push what is local, then take
 * what is remote, then ask for it to be merged.
 *
 * A branch that *is* the default never offers a pull request — there would be
 * nothing to merge it into — and a merged one offers nothing at all: the
 * broker is deploying it, and the person's part is over.
 */
function actionOf(
  checkout: GitCheckoutState,
  forge: GitForgeState,
  state: GitBlockState,
): GitBlockAction | undefined {
  if (state === "unread" || state === "no-repository" || state === "merged") return undefined;
  if (state === "unpushed" && checkout.isRepo) {
    return { kind: "push", label: "Push", running: "Pushing…", ownerOnly: true };
  }
  if (checkout.behindCount > 0) {
    return {
      kind: "update-from-main",
      label: "Update from main",
      running: "Updating…",
      ownerOnly: true,
    };
  }
  if (state === "in-review") {
    // Gitea decides whether this person may merge; the app only offers it
    // where Gitea already said yes for that branch.
    return forge.pullRequest?.mergeable === true
      ? { kind: "merge", label: "Merge", running: "Merging…", ownerOnly: false }
      : undefined;
  }
  const defaultBranch = forge.repository?.default_branch ?? FALLBACK_DEFAULT_BRANCH;
  if (checkout.headRef === null || checkout.headRef === defaultBranch) return undefined;
  return {
    kind: "open-pull-request",
    label: "Open pull request",
    running: "Opening…",
    ownerOnly: false,
  };
}

/** One repository's block — the two lines and the verb. */
export function gitBlock(input: {
  readonly checkout: GitCheckoutState;
  readonly forge: GitForgeState;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly evidence: GitBlockEvidence;
  /** Whose Mate this is, so its own branch reads as a name rather than an id. */
  readonly mateName?: string | undefined;
}): GitBlock {
  const { checkout, forge } = input;
  const state = stateOf(checkout, forge);
  const tone = checkTone(forge.checks);
  // A merge lands on the pull request's base; without one, on the branch
  // itself — which is what a push to a source branch already does.
  const target = forge.pullRequest?.base?.ref ?? checkout.headRef;
  const environment =
    state === "unread" || state === "no-repository"
      ? // Where the branch lands is local knowledge, but its wording is not:
        // the same branch reads "runs this branch" before the forge answers
        // and "picks it up on merge" after. Said once, when it is settled.
        undefined
      : environmentForBranch(input.declarations, target);
  const picksUp =
    environment === undefined
      ? ""
      : state === "in-review"
        ? `${environment} picks it up on merge`
        : // After a merge "this branch" is not what the stage runs — the base
          // is — and the row said so directly under the branch it had left.
          state === "merged"
          ? `${environment} runs it`
          : `${environment} runs this branch`;
  const trouble = gitTrouble(input.evidence);
  const action = actionOf(checkout, forge, state);
  const baseBranch = forge.repository?.default_branch ?? FALLBACK_DEFAULT_BRANCH;
  const verdict = gitVerdict({
    state,
    checks: tone,
    checkout,
    pullRequestNumber: forge.pullRequest?.number,
    mergeable: forge.pullRequest?.mergeable !== false,
    baseBranch,
    trouble,
  });
  return {
    repository: checkout.repository,
    branch: checkout.headRef ?? FALLBACK_DEFAULT_BRANCH,
    verdict,
    checkoutLine: gitCheckoutLine(checkout, input.mateName),
    state,
    checks: tone,
    checkWord: checkWord(tone),
    checkRows: gitChecks(forge.checks),
    changed: checkout.changed,
    pullRequestNumber: forge.pullRequest?.number,
    pullRequestUrl: forge.pullRequest?.html_url,
    baseBranch,
    destination: picksUp,
    action:
      action !== undefined && trouble.length > 0 && runsInTheContainer(action) ? undefined : action,
    trouble,
  };
}

/**
 * Whether a verb may be pressed here.
 *
 * Checkout-side verbs run in the Mate's container as the agent's user, so they
 * are the **owner's** alone (D11) — an org admin who can open the Mate is not
 * the person whose agent that is. Everything else runs in Gitea as the person,
 * where Gitea's own permissions are the gate and the app adds none.
 */
export function gitActionAllowed(
  action: GitBlockAction | undefined,
  input: { readonly isOwner: boolean },
): boolean {
  if (action === undefined) return false;
  return action.ownerOnly ? input.isOwner : true;
}

/**
 * The repositories the Git tab lists: one per codebase, which is a runtime
 * service — minus the stage half of every dev/stage pair. A stage is where its
 * dev partner's code is deployed, built and unmounted; it never has a checkout,
 * and a row for it said "no repository yet" about something that will never
 * have one (the owner, 2026-09-17). Managed data services hold no repository
 * either.
 */
export function gitCheckoutHostnames(
  services: ReadonlyArray<Pick<ZeropsTopologyService, "hostname" | "group">>,
): ReadonlyArray<string> {
  const folded = foldedStageHostnames(services);
  return services
    .filter((service) => service.group === "runtimes" && !folded.has(service.hostname))
    .map((service) => service.hostname);
}
