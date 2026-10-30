/** Read-only HQ status, refreshed by acknowledged automatic ZCP establishment. */
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  observeCredentialId,
  observeCredentialScope,
  type ObserveCredentialKey,
} from "../families/hqObserveCredential.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
export function makeObserveCredential(options: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "observeCredential">;
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
  const following = new Map<string, { count: number; readonly stop: () => void }>();
  return {
    demand: (key: ObserveCredentialKey) => {
      if (closed) return () => {};
      const setting = spec(key);
      const release = reads.demand(setting);
      const id = observeCredentialId(key);
      const held = following.get(id);
      if (held !== undefined) held.count++;
      else {
        const signature = () =>
          JSON.stringify(readsOfState(store.state()).fact("hqObserveCredentialRequest", id));
        let seen = signature();
        const stop = store.subscribe(() => {
          const next = signature();
          if (next === seen) return;
          seen = next;
          // HQ acknowledged changed credential input: fence every earlier metadata read.
          reads.again(setting);
        });
        following.set(id, { count: 1, stop });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        const held = following.get(id);
        if (held === undefined || --held.count > 0) return;
        following.delete(id);
        held.stop();
      };
    },
    again: (key: ObserveCredentialKey) => {
      if (!closed) reads.again(spec(key));
    },
    close: () => {
      closed = true;
      for (const held of following.values()) held.stop();
      following.clear();
      reads.close();
    },
  };
}
