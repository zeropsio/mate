/** Local invocation references and presentation demand; operation owners retain all remote truth. */
import { Atom } from "effect/reactivity";

export interface OutcomeInvocation {
  readonly requestId: string;
  readonly origin: string;
  readonly slot: string;
}

export function makeOutcomePresentation<Invocation extends OutcomeInvocation>() {
  return {
    invocations: Atom.make<ReadonlyArray<Invocation>>([]).pipe(Atom.keepAlive),
    origins: Atom.make<ReadonlyMap<string, number>>(new Map<string, number>()).pipe(Atom.keepAlive),
    dismissed: Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive),
  };
}

/** New submission order wins. Unresolved older requests retain a separate reference. */
export function presentOutcomes<
  Invocation extends OutcomeInvocation,
  Outcome extends { terminal: boolean },
>(
  invocations: ReadonlyArray<Invocation>,
  outcomeOf: (invocation: Invocation) => Outcome,
  origins: ReadonlyMap<string, number>,
  dismissed: ReadonlySet<string>,
) {
  const latest = new Map(invocations.map((invocation) => [invocation.slot, invocation.requestId]));
  const items = invocations.flatMap((invocation) => {
    const outcome = outcomeOf(invocation);
    if (
      outcome.terminal &&
      (latest.get(invocation.slot) !== invocation.requestId || dismissed.has(invocation.requestId))
    )
      return [];
    return [
      {
        invocation,
        outcome,
        primary: (origins.get(invocation.origin) ?? 0) > 0 ? invocation.origin : "shell",
      },
    ];
  });
  const terminals = items.filter((item) => item.outcome.terminal).slice(-16);
  return items.filter((item) => !item.outcome.terminal || terminals.includes(item));
}
