/**
 * The Zerops rename a move left before HQ ran moves as its operation: its receipt planned the
 * target from the names as they stood, and the Mate's menu finishes it.
 */

export interface ProjectRename {
  readonly projectId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The rename a Mate's menu still offers to finish: the one left, while its project is named as it
 * was planned from. A project renamed since has nothing left to finish.
 */
export function renameStillDue(
  left: ProjectRename | undefined,
  currentName: string,
): ProjectRename | undefined {
  return left !== undefined && left.from.trim() === currentName.trim() ? left : undefined;
}
