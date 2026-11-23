/**
 * How a project's move stands: the one answer its Mate's row, its card and its menu render. HQ runs
 * the move as its operation `project_move` (`mate-hq spec/protocol.md` S13d): the placement is
 * written by the start, then HQ renames the project in Zerops after its application, and shows the
 * operation on the project in navigation, to every device, while it runs and once it failed, until
 * the next start on the project.
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/projectMove
 */
import type { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

/** HQ's kind of a project's move. */
const PROJECT_MOVE = "project_move";

/** HQ's failure code of a move whose project Zerops shows renamed by someone else since it planned. */
const RENAMED_SINCE = "renamed_since";

export type ProjectMove =
  | HqOperationStanding
  /** Placed, but Zerops shows a name someone gave it since: HQ wrote nothing, and it keeps it. */
  | { readonly kind: "renamed-since" };

/** How the move HQ shows on a project stands, for the person `viewer`. */
export function projectMoveOf(
  project: { readonly hq?: { readonly operation?: HqOperation | undefined } | undefined },
  viewer: string | undefined,
): ProjectMove {
  const move = hqOperationOf(project.hq?.operation, PROJECT_MOVE, viewer);
  return move.kind === "failed" && move.failure.code === RENAMED_SINCE
    ? { kind: "renamed-since" }
    : move;
}
