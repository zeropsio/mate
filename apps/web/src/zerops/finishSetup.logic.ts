/**
 * *Finish setup*'s decisions, apart from the hook that runs it (`useMateActions.tsx`): whether it
 * imports a container.
 */

/**
 * The container Finish setup imports — every agent, an empty selection omitting `ZCP_AGENTS` — or
 * none: never where the project has one, and never while a press elsewhere may still be importing
 * it (`pressElsewhere`: HQ holds it, or has not said), whose key a second import would regenerate
 * under it. A press this tab saw stop is no press elsewhere.
 */
export function finishSetupContainer(input: {
  readonly hasService: boolean;
  readonly pressStopped: boolean;
  readonly pressedElsewhere: boolean;
}): { readonly agents: readonly [] } | null {
  if (input.hasService) return null;
  return input.pressStopped || !input.pressedElsewhere ? { agents: [] } : null;
}
