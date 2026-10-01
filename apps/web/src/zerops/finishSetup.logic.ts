/**
 * *Finish setup*'s decisions, apart from the hook that runs it (`useMateActions.tsx`): when a
 * Mate's project is past the grace a press elsewhere has, whether it imports a container, and
 * what a Mate in no group is offered.
 */
import { FINISH_MATE_SETUP_VERB } from "@t3tools/client-runtime/zerops";

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

/**
 * Finish setup on a Mate in no group — one claimed from the pool: offered where its harden stopped
 * in this tab, and then only the harden and the close-off run again.
 */
export function finishSetupVerbForUngrouped(input: {
  readonly pressStopped: boolean;
}): string | undefined {
  return input.pressStopped ? FINISH_MATE_SETUP_VERB : undefined;
}
