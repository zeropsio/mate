/** Read-only view demand and explicit person operations share the account's existing machinery. */
import * as Effect from "effect/Effect";
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  observeCredentialId,
  observeCredentialScope,
  observeRequestScope,
  type ObserveCredentialKey,
} from "../families/hqObserveCredential.ts";
import { makeOperations } from "../operations/coordinator.ts";
import { makeObserveCredentialExecutor } from "../operations/executors/hqObserveCredential.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { commitOwn, makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
export function makeObserveCredential(options: {
  readonly store: AccountStore;
  readonly api: Pick<
    HqApi,
    "observeCredential" | "authorizeObserveCredential" | "revokeObserveCredential"
  >;
  readonly makeId: () => string;
}) {
  const { store, api } = options;
  let closed = false;
  const reads = makeSettingsReads(store);
  const spec = (key: ObserveCredentialKey): SettingRead<"hqObserveCredential"> => ({
    family: "hqObserveCredential",
    id: observeCredentialId(key),
    scope: observeCredentialScope(key),
    link: `hq:observe-credential-${encodeURIComponent(observeCredentialId(key))}`,
    read: () => api.observeCredential?.(key.projectId),
    unsupported: "Update HQ to manage observe authorization.",
  });
  const publishRequest = (key: ObserveCredentialKey, requestId: string) =>
    commitOwn(
      store,
      "hqObserveCredentialRequest",
      observeRequestScope(key),
      observeCredentialId(key),
      {
        requestId,
        after: reads.started(spec(key)),
      },
    );
  const operations = makeOperations({
    store,
    makeId: options.makeId,
    executors: {
      hq: makeObserveCredentialExecutor({
        api,
        current: () => !closed,
        acknowledged: (requestId, key) => {
          if (closed) return;
          const current = readsOfState(store.state()).fact(
            "hqObserveCredentialRequest",
            observeCredentialId(key),
          );
          // No accepted receipt may expose metadata from a read started before its answer.
          if (current.kind === "known" && current.value.requestId === requestId)
            publishRequest(key, requestId);
        },
      }),
    },
  });
  const act = async (key: ObserveCredentialKey, verb: "authorize" | "revoke") => {
    if (closed) return;
    const fact = readsOfState(store.state()).fact(
      "hqObserveCredentialRequest",
      observeCredentialId(key),
    );
    // This account's own request marker: no remote read can fail or refuse it.
    if (fact.kind === "known") {
      const held = store.state().operations.get(fact.value.requestId);
      if (
        held !== undefined &&
        (held.receipt === null ||
          held.unresolved !== null ||
          ["uncertain", "uncertain-unasked"].includes(held.submission)) &&
        (held.submission === "recorded" || verb === "authorize")
      )
        return;
    }
    const requestId = options.makeId();
    publishRequest(key, requestId);
    await Effect.runPromise(
      operations.submit(
        {
          kind: verb === "authorize" ? "authorize-observe-credential" : "revoke-observe-credential",
          ...key,
        },
        requestId,
      ),
    );
    if (closed) return;
    reads.readAfterWrite(spec(key));
  };
  return {
    demand: (key: ObserveCredentialKey) => (closed ? () => {} : reads.demand(spec(key))),
    again: (key: ObserveCredentialKey) => {
      if (!closed) reads.again(spec(key));
    },
    authorize: (key: ObserveCredentialKey) => act(key, "authorize"),
    revoke: (key: ObserveCredentialKey) => act(key, "revoke"),
    close: () => {
      closed = true;
      reads.close();
    },
  };
}
