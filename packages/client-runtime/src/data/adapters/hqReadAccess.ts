/**
 * The organization's open read access requests, read once per demand and again after an ask or a
 * close of ours (`again`).
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

export function makeReadAccessRequests(options: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "readAccessRequests">;
}) {
  const { store, api } = options;
  let closed = false;
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
    again: (key: ReadAccessKey) => {
      if (!closed) reads.again(spec(key));
    },
    close: () => {
      closed = true;
      reads.close();
    },
  };
}
