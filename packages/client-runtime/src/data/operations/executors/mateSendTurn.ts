/** Receipt sink for the sanctioned turn command and conversation replay transport. */
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import type { AccountStore } from "../../store.ts";
import { sentAsk } from "../../projections/sentAsk.ts";
import type { SentAsk } from "../mateSendTurn.ts";

export function makeSendTurnReceipts(
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  observe?: (
    environmentId: string,
    threadId: string,
    seen: (messageIds: ReadonlyArray<string>) => void,
  ) => () => void,
) {
  let closed = false;
  // Only own-action identities are indexed here. Words and outcomes live in operation records.
  const environments = new Set<string>();
  const observations = new Map<string, () => void>();
  const latest = Atom.family((environmentId: string) =>
    Atom.make<string | null>(null).pipe(
      Atom.keepAlive,
      Atom.withLabel(`last-send:${environmentId}`),
    ),
  );
  const requestId = (environmentId: string, messageId: string) =>
    JSON.stringify(["send", environmentId, messageId]);
  const receipt = (id: string, succeeded: boolean) => {
    const record = store.state().operations.get(id);
    if (record?.intent.kind !== "mate-send-turn") return;
    if (succeeded) {
      observations.get(id)?.();
      observations.delete(id);
    }
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId: id,
        operationId: record.intent.messageId,
        executor: "mate",
        affected: [],
        handles: [record.intent.messageId],
        acceptance: { kind: "accepted" },
        outcome: succeeded
          ? { kind: "succeeded", evidence: "This exact message appeared in its conversation." }
          : { kind: "pending" },
      },
    });
  };
  return {
    requested(environmentId: string, intent: SentAsk) {
      if (closed) return;
      const id = requestId(environmentId, intent.messageId);
      store.dispatch({
        kind: "operation-recorded",
        requestId: id,
        intent: { kind: "mate-send-turn", environmentId, ...intent },
      });
      environments.add(environmentId);
      registry.set(latest(environmentId), id);
      if (observe !== undefined && !observations.has(id)) {
        const release = observe(environmentId, intent.threadId, (ids) => {
          if (!closed && ids.includes(intent.messageId)) receipt(id, true);
        });
        if (store.state().operations.get(id)?.receipt?.outcome.kind === "succeeded") release();
        else observations.set(id, release);
      }
    },
    accepted(environmentId: string, messageId: string) {
      if (!closed) receipt(requestId(environmentId, messageId), false);
    },
    failed(environmentId: string, messageId: string, mayHaveSent = true) {
      if (closed) return;
      if (!mayHaveSent) {
        const id = requestId(environmentId, messageId);
        observations.get(id)?.();
        observations.delete(id);
        store.dispatch({
          kind: "operation-unsent",
          requestId: id,
          reason: "The turn command was not sent; its words were restored to the draft.",
        });
        return;
      }
      store.dispatch({
        kind: "operation-exhausted",
        requestId: requestId(environmentId, messageId),
        unobservable: {
          nextActor: "you",
          nextAction: "Read this conversation before sending again.",
          reason: "The send did not finish here; its words were restored to the draft.",
        },
      });
    },
    atom(environmentId: string) {
      return Atom.make((get) => get(store.data.project(sentAsk, get(latest(environmentId)))));
    },
    close() {
      closed = true;
      for (const environmentId of environments) registry.set(latest(environmentId), null);
      environments.clear();
      for (const release of observations.values()) release();
      observations.clear();
    },
  };
}
