/**
 * *Finish setup*'s decisions, apart from the hook that runs it (`useMateActions.tsx`): when a
 * Mate's project is past the grace a press elsewhere has, and whether it imports a container.
 */
import { MATE_CONTAINER_GRACE_MS } from "./mateComing";

/** Its project is older than a press in another browser could still be working on it. */
export function mateProjectPastGrace(
  project: { readonly created?: string | undefined },
  nowMs: number,
): boolean {
  const created = project.created === undefined ? Number.NaN : Date.parse(project.created);
  return !Number.isNaN(created) && nowMs - created > MATE_CONTAINER_GRACE_MS;
}

/**
 * The container Finish setup imports — every agent, an empty selection omitting `ZCP_AGENTS` — or
 * none: never where the project has one, and never while a press elsewhere may still be importing
 * it, whose key a second import would regenerate under it. A press this tab saw stop is no press
 * elsewhere.
 */
export function finishSetupContainer(input: {
  readonly hasService: boolean;
  readonly pressStopped: boolean;
  readonly pastGrace: boolean;
}): { readonly agents: readonly [] } | null {
  if (input.hasService) return null;
  return input.pressStopped || input.pastGrace ? { agents: [] } : null;
}
