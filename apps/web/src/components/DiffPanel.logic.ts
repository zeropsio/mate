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
