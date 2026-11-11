/**
 * Read-only HQ status, read once per demand and replaced by HQ's answer to our establishment of a
 * ZCP context, which names the status as it stands after it.
 */
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  observeCredentialId,
  observeCredentialScope,
  type ObserveCredentialKey,
} from "../families/hqObserveCredential.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
import { hqNeedsUpdate } from "../../zerops/hq/refusals.ts";
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
    unsupported: hqNeedsUpdate("manage observe authorization"),
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
        const request = () => readsOfState(store.state()).fact("hqObserveCredentialRequest", id);
        const first = request();
        // The answer last acted on, by its own identity: a read is a new object on every call.
        let seen = first.kind === "known" ? first.value.requestId : null;
        const stop = store.subscribe(() => {
          const next = request();
          if (next.kind !== "known" || next.value.requestId === seen) return;
          seen = next.value.requestId;
          // HQ answered our establishment with the status after it: that answer is the status.
          reads.answered(setting, next.value.answer);
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
