/**
 * How HQ's restart of a failed Mate stands: the one answer its Mate's row, its card and its menu
 * render. HQ runs it as its operation `mate_restart` (`mate-hq spec/protocol.md` S13d) and shows it
 * on the project in navigation, to every device, while it runs and once it failed, until the next
 * start on the project.
 *
 * Pure: no network (rule R1).
 *
 * @module data/projections/mateRestart
 */
import type { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

/** HQ's kind of a failed Mate's restart. */
const MATE_RESTART = "mate_restart";

/** How the restart HQ shows on a project stands, for the person `viewer`. */
export function mateRestartOf(
  project: { readonly hq?: { readonly operation?: HqOperation | undefined } | undefined },
  viewer: string | undefined,
): HqOperationStanding {
  return hqOperationOf(project.hq?.operation, MATE_RESTART, viewer);
}
