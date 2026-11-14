/**
 * An organization's activity as the settings read it: one page of entries per key, the first page
 * (`before` `null`) and each page after the one that named it, read once while a screen demands it.
 */
import type { HqActivityPage } from "@t3tools/shared/hqActivity";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

export interface ActivityKey {
  readonly orgId: string;
  /** The entry the page reads before; `null` for the newest. */
  readonly before: string | null;
}
export const activityId = (key: ActivityKey): string => JSON.stringify([key.orgId, key.before]);
export const activityScope = (key: ActivityKey): ScopeKey =>
  `hq:${key.orgId}:activity:${activityId(key)}`;
/** The link a page is read on: its fault is the read's own. */
export const activityLink = (key: ActivityKey): LinkKey =>
  `hq:activity-${encodeURIComponent(activityId(key))}`;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqActivity: HqActivityPage;
  }
}

export const hqActivityFamily: FamilySpec<"hqActivity"> = {
  family: "hqActivity",
  authority: "hq",
  scope: { source: "hq", suffix: "activity", leaving: "removed", demand: "detail", mode: "once" },
};
