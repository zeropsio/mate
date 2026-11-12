/**
 * The organization's open read access requests, read once per demand and again after an ask or a
 * close of ours (`again`), which settles once that read has landed.
 */
import type { HqApi } from "../../zerops/hq/client.ts";
import {
  readAccessId,
  readAccessLink,
  readAccessScope,
  type ReadAccessKey,
} from "../families/hqReadAccess.ts";
import type { AccountStore } from "../store.ts";
import { makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";
import { hqNeedsUpdate } from "../../zerops/hq/refusals.ts";
import { streamOf } from "../reducer.ts";

export function makeReadAccessRequests(options: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "readAccessRequests">;
}) {
  const { store, api } = options;
  let closed = false;
  /** `again`s not settled yet: closing settles them. */
  const waiting = new Set<() => void>();
  const reads = makeSettingsReads(store);
  const spec = (key: ReadAccessKey): SettingRead<"hqReadAccessRequests"> => ({
    family: "hqReadAccessRequests",
    id: readAccessId(key),
    scope: readAccessScope(key),
    link: readAccessLink(key),
    read: () => api.readAccessRequests?.(),
    unsupported: hqNeedsUpdate("ask for read access"),
  });
  return {
    demand: (key: ReadAccessKey): (() => void) => (closed ? () => {} : reads.demand(spec(key))),
    /**
     * Reads the list again after a write of ours: settles once a read started after the write has
     * landed, or HQ refused to answer it, so the write's button stays held until the list shows it.
     */
    again: (key: ReadAccessKey): Promise<void> =>
      new Promise((resolve) => {
        if (closed) return resolve();
        const setting = spec(key);
        const after = reads.started(setting);
        reads.readAfterWrite(setting);
        const settle = () => {
          const state = store.state();
          const revision = state.facts.get(`${setting.family}:${setting.id}`)?.revision;
          const phase = streamOf(state, setting.scope).phase;
          if (
            !closed &&
            !(revision?.kind === "mate-link" && revision.sequence > after) &&
            phase !== "refused" &&
            phase !== "recovering"
          )
            return;
          stop();
          waiting.delete(settle);
          resolve();
        };
        const stop = store.subscribe(settle);
        waiting.add(settle);
      }),
    close: () => {
      closed = true;
      reads.close();
      for (const settle of waiting) settle();
    },
  };
}
