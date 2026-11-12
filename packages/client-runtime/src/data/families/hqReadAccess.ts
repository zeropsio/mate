/**
 * The organization's open read access requests as HQ lists them to the viewer (every one to an
 * Admin or Owner, their own to anyone else), read while a screen demands them and again after each
 * ask or close of ours.
 */
import type { ReadAccessRequest } from "../../zerops/hq/readAccess.ts";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

export interface ReadAccessKey {
  readonly orgId: string;
}

export const readAccessId = (key: ReadAccessKey): string => JSON.stringify([key.orgId]);
export const readAccessScope = (key: ReadAccessKey): ScopeKey =>
  `hq:${key.orgId}:read-access:${readAccessId(key)}`;
export const readAccessLink = (key: ReadAccessKey): LinkKey =>
  `hq:read-access-${encodeURIComponent(readAccessId(key))}`;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqReadAccessRequests: ReadonlyArray<ReadAccessRequest>;
  }
}

export const hqReadAccessRequestsFamily: FamilySpec<"hqReadAccessRequests"> = {
  family: "hqReadAccessRequests",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "read-access",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
