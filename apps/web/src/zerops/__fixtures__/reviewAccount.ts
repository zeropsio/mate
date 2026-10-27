/** The review screen's source answers, published through the same reducer as its HQ adapter. */
import { makeAccountStore, type DetailDemand } from "@t3tools/client-runtime/data";
import {
  changeReadId,
  changeReadRequest,
  changeMetadataScope,
  changeCommitsScope,
  readsOfState,
  streamOf,
  classifyHqCall,
  accountReadsAtom,
} from "@t3tools/client-runtime/data";
import type { ChangeMetadataResponse, ChangeCommitsResponse } from "@t3tools/shared/hqChanges";
import { HqError } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/reactivity";
import type { AccountData } from "../ZeropsAccountData";

type Family = "hqChangeMetadata" | "hqChangeCommits";

export function reviewAccount(
  metadata: (
    request: NonNullable<ReturnType<typeof changeReadRequest>>,
  ) => Promise<ChangeMetadataResponse>,
  commits?: (
    request: NonNullable<ReturnType<typeof changeReadRequest>>,
  ) => Promise<ChangeCommitsResponse>,
) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const orgId = "org";
  const held = new Set<string>();
  const scopeOf = (family: Family, owner: string) =>
    (family === "hqChangeMetadata" ? changeMetadataScope : changeCommitsScope)(orgId, owner);
  const ask = (family: Family, owner: string) => {
    const scope = scopeOf(family, owner);
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
    // A scenario that reads no commits gets a reader that refuses them.
    const reader: (
      request: NonNullable<ReturnType<typeof changeReadRequest>>,
    ) => Promise<ChangeMetadataResponse | ChangeCommitsResponse> =
      family === "hqChangeMetadata"
        ? metadata
        : (commits ?? (() => Promise.reject(new Error("This scenario reads no commits."))));
    void reader(changeReadRequest(owner)!).then(
      (value) => {
        store.dispatch({
          kind: "baseline-commit",
          scope,
          generation,
          via: "hq-stream",
          members: [changeReadId(orgId, owner)],
          rows: [
            {
              family,
              id: changeReadId(orgId, owner),
              value,
              revision: { kind: "hq", incarnation: value.change.head ?? "empty", revision: 0 },
            } as Extract<
              Parameters<typeof store.dispatch>[0],
              { kind: "baseline-commit" }
            >["rows"][number],
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
      if (demand.family === "hqChangeMetadata" || demand.family === "hqChangeCommits") {
        held.add(demand.ownerId);
        if (
          readsOfState(store.state()).fact(demand.family, changeReadId(orgId, demand.ownerId))
            .kind !== "known" &&
          streamOf(store.state(), scopeOf(demand.family, demand.ownerId)).phase !== "refused"
        )
          ask(demand.family, demand.ownerId);
      }
      return () => {
        held.delete(demand.ownerId);
      };
    },
    retryDetail: (demand: DetailDemand) => {
      if (held.has(demand.ownerId)) {
        store.dispatch({
          kind: "stream",
          key: scopeOf(demand.family as Family, demand.ownerId),
          now: 0,
          event: { kind: "manual-retry" },
        });
        ask(demand.family as Family, demand.ownerId);
      }
    },
  } as unknown as AccountData;
  registry.set(accountReadsAtom, data);
  return { registry, data, store };
}
