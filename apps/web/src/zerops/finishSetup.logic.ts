/**
 * *Finish setup*'s decisions, apart from the hook that runs it (`useMateActions.tsx`): whether it
 * imports a container.
 */

/**
 * The container Finish setup imports — every agent, an empty selection omitting `ZCP_AGENTS` — or
 * none: only where a read of the project's services shows no zcp (`containerMissing`) — never
 * where it has one, nor where its services are not read yet or could not be: unknown is not
 * missing — and never while a press elsewhere may still be importing it (`pressElsewhere`: HQ
 * holds it, or has not said), whose key a second import would regenerate under it. A press this
 * tab saw stop is no press elsewhere.
 */
export function finishSetupContainer(input: {
  readonly containerMissing: boolean;
  readonly pressStopped: boolean;
  readonly pressedElsewhere: boolean;
}): { readonly agents: readonly [] } | null {
  if (!input.containerMissing) return null;
  return input.pressStopped || !input.pressedElsewhere ? { agents: [] } : null;
}
