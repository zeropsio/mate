import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

export interface CheckpointDiffTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly fromTurnCount: number | null;
  readonly toTurnCount: number | null;
  readonly ignoreWhitespace: boolean;
  readonly rootId?: string;
  readonly runId?: string;
  readonly cacheScope?: string | null;
}

export function normalizeComposerPathSearchQuery(query: string | null): string {
  return query?.trim() ?? "";
}

export function buildCheckpointDiffTargets(target: CheckpointDiffTarget) {
  if (
    target.environmentId === null ||
    target.threadId === null ||
    target.fromTurnCount === null ||
    target.toTurnCount === null
  ) {
    return { fullThread: null, turn: null } as const;
  }

  if (target.fromTurnCount === 0 && target.runId === undefined) {
    return {
      fullThread: {
        environmentId: target.environmentId,
        ...(target.cacheScope == null ? {} : { cacheScope: target.cacheScope }),
        input: {
          threadId: target.threadId,
          toTurnCount: target.toTurnCount,
          ignoreWhitespace: target.ignoreWhitespace,
          ...(target.rootId === undefined ? {} : { rootId: target.rootId }),
          ...(target.runId === undefined ? {} : { runId: target.runId }),
        },
      },
      turn: null,
    } as const;
  }

  return {
    fullThread: null,
    turn: {
      environmentId: target.environmentId,
      ...(target.cacheScope == null ? {} : { cacheScope: target.cacheScope }),
      input: {
        threadId: target.threadId,
        fromTurnCount: target.fromTurnCount,
        toTurnCount: target.toTurnCount,
        ignoreWhitespace: target.ignoreWhitespace,
        ...(target.rootId === undefined ? {} : { rootId: target.rootId }),
        ...(target.runId === undefined ? {} : { runId: target.runId }),
      },
    },
  } as const;
}
