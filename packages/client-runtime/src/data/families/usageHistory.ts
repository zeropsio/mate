/**
 * What each service of a project held and used over the last day, by the hour, as Zerops reports
 * it (`POST /stats-history/group-by-search`, grouped by service): observed only while a screen
 * shows a project's charts, by one registration for that project. Its answer is the day's window;
 * its frames correct buckets or add the hour that began.
 *
 * @module data/families/usageHistory
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ZeropsStatHistoryItem } from "../../zerops/api.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** One service's hour, as the platform's bucket states it. */
export type UsageBucket = Omit<ZeropsStatHistoryItem, "projectId">;

declare module "../model.ts" {
  interface FamilyValues {
    readonly usageHistory: UsageBucket;
  }
}

const Figure = Schema.optionalKey(Schema.Finite);
const Bucket = Schema.Struct({
  serviceStackId: Schema.NonEmptyString,
  from: Schema.NonEmptyString,
  till: Schema.NonEmptyString,
  containerCount: Figure,
  cpuLimit: Figure,
  cpuUsed: Figure,
  vCpuLimit: Figure,
  vCpuUsed: Figure,
  ramLimit: Figure,
  ramUsed: Figure,
  diskLimit: Figure,
  diskUsed: Figure,
});
const decodeBucket = Schema.decodeUnknownOption(Bucket);

/** The window read: the last day, by the hour, in the viewer's time zone. */
const WINDOW = { timeGroupBy: "1h", limit: 24 } as const;

export const usageHistoryFamily: FamilySpec<"usageHistory"> = {
  family: "usageHistory",
  authority: "zerops",
  scope: { source: "zerops", suffix: "usage-history", leaving: "removed", demand: "detail" },
  zeropsQuery: {
    path: "/stats-history/group-by-search",
    body: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "projectId", operator: "eq", value: ownerId },
      ],
      groupBy: "serviceStackId",
      ...WINDOW,
      timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    frames: "rows",
    decode: (raw) =>
      Option.match(decodeBucket(raw), {
        onNone: () => null,
        onSome: (bucket) => ({
          id: `${bucket.serviceStackId}|${bucket.from}|${bucket.till}`,
          version: null,
          value: bucket,
        }),
      }),
  },
};

/** One project's services' last day, observed while demanded. */
export const usageHistoryScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(usageHistoryFamily, orgId, projectId);
