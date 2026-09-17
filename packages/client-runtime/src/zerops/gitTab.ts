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
 * ## One block per repository, one verb
 *
 * A block is two lines. The first is the checkout —
 * `api · feature/invoices ↑3 ↓0 · 2 files changed`. The second is where it
 * goes. Under them, at most one verb: you cannot open a pull request for a
 * branch you have not pushed, and updating from `main` before pushing is how a
 * person loses work, so the order the verbs are offered in is the order the
 * work actually happens in.
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

import type { GiteaCommitStatus, GiteaPullRequest, GiteaRepository } from "./giteaClient.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";
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
  /** How many files the working tree has changed. */
  readonly changedFiles: number;
}

/** What Gitea says about that repository and branch, answering as the person. */
export interface GitForgeState {
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
  | "no-repository"
  | "untouched"
  | "unpushed"
  | "behind"
  | "in-review"
  | "merged";

/** How the checks on the branch's head went — a dot's tone, with one word. */
export type GitCheckTone = "none" | "pending" | "passing" | "failing";

export type GitBlockActionKind = "open-pull-request" | "update-from-main" | "push" | "merge";

export interface GitBlockAction {
  readonly kind: GitBlockActionKind;
  readonly label: string;
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
  /** `api · feature/invoices ↑3 ↓0 · 2 files changed`. */
  readonly headLine: string;
  readonly state: GitBlockState;
  readonly checks: GitCheckTone;
  /** `undefined` when no word belongs beside the dot — no checks ran. */
  readonly checkWord: string | undefined;
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

/** `api · feature/invoices ↑3 ↓0 · 2 files changed`. */
export function gitHeadLine(checkout: GitCheckoutState): string {
  if (!checkout.isRepo) return `${checkout.repository} · no repository yet`;
  const branch = checkout.headRef ?? "detached";
  const counts = checkout.hasUpstream
    ? ` ↑${checkout.aheadCount} ↓${checkout.behindCount}`
    : " not pushed";
  const changed =
    checkout.changedFiles === 0
      ? ""
      : ` · ${checkout.changedFiles} file${checkout.changedFiles === 1 ? "" : "s"} changed`;
  return `${checkout.repository} · ${branch}${counts}${changed}`;
}

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
  if (state === "no-repository" || state === "merged") return undefined;
  if (state === "unpushed" && checkout.isRepo) {
    return { kind: "push", label: "Push", ownerOnly: true };
  }
  if (checkout.behindCount > 0) {
    return { kind: "update-from-main", label: "Update from main", ownerOnly: true };
  }
  if (state === "in-review") {
    // Gitea decides whether this person may merge; the app only offers it
    // where Gitea already said yes for that branch.
    return forge.pullRequest?.mergeable === true
      ? { kind: "merge", label: "Merge", ownerOnly: false }
      : undefined;
  }
  const defaultBranch = forge.repository?.default_branch ?? FALLBACK_DEFAULT_BRANCH;
  if (checkout.headRef === null || checkout.headRef === defaultBranch) return undefined;
  return { kind: "open-pull-request", label: "Open pull request", ownerOnly: false };
}

/** One repository's block — the two lines and the verb. */
export function gitBlock(input: {
  readonly checkout: GitCheckoutState;
  readonly forge: GitForgeState;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  readonly evidence: GitBlockEvidence;
}): GitBlock {
  const { checkout, forge } = input;
  const state = stateOf(checkout, forge);
  const tone = checkTone(forge.checks);
  // A merge lands on the pull request's base; without one, on the branch
  // itself — which is what a push to a source branch already does.
  const target = forge.pullRequest?.base?.ref ?? checkout.headRef;
  const environment =
    state === "no-repository" ? undefined : environmentForBranch(input.declarations, target);
  const picksUp =
    environment === undefined
      ? ""
      : state === "in-review"
        ? `${environment} picks it up on merge`
        : `${environment} runs this branch`;
  const trouble = gitTrouble(input.evidence);
  const action = actionOf(checkout, forge, state);
  return {
    repository: checkout.repository,
    branch: checkout.headRef ?? FALLBACK_DEFAULT_BRANCH,
    headLine: gitHeadLine(checkout),
    state,
    checks: tone,
    checkWord: checkWord(tone),
    pullRequestNumber: forge.pullRequest?.number,
    pullRequestUrl: forge.pullRequest?.html_url,
    baseBranch: forge.repository?.default_branch ?? FALLBACK_DEFAULT_BRANCH,
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
