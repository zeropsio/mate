/**
 * One-shot answers from the account's store, for a caller that asks once and awaits (a group's
 * deploy rows, the container store's Mate flag, a birth's). Each holds the streams its answer
 * needs while it waits, answers from the store as soon as the store states it, and reads nothing
 * of its own.
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { Shown } from "../knowledge/known.ts";
import type { ZeropsServiceDeployedVersion } from "./deployedVersion.ts";
import type { ManagedZeropsDataRuntime } from "./runtime.ts";
import type { RuntimeInterestDescriptor, ServiceRef } from "./types.ts";

/**
 * Holds `descriptors` and waits until `settle` maps the atom's value to an answer, or `signal`
 * aborts, or `deadlineMs` passes (`onDeadline`'s answer).
 */
function awaitStore<Value, Answer>(input: {
  readonly data: ManagedZeropsDataRuntime;
  readonly atoms: AtomRegistry.AtomRegistry;
  readonly descriptors: ReadonlyArray<RuntimeInterestDescriptor>;
  readonly atom: Atom.Atom<Value>;
  readonly settle: (value: Value) => { readonly answer: Answer } | { readonly error: Error } | null;
  readonly signal?: AbortSignal | undefined;
  readonly deadlineMs?: number | undefined;
  readonly onDeadline?: (() => Answer) | undefined;
  readonly services?: Context.Context<never> | undefined;
}): Promise<Answer> {
  const run = Effect.runForkWith(input.services ?? Context.empty());
  return new Promise<Answer>((resolve, reject) => {
    const leases = input.descriptors.map((descriptor) =>
      run(
        Effect.scoped(input.data.acquire(descriptor).pipe(Effect.andThen(Effect.never))).pipe(
          Effect.ignore,
        ),
      ),
    );
    let done = false;
    let unsubscribe = (): void => undefined;
    let timer: Fiber.Fiber<void> | undefined;
    const finish = (outcome: { readonly answer: Answer } | { readonly error: Error }) => {
      if (done) return;
      done = true;
      unsubscribe();
      if (timer !== undefined) run(Fiber.interrupt(timer));
      input.signal?.removeEventListener("abort", aborted);
      for (const lease of leases) run(Fiber.interrupt(lease));
      if ("answer" in outcome) resolve(outcome.answer);
      else reject(outcome.error);
    };
    const look = (value: Value) => {
      const outcome = input.settle(value);
      if (outcome !== null) finish(outcome);
    };
    const aborted = () =>
      finish({ error: new DOMException("The read was abandoned.", "AbortError") });
    if (input.signal?.aborted) {
      aborted();
      return;
    }
    input.signal?.addEventListener("abort", aborted, { once: true });
    if (input.deadlineMs !== undefined && input.onDeadline !== undefined) {
      const onDeadline = input.onDeadline;
      timer = run(
        Effect.sleep(Duration.millis(input.deadlineMs)).pipe(
          Effect.andThen(Effect.sync(() => finish({ answer: onDeadline() }))),
        ),
      );
    }
    look(input.atoms.get(input.atom));
    if (!done) unsubscribe = input.atoms.subscribe(input.atom, look);
  });
}

/**
 * What the service runs, once the store states it; rejects when its streams failed for good or
 * `signal` aborted.
 */
export function readDeployedVersion(
  data: ManagedZeropsDataRuntime,
  atoms: AtomRegistry.AtomRegistry,
  service: ServiceRef,
  signal?: AbortSignal,
): Promise<ZeropsServiceDeployedVersion> {
  const organization = service.project.organization;
  return awaitStore<Shown<ZeropsServiceDeployedVersion>, ZeropsServiceDeployedVersion>({
    data,
    atoms,
    descriptors: [
      { kind: "project-inventory", project: service.project },
      { kind: "organization-versions", organization },
      { kind: "organization-variables", organization },
    ],
    atom: data.reads.deployedVersion(service),
    settle: (shown) =>
      shown.state === "known"
        ? { answer: shown.value }
        : shown.state === "gone" || (shown.state === "failed" && shown.retryAtMs === null)
          ? { error: new Error(`What the service runs could not be read (${shown.state}).`) }
          : null,
    signal,
  });
}

/** How long a Mate flag waits for its organization's variables before it says `"unknown"`. */
export const MATE_FLAG_DEADLINE_MS = 20_000;

/**
 * `ZCP_MATE_ENABLED` for the service, from its organization's variables: `"unknown"` when their
 * stream failed or did not answer in time — never `false`, a fact a row offers Enable on (H9).
 */
export function readMateFlagFromStore(
  data: ManagedZeropsDataRuntime,
  atoms: AtomRegistry.AtomRegistry,
  service: ServiceRef,
  services?: Context.Context<never>,
): Promise<boolean | "unknown"> {
  return awaitStore<boolean | "unknown" | "unread", boolean | "unknown">({
    data,
    atoms,
    descriptors: [{ kind: "organization-variables", organization: service.project.organization }],
    atom: data.reads.mateFlag(service),
    settle: (flag) => (flag === "unread" ? null : { answer: flag }),
    deadlineMs: MATE_FLAG_DEADLINE_MS,
    onDeadline: () => "unknown",
    services,
  });
}
