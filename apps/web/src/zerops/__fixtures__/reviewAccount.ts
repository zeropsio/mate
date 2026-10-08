/** The review screen's source answers, published through the same reducer as its HQ adapter. */
import { makeAccountStore, type DetailDemand } from "@t3tools/client-runtime/data";
import {
  changeReadId,
  changeReadRequest,
  changeReadScope,
  readsOfState,
  streamOf,
  classifyHqCall,
  accountReadsAtom,
} from "@t3tools/client-runtime/data";
import type { ChangeDetailResponse } from "@t3tools/shared/hqChanges";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/reactivity";
import type { AccountData } from "../ZeropsAccountData";

export function reviewAccount(
  read: (
    request: NonNullable<ReturnType<typeof changeReadRequest>>,
  ) => Promise<ChangeDetailResponse>,
) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const orgId = "org";
  const held = new Set<string>();
  const ask = (owner: string) => {
    const scope = changeReadScope(orgId, owner);
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
    const generation = streamOf(store.state(), scope).generation;
    store.dispatch({ kind: "baseline-begin", scope, generation });
    void read(changeReadRequest(owner)!).then(
      (value) => {
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation,
          via: "hq-stream",
          members: [changeReadId(orgId, owner)],
          rows: [
            {
              family: "hqChangeRead",
              id: changeReadId(orgId, owner),
              value,
              revision: { kind: "hq", incarnation: value.change.head ?? "empty", revision: 0 },
            },
          ],
        });
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "baseline-committed" },
        });
      },
      (cause: unknown) => {
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: {
              ...classifyHqCall(cause),
              ...(cause instanceof HqError && cause.status === 404 ? { code: "not_found" } : {}),
            },
          },
        });
      },
    );
  };
  const data = {
    data: store.data,
    orgId,
    demandDetail: (demand: DetailDemand) => {
      if (demand.family === "hqChangeRead") {
        held.add(demand.ownerId);
        if (
          readsOfState(store.state()).fact("hqChangeRead", changeReadId(orgId, demand.ownerId))
            .kind !== "known" &&
          streamOf(store.state(), changeReadScope(orgId, demand.ownerId)).phase !== "refused"
        )
          ask(demand.ownerId);
      }
      return () => {
        held.delete(demand.ownerId);
      };
    },
    retryDetail: (demand: DetailDemand) => {
      if (held.has(demand.ownerId)) {
        store.dispatch({
          kind: "stream",
          key: changeReadScope(orgId, demand.ownerId),
          now: 0,
          event: { kind: "manual-retry" },
        });
        ask(demand.ownerId);
      }
    },
  } as unknown as AccountData;
  registry.set(accountReadsAtom, data);
  return { registry, data };
}
