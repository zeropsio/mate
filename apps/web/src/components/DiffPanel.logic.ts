import type { VcsListRefsResult } from "@t3tools/contracts";
import { collectionPresentation, type EnvironmentQueryView } from "../state/query";
import { buildBaseRefChoices } from "../lib/baseRefChoices";
import type { TurnId } from "@t3tools/contracts";

import type { DiffPanelSelection } from "../diffPanelStore";

export interface CheckpointDiffAvailability {
  readonly enabled: boolean;
  readonly showNotRepository: boolean;
}

export function resolveCheckpointDiffAvailability(input: {
  readonly hasActiveThread: boolean;
  readonly hasSelectedTurn: boolean;
  readonly isTurnScope: boolean;
  readonly isGitRepo: boolean;
}): CheckpointDiffAvailability {
  return {
    enabled: input.hasActiveThread && input.hasSelectedTurn,
    showNotRepository: input.hasActiveThread && !input.isTurnScope && !input.isGitRepo,
  };
}

/**
 * What Diff shows for the stored selection. A workspace that is no Git
 * repository of its own — a Mate's `/var/www`, whose code is in the services'
 * checkouts below it — has no working tree or branch to read, but every turn
 * keeps a saved diff of those checkouts: there a selection that is not a turn
 * reads as the latest turn, and as nothing to show before the first one.
 */
export function resolveDiffSelection(input: {
  readonly selection: DiffPanelSelection;
  readonly isGitRepo: boolean;
  readonly latestTurnId: TurnId | undefined;
}): DiffPanelSelection | { readonly kind: "no-turns" } {
  if (input.isGitRepo || input.selection.kind === "turn") return input.selection;
  return input.latestTurnId === undefined
    ? { kind: "no-turns" }
    : { kind: "turn", turnId: input.latestTurnId, filePath: null, revealRequestId: 0 };
}

/**
 * What the scope button names, and which of its menu's items is marked: the
 * selection the body shows. Before the first turn of a workspace that shows
 * only turns, that is the latest turn, which is not there yet.
 */
export function diffScope(input: {
  readonly shown: ReturnType<typeof resolveDiffSelection>;
  readonly latestTurnId: TurnId | undefined;
}): "unstaged" | "branch" | "latest" | "turn" {
  switch (input.shown.kind) {
    case "unstaged":
    case "branch":
      return input.shown.kind;
    case "no-turns":
      return "latest";
    case "turn":
      return input.shown.turnId === input.latestTurnId ? "latest" : "turn";
  }
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
    retained: localView.retained || remoteView.retained,
    message: messages.length > 0 ? messages.join(" ") : null,
    emptyMessage:
      localView.state === "ready" && remoteView.state === "ready" ? "No matching refs." : null,
  };
}
