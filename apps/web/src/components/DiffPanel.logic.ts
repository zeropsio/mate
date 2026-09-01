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
