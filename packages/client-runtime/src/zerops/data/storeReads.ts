/**
 * One-shot answers from the account's store, for a caller that asks once and awaits (the
 * container store's Mate flag, a birth's). The account holds the streams these
 * answers come from for its whole session (`inventoryDemand`), so a read takes no lease and
 * registers nothing: it waits on the store until the store states its answer, and never past its
 * deadline.
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { ManagedZeropsDataRuntime } from "./runtime.ts";
import type { ServiceRef } from "./types.ts";

/** How long a Mate flag waits for its organization's variables before it says `"unknown"`. */
export const MATE_FLAG_DEADLINE_MS = 10_000;

type Settled<Answer> = { readonly answer: Answer } | { readonly error: Error };

/**
 * Waits until `settle` maps the atom's value to an answer, or `signal` aborts, or `deadlineMs`
 * passes (`onDeadline`'s outcome).
 */
function awaitStore<Value, Answer>(input: {
  readonly atoms: AtomRegistry.AtomRegistry;
  readonly atom: Atom.Atom<Value>;
  readonly settle: (value: Value) => Settled<Answer> | null;
  readonly deadlineMs: number;
  readonly onDeadline: () => Settled<Answer>;
  readonly signal?: AbortSignal | undefined;
}): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    let done = false;
    let unsubscribe = (): void => undefined;
    const finish = (outcome: Settled<Answer>) => {
      if (done) return;
      done = true;
      unsubscribe();
      timer.interruptUnsafe();
      input.signal?.removeEventListener("abort", aborted);
      if ("answer" in outcome) resolve(outcome.answer);
      else reject(outcome.error);
    };
    const aborted = () =>
      finish({ error: new DOMException("The read was abandoned.", "AbortError") });
    const timer = Effect.runFork(
      Effect.sleep(Duration.millis(input.deadlineMs)).pipe(
        Effect.andThen(Effect.sync(() => finish(input.onDeadline()))),
      ),
    );
    if (input.signal?.aborted) {
      aborted();
      return;
    }
    input.signal?.addEventListener("abort", aborted, { once: true });
    const look = (value: Value) => {
      const outcome = input.settle(value);
      if (outcome !== null) finish(outcome);
    };
    look(input.atoms.get(input.atom));
    if (!done) unsubscribe = input.atoms.subscribe(input.atom, look);
  });
}

/**
 * `ZCP_MATE_ENABLED` for the service, from its organization's variables: `"unknown"` when their
 * stream failed or did not answer in time — never `false`, a fact a row offers Enable on (H9).
 */
export function readMateFlagFromStore(
  data: ManagedZeropsDataRuntime,
  atoms: AtomRegistry.AtomRegistry,
  service: ServiceRef,
  signal?: AbortSignal,
  deadlineMs: number = MATE_FLAG_DEADLINE_MS,
): Promise<boolean | "unknown"> {
  return awaitStore<boolean | "unknown" | "unread", boolean | "unknown">({
    atoms,
    atom: data.reads.mateFlag(service),
    settle: (flag) => (flag === "unread" ? null : { answer: flag }),
    deadlineMs,
    onDeadline: () => ({ answer: "unknown" }),
    signal,
  });
}
