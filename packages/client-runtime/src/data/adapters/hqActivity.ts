/**
 * An organization's activity, read a page at a time while a screen demands it, supervised by the
 * common retry and refusal policy, and read again when the person asks.
 */
import type { HqApi } from "../../zerops/hq/client.ts";
import { hqNeedsUpdate } from "../../zerops/hq/refusals.ts";
import {
  activityId,
  activityLink,
  activityScope,
  type ActivityKey,
} from "../families/hqActivity.ts";
import type { AccountStore } from "../store.ts";
import { makeSettingsReads, type SettingRead } from "./hqSettingsReads.ts";

const UPDATE_HQ = hqNeedsUpdate("show the organization's activity");

export function makeActivity(options: {
  readonly store: AccountStore;
  readonly api: Pick<HqApi, "activity">;
}) {
  const reads = makeSettingsReads(options.store);
  let closed = false;
  const pageRead = (key: ActivityKey): SettingRead<"hqActivity"> => ({
    family: "hqActivity",
    id: activityId(key),
    scope: activityScope(key),
    link: activityLink(key),
    read: () => options.api.activity?.(key.before),
    unsupported: UPDATE_HQ,
  });
  return {
    /** Reads the page while demanded; the returned call releases it. */
    demand: (key: ActivityKey): (() => void) => (closed ? () => {} : reads.demand(pageRead(key))),
    again: (key: ActivityKey) => {
      if (!closed) reads.again(pageRead(key));
    },
    close: () => {
      closed = true;
      reads.close();
    },
  };
}

export type Activity = ReturnType<typeof makeActivity>;
