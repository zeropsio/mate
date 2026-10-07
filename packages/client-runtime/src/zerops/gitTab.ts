/**
 * The Git tab's join: a branch, the Mate's change in HQ, and the environment
 * that picks it up (guide 4.5; SPEC §3.2a).
 *
 * ## Two sources, and neither may answer for the other
 *
 * Which branch a Mate is on is the **working copy's** fact. It lives in the dev
 * container and the Mate server streams it (`subscribeVcsStatus`). What the
 * Mate's work *means* outside the container is **HQ's**: its newest change in
 * the repository, open or landed, as HQ's stream tells it. And which
 * environment would pick it up on merge is HQ's too, from its record of the
 * application's environments and the branches that feed them.
 *
 * Nothing here infers one from another. In particular, *that the remote is
 * healthy* comes from a live `git ls-remote`, never from the last push having
 * worked. A tab that mixes them shows "configured" for a broken setup, which is
 * the one outcome 4.5 names.
 *
 * ## One block per repository, one answer, one verb
 *
 * A block opens with where the work stands — `Nothing is stopping it.` — and
 * carries the verb that moves it. Under the answer, quietly, the checkout it
 * was read from: the branch, what is unpushed and what is uncommitted, and
 * which environment the work lands on.
 *
 * At most one verb, and it is the one the work needs next: updating from `main`
 * before pushing is how a person loses work, so the order the verbs are offered
 * in is the order the work actually happens in. A Mate's push opens its change
 * (SPEC §3.2a), so nobody opens one here. A state that offers no verb says why
 * it offers none.
 *
 * A block whose setup has been *proved* broken says what was proved — git's own
 * line for a remote that refused — and offers no verb that would run against it.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module gitTab
 */

import { ZEROPS_GIT_REMOTE_DETAIL_MAX_CHARS } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { MergeabilityKind } from "./changeMergeability.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";
import { branchLabel } from "./mateIdentity.ts";
import type { FlowPullRequest } from "./projectFlow.ts";
import { REVIEW_LABEL } from "./reviewVerdict.ts";
import { foldedStageHostnames } from "./serviceMap.ts";
import type { ZeropsTopologyService } from "./topology.ts";

