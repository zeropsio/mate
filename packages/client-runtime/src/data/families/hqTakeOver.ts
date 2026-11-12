/**
 * A member's take-over as the account reads it: the integration tokens the member minted that keep
 * Zerops refusing their removal, read while their page is open, and this account's last replace of
 * one of them.
 */
import type { HqTakeOverList } from "@t3tools/shared/hqTakeOver";
import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

export interface TakeOverKey {
  readonly orgId: string;
  /** The member's Zerops user id. */
  readonly userId: string;
}
export const takeOverId = (key: TakeOverKey): string => JSON.stringify([key.orgId, key.userId]);
export const takeOverScope = (key: TakeOverKey): ScopeKey =>
  `hq:${key.orgId}:take-over:${takeOverId(key)}`;
/** The link the list is read on: its fault is the read's own. */
export const takeOverLink = (key: TakeOverKey): LinkKey =>
  `hq:take-over-${encodeURIComponent(takeOverId(key))}`;
export const takeOverRequestScope = (key: TakeOverKey): ScopeKey =>
  `hq:${key.orgId}:take-over-request:${takeOverId(key)}`;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqTakeOver: HqTakeOverList;
    /** The latest replace of this account's, by its request, and the token it replaces. */
    readonly hqTakeOverRequest: { readonly requestId: string; readonly tokenId: string };
  }
}

export const hqTakeOverFamily: FamilySpec<"hqTakeOver"> = {
  family: "hqTakeOver",
  authority: "hq",
  scope: { source: "hq", suffix: "take-over", leaving: "removed", demand: "detail", mode: "once" },
};

export const hqTakeOverRequestFamily: FamilySpec<"hqTakeOverRequest"> = {
  family: "hqTakeOverRequest",
  authority: "hq",
  scope: {
    source: "hq",
    suffix: "take-over-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
};
