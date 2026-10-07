/** A bounded optional latency sample; unavailable samples never become a recommendation. */
import type { ZeropsLocation } from "../../zerops/api.ts";
import { locationLatencyId, locationLatencyScope } from "../families/locationLatency.ts";
import { streamOf } from "../reducer.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
import { browserTransportFetch } from "./mateTransport.ts";

const demands = new WeakMap<AccountStore, Map<string, { holders: number; release: () => void }>>();
export function demandLocationLatency({
  store,
  orgId,
  location,
  fetch = browserTransportFetch,
  now = () => performance.now(),
}: {
  readonly store: AccountStore;
  readonly orgId: string;
  readonly location: ZeropsLocation;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}): () => void {
  let held = demands.get(store);
  if (held === undefined) {
    held = new Map();
    demands.set(store, held);
  }
  const id = locationLatencyId(orgId, location);
  const scope = locationLatencyScope(orgId, id);
  let entry = held.get(id);
  if (entry === undefined) {
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(STREAM_POLICY.baselineTimeoutMs),
    ]);
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    const prior = streamOf(store.state(), scope);
    if (
      readsOfState(store.state()).fact("locationLatency", id).kind !== "known" &&
      prior.phase !== "refused" &&
      prior.fault === null
    ) {
      store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
      store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
      const generation = streamOf(store.state(), scope).generation;
      const started = now();
      void fetch(location.pingUrl, { cache: "no-store", signal })
        .then((response) => {
          if (signal.aborted || streamOf(store.state(), scope).generation !== generation) return;
          if (!response.ok) throw new Error("The location did not answer the latency sample.");
          const latencyMs = now() - started;
          if (!Number.isFinite(latencyMs) || latencyMs < 0)
            throw new Error("Invalid latency sample.");
          store.dispatch({ kind: "baseline-begin", scope, generation });
          store.dispatch({
            kind: "baseline-commit",
            scope,
            generation,
            via: "zerops-read",
            members: [id],
            rows: [
              {
                family: "locationLatency",
                id,
                value: { locationId: location.id, pingUrl: location.pingUrl, latencyMs },
                revision: { kind: "zerops", version: null },
              },
            ],
          });
          store.dispatch({
            kind: "stream",
            key: scope,
            now: 0,
            event: { kind: "baseline-committed" },
          });
        })
        .catch(() => {
          if (controller.signal.aborted || streamOf(store.state(), scope).generation !== generation)
            return;
          store.dispatch({
            kind: "stream",
            key: scope,
            now: 0,
            event: {
              kind: "fault",
              jitter: 0,
              fault: {
                outcome: "transient",
                message: "No latency sample. Choose a location directly.",
              },
            },
          });
        });
    }
    entry = {
      holders: 0,
      release: () => {
        controller.abort();
        store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "demand", demanded: false },
        });
      },
    };
    held.set(id, entry);
  }
  entry.holders++;
  const captured = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--captured.holders === 0) {
      captured.release();
      held.delete(id);
    }
  };
}