/** What the container says about one checkout (`subscribeVcsStatus`). */
export interface GitCheckoutState {
  /** False until the checkout owner has answered; omitted on retained clients. */
  readonly read?: boolean;
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

/** What HQ says of the Mate's work in that repository. */
export interface GitChangeState {
  /**
   * Whether HQ's stream has told the application's changes at all.
   *
   * `false` is not an answer about the work, it is the absence of one: the Git
   * tab once opened by telling a person their work did not exist, listed five
   * of their commits under that sentence, and then took the whole thing back
   * (measured on the live account, 2026-09-19).
   */
  readonly read: boolean;
  /** The Mate's newest change in the repository, open or landed (`mateChangeIn`). */
  readonly change: FlowPullRequest | undefined;
}

/**
 * A Mate's newest change in a repository, as the flow carries its application's — the open one,
 * if any, being the newest, since a Mate opens a number only while none is open. A change closed
 * without landing is no work of anybody's any more.
 */
export function mateChangeIn(
  flow: {
    readonly pullRequests: ReadonlyArray<FlowPullRequest>;
    readonly merged: ReadonlyArray<FlowPullRequest>;
  },
  mateProjectId: string | undefined,
  repository: string,
): FlowPullRequest | undefined {
  const own = (change: FlowPullRequest) =>
    change.mateProjectId === mateProjectId && change.repository === repository;
  return [...flow.pullRequests.filter(own), ...flow.merged.filter(own)].reduce<
    FlowPullRequest | undefined
  >(
    (newest, change) => (newest === undefined || change.number > newest.number ? change : newest),
    undefined,
  );
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
  /** HQ has not told the changes. Says nothing, and must not be made to. */
  "unread" | "no-repository" | "untouched" | "unpushed" | "behind" | "in-review" | "merged";

export type GitBlockActionKind = "update-from-main" | "push" | "review";

export interface GitBlockAction {
  readonly kind: GitBlockActionKind;
  readonly label: string;
  /** The verb's word while it runs — "Merging…" — so the row says so where it was pressed. */
  readonly running: string;
  /**
   * The verb runs in the container, through the Mate server, as the agent's
   * user — so only the Mate's owner may press it (D11). *Review* only opens
   * the review, which polices what it offers.
   */
  readonly ownerOnly: boolean;
}

export interface GitBlock {
  readonly repository: string;
  /** The branch the container is on. `main` for a codebase nobody has touched. */
  readonly branch: string;
  /**
   * Where this repository's work stands, and in what colour. `undefined`
   * while HQ has not told the changes — the block holds the place open rather
   * than filling it with a sentence it would have to withdraw.
   */
  readonly verdict: GitVerdict | undefined;
  /** `feature/invoices ↑3 · 2 files changed` — the checkout, under the answer. */
  readonly checkoutLine: string;
  readonly state: GitBlockState;
  /** What is changed on disk and not committed — the container's own fact. */
  readonly changed: ReadonlyArray<GitChangedFile>;
  /** The Mate's change in it, by its number, head and address at HQ. */
  readonly pullRequestNumber: number | undefined;
  readonly pullRequestHead: string | undefined;
  readonly pullRequestUrl: string | undefined;
  /** The branch the work goes onto: `main`, which every change in HQ goes onto. */
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

/** Where every change in HQ goes. */
const MAIN = "main";

/**
 * Which environment picks a branch up, from HQ's records of the application's environments.
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

/**
 * Why a change offers no *Merge*, in the words a row has space for — `null`
 * where HQ says it merges and the verb speaks for itself.
 *
 * A row that simply dropped its verb was a dead end: the merge had been
 * refused, and the menu said nothing about it, so the person was left to open
 * the change to find out. HQ's own answer is the only authority here (MU-1's
 * discipline applied to merges): nothing recomputes whether a branch merges.
 *
 * Every refusal has a word, including the red one. A row whose right edge is
 * a verb on one line and a wordless red dot on the next reads as neither, and
 * the dot's own tooltip is not an answer to a question asked by glancing (seen
 * in the harness, 2026-09-19).
 */
export function pullRequestBlockedReason(pull: {
  readonly number: number;
  readonly mergeability: MergeabilityKind;
}): string | null {
  return pullRequestBlocked(pull)?.word ?? null;
}

/** Why a pull request offers no *Merge*, the tone that says it, and who moves it. */
export interface PullRequestBlocked {
  readonly kind: "checking" | "behind" | "empty";
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
   * 2026-09-19). A merge still being worked out is the one refusal with
   * nothing to ask for — waiting is the correct move.
   */
  readonly ask: string | undefined;
}

/**
 * The same answer with its own tone, because the dot beside the word has to
 * mean the word. A branch that has fallen behind is nobody's failure and
 * nothing is running: it is the one thing on the row asking for a person,
 * which is what `attention` means.
 */
export function pullRequestBlocked(pull: {
  readonly number: number;
  readonly mergeability: MergeabilityKind;
}): PullRequestBlocked | null {
  if (pull.mergeability === "mergeable") return null;
  // Nothing in it that `main` lacks: nothing is in anybody's way, and nobody is asked anything.
  if (pull.mergeability === "empty")
    return { kind: "empty", word: "nothing to merge", tone: "off", ask: undefined };
  // Not said yet whether it merges: that is nobody's to act on, and a rebase
  // asked for on the strength of it would be work invented by the surface.
  if (pull.mergeability === "checking")
    return { kind: "checking", word: "checking", tone: "busy", ask: undefined };
  return {
    kind: "behind",
    word: "conflicts with main",
    tone: "attention",
    // Capitalised: the sentence is shown verbatim on a change's page as well
    // as written into a composer, and a page does not open mid-sentence.
    ask: `Change #${pull.number} no longer merges cleanly. Merge main into it, resolve the conflicts, and deliver it again.`,
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
  if (checkout.read === false) return "Reading repository…";
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
 * looks fine and cannot move is the trap the change's own verdict closes.
 */
export function gitVerdict(input: {
  readonly state: GitBlockState;
  readonly checkout: GitCheckoutState;
  readonly pullRequestNumber: number | undefined;
  /** Whether HQ would take the merge. Not whether it is a good idea. */
  readonly mergeability: MergeabilityKind;
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
      // The same pull request has a page of its own and a row in every list.
      // Two surfaces answering the same question in two colours is how a
      // release came to wear a rebase's amber, so the tones here are the tones
      // there — held to it by a test that reads them all. Only the words are
      // shorter: the number and the branch are already on the line above this
      // panel.
      return {
        ...IN_REVIEW[input.mergeability],
        ask:
          input.pullRequestNumber === undefined
            ? undefined
            : pullRequestBlocked({
                number: input.pullRequestNumber,
                mergeability: input.mergeability,
              })?.ask,
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
 * A change's answer, by whether HQ would take it, in this tab's words. While it
 * is not said yet whether it merges, that is what it says, never a rebase. Grey
 * for one nothing stops: no signal about it is not a good signal, the same
 * quiet its own page gives it.
 */
const IN_REVIEW: Record<MergeabilityKind, Omit<GitVerdict, "ask">> = {
  mergeable: { tone: "off", text: "Nothing is stopping it." },
  empty: { tone: "off", text: "Main already has all of it." },
  checking: { tone: "busy", text: "Checking whether it merges cleanly." },
  conflicting: { tone: "attention", text: "It no longer merges cleanly." },
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
      ? // A Mate's checkout's origin is its application's repository in HQ.
        "HQ did not answer for this repository."
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
 * already showing. *Review* is unaffected — the container's remote is not in
 * its path.
 */
function runsInTheContainer(action: GitBlockAction): boolean {
  return action.kind === "push" || action.kind === "update-from-main";
}

function stateOf(checkout: GitCheckoutState, changes: GitChangeState): GitBlockState {
  if (checkout.read === false || !changes.read) return "unread";
  if (!checkout.isRepo) return "no-repository";
  if (changes.change?.merged === true) return "merged";
  if (changes.change?.state === "open") return "in-review";
  if (!checkout.hasUpstream || checkout.aheadCount > 0) return "unpushed";
  if (checkout.behindCount > 0) return "behind";
  return "untouched";
}

/**
 * The one verb, in the order the work happens: push what is local, then take
 * what is remote, then review what is open.
 *
 * An open change offers *Review* whatever is said about it — the one door to
 * merging (pass 16, R1): the review says whether it can merge and why not. A
 * merged one offers nothing at all, and neither does pushed work with no
 * change open: the Mate's push opens its change (SPEC §3.2a).
 */
function actionOf(checkout: GitCheckoutState, state: GitBlockState): GitBlockAction | undefined {
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
    return { kind: "review", label: REVIEW_LABEL, running: REVIEW_LABEL, ownerOnly: false };
  }
  return undefined;
}

/** One repository's block — the two lines and the verb. */
export function gitBlock(input: {
  readonly checkout: GitCheckoutState;
  readonly changes: GitChangeState;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly evidence: GitBlockEvidence;
  /** Whose Mate this is, so its own branch reads as a name rather than an id. */
  readonly mateName?: string | undefined;
}): GitBlock {
  const { checkout, changes } = input;
  const change = changes.change;
  const state = stateOf(checkout, changes);
  // A merge lands on the change's base; without one, on the branch itself —
  // which is what a push to a source branch already does.
  const target = change?.baseBranch ?? checkout.headRef;
  const environment =
    state === "unread" || state === "no-repository"
      ? // Where the branch lands is local knowledge, but its wording is not:
        // the same branch reads "runs this branch" before HQ answers and
        // "picks it up on merge" after. Said once, when it is settled.
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
  const action = actionOf(checkout, state);
  const baseBranch = change?.baseBranch ?? MAIN;
  const verdict = gitVerdict({
    state,
    checkout,
    pullRequestNumber: change?.number,
    // Read only in review, which has a change.
    mergeability: change?.mergeability ?? "checking",
    baseBranch,
    trouble,
  });
  return {
    repository: checkout.repository,
    branch: checkout.read === false ? "" : (checkout.headRef ?? MAIN),
    verdict,
    checkoutLine: gitCheckoutLine(checkout, input.mateName),
    state,
    changed: checkout.changed,
    pullRequestNumber: change?.number,
    pullRequestHead: change?.headSha,
    pullRequestUrl: change?.url,
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
 * the person whose agent that is. *Review* opens the review, which polices
 * what it offers; the app adds no gate of its own.
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
