import { checkoutLabel, type CheckoutLease } from "@t3tools/client-runtime/zerops";
import type { Crewmate, VcsListRefsResult, VcsStatusResult } from "@t3tools/contracts";
import { collectionPresentation, type EnvironmentQueryView } from "../state/query";
import { buildBaseRefChoices } from "../lib/baseRefChoices";
import { checkoutPathFor } from "../zerops/useZeropsGitRemoteProbe";

import type { DiffPanelSelection } from "../diffPanelStore";

/** A repository a conversation's Diff reads: a Mate's checkout by its service, or its own. */
export interface DiffRepository {
  readonly name: string;
  readonly cwd: string;
}

/**
 * The repositories a conversation's Diff reads, as its agent works in them; `null` while that is
 * still read. A crewmate who writes works in its own copy of its service's checkout
 * (`.crew/<handle>`, on `crew/<handle>`), as its crew places it (`CrewWorkspaceDirectory` on the
 * server); every other conversation in the Mate's checkouts (`checkouts`, a bound thread's leases
 * alone, each named `<pool> · <branch>`), else its own folder.
 */
export function diffRepositories(input: {
  readonly checkouts: ReadonlyArray<string> | null;
  readonly cwd: string | null;
  /** A crewmate's conversation's crewmate; `undefined` while its crew is read, else `null`. */
  readonly crewmate: Pick<Crewmate, "handle" | "kind" | "host"> | null | undefined;
  /** The thread's leases (`threadLeases`), which name their checkouts; none for none. */
  readonly leases: ReadonlyArray<CheckoutLease>;
}): ReadonlyArray<DiffRepository> | null {
  const { checkouts, cwd, crewmate } = input;
  if (crewmate === undefined) return null;
  if (crewmate?.kind === "writer" && crewmate.host !== null) {
    const copy = `${crewmate.host}/.crew/${crewmate.handle}`;
    return [{ name: copy, cwd: checkoutPathFor(copy) }];
  }
  if (checkouts === null) return null;
  if (checkouts.length > 0) {
    return checkouts.map((hostname) => ({
      name: checkoutLabel(hostname, input.leases),
      cwd: checkoutPathFor(hostname),
    }));
  }
  return cwd === null
    ? []
    : [{ name: cwd.split("/").findLast((part) => part.length > 0) ?? cwd, cwd }];
}

/** What git says of a repository now: its status, the record the Git page reads too. */
export type DiffRepositoryStatus = VcsStatusResult | "reading" | "failed";

export interface DiffRepositoryRead {
  readonly repository: DiffRepository;
  readonly status: DiffRepositoryStatus;
}

/** One thing Diff can show: a repository's changes not committed, or its commits not on main. */
export interface DiffChoice {
  readonly repository: DiffRepository;
  readonly scope: "unstaged" | "branch";
  /** In the Git page's words. */
  readonly label: string;
  /** Files not committed, or commits not on main; `null` where git has not said or cannot. */
  readonly count: number | null;
  /** What the body says when there is nothing to show. */
  readonly nothing: string;
  /**
   * What git compares the commits with unless the person chose: on main, its upstream, so every
   * Mate's server shows the commits not pushed that `count` counts (an older one compares main
   * with nothing); elsewhere `null`, the server's main.
   */
  readonly baseRef: string | null;
}

/** How many there are, as the menu says it. */
export function diffChoiceCount(choice: DiffChoice): string | null {
  if (choice.count === null) return null;
  const noun = choice.scope === "unstaged" ? "file" : "commit";
  return `${choice.count} ${noun}${choice.count === 1 ? "" : "s"}`;
}

/**
 * What each repository has that is not on main yet: what is changed and not committed, and the
 * commits of its branch that main does not have — on main itself, the ones not pushed. A folder
 * git says is no repository offers nothing.
 */
export function diffChoices(reads: ReadonlyArray<DiffRepositoryRead>): ReadonlyArray<DiffChoice> {
  return reads.flatMap(({ repository, status }): ReadonlyArray<DiffChoice> => {
    if (typeof status === "object" && !status.isRepo) return [];
    const read = typeof status === "object" ? status : null;
    const onMain = read?.isDefaultRef === true;
    const neverPushed = onMain && read?.hasUpstream === false;
    return [
      {
        repository,
        scope: "unstaged",
        label: "Not committed",
        count: read === null ? null : read.workingTree.files.length,
        nothing: `Everything in ${repository.name} is committed.`,
        baseRef: null,
      },
      {
        repository,
        scope: "branch",
        label: onMain ? "Not pushed" : "Not on main",
        count:
          read === null || neverPushed
            ? null
            : onMain
              ? read.aheadCount
              : (read.aheadOfDefaultCount ?? null),
        nothing: neverPushed
          ? `${repository.name} has never been pushed: there is nothing to compare it with.`
          : onMain
            ? `Everything in ${repository.name} is pushed.`
            : `Nothing in ${repository.name} is outside main.`,
        baseRef: onMain && !neverPushed ? "@{upstream}" : null,
      },
    ];
  });
}

export type DiffShown =
  | { readonly kind: "reading" }
  | { readonly kind: "no-code" }
  | { readonly kind: "nothing-outside-main" }
  | { readonly kind: "choice"; readonly choice: DiffChoice };

/**
 * What Diff shows; `reads` is `null` while which repositories there are is still read. A choice
 * the person made stands while its repository is there. Otherwise, once git has said of every
 * repository, the first with changes of the stored kind (not committed, unless they chose the
 * branch), then of the other, then the first git cannot count; else nothing is outside main.
 */
export function shownDiff(
  reads: ReadonlyArray<DiffRepositoryRead> | null,
  selection: DiffPanelSelection,
): DiffShown {
  if (reads === null) return { kind: "reading" };
  const choices = diffChoices(reads);
  const chosen =
    selection.repository === undefined
      ? undefined
      : choices.find(
          (choice) =>
            choice.repository.name === selection.repository && choice.scope === selection.kind,
        );
  if (chosen !== undefined) return { kind: "choice", choice: chosen };
  if (reads.some((read) => read.status === "reading")) return { kind: "reading" };
  const other = selection.kind === "unstaged" ? "branch" : "unstaged";
  const picked =
    choices.find((choice) => choice.scope === selection.kind && (choice.count ?? 0) > 0) ??
    choices.find((choice) => choice.scope === other && (choice.count ?? 0) > 0) ??
    choices.find((choice) => choice.count === null);
  if (picked !== undefined) return { kind: "choice", choice: picked };
  return choices.length === 0 ? { kind: "no-code" } : { kind: "nothing-outside-main" };
}

export function baseRefPresentation(
  local: EnvironmentQueryView<VcsListRefsResult>,
  remote: EnvironmentQueryView<VcsListRefsResult>,
  headRef?: string | null,
) {
  const labels = { loading: "Loading refs...", unavailable: "Refs unavailable." };
  const localView = collectionPresentation(
    local,
    (data) => data.refs.filter((ref) => ref.name !== headRef),
    labels,
  );
  const remoteView = collectionPresentation(remote, (data) => data.refs, labels);
  const messages = [
    ...new Set([localView.message, remoteView.message].filter((message) => message !== null)),
  ];
  return {
    choices: buildBaseRefChoices(localView.items, remoteView.items),
    canRetry: localView.state === "failed" || remoteView.state === "failed",
    retained: localView.retained || remoteView.retained,
    message: messages.length > 0 ? messages.join(" ") : null,
    emptyMessage:
      localView.state === "ready" && remoteView.state === "ready" ? "No matching refs." : null,
  };
}
