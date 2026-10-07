/** Composite execution records progress and child outcomes through the account reducer. */
import { Atom } from "effect/unstable/reactivity";
import type { AccountStore } from "../../store.ts";
import type { CreationPressResult } from "../creationPress.ts";
import { operationResult } from "../../model.ts";
export const creationPressStoreAtom = Atom.make<AccountStore | null>(null).pipe(Atom.keepAlive);
export function beginCreationPress(
  store: AccountStore,
  requestId: string,
  orgId: string,
  projectId: string,
) {
  store.dispatch({
    kind: "operation-recorded",
    requestId,
    intent: { kind: "creation-press", orgId, projectId },
  });
  recordCreationProgress(store, requestId, { state: { kind: "pressing" }, progress: [] });
}
export function recordCreationProgress(
  store: AccountStore,
  requestId: string,
  update: Partial<CreationPressResult>,
) {
  const record = store.state().operations.get(requestId);
  if (record === undefined) throw new Error("A press must be recorded before its execution.");
  const previous = operationResult(record, "creation-press");
  if (previous === undefined && (update.state === undefined || update.progress === undefined))
    throw new Error("A press must have an initial execution state.");
  const result = {
    progress: update.progress ?? previous!.progress,
    state: update.state ?? previous!.state,
  };
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      requestId,
      operationId: requestId,
      executor: "zerops",
      affected: [],
      handles: [record.intent.kind === "creation-press" ? record.intent.projectId : ""],
      acceptance: { kind: "accepted", result },
      outcome:
        result.state.kind === "pressing" ||
        (result.state.kind === "failed" && result.state.uncertain === true)
          ? { kind: "pending" }
          : result.state.kind === "pressed"
            ? { kind: "succeeded", evidence: "The press's child operations answered and finished." }
            : { kind: "failed", evidence: result.state.reason },
    },
  });
  if (result.state.kind === "failed" && result.state.uncertain === true)
    store.dispatch({
      kind: "operation-exhausted",
      requestId,
      unobservable: {
        nextActor: "person",
        nextAction: "Inspect the accepted project and its operation before continuing setup.",
        reason: result.state.reason,
      },
    });
}
