/**
 * One Mate's attention, the value its Mate authors (HANDOFF §4.2): main and latest chat, how many
 * chats work and wait, the ids of results and questions to react to, and whether the list was cut.
 * Whether the viewer saw them is the viewer's own fact, computed by HQ (§5 invariant 11). It stays
 * the Mate's fact whichever path — the open Mate, or HQ's relay — delivered it.
 *
 * @module data/families/attention
 */
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface AttentionValue {
  readonly mainChatId: string | null;
  readonly latestChatId: string | null;
  readonly working: number;
  readonly waiting: number;
  readonly resultIds: ReadonlyArray<string>;
  readonly questionIds: ReadonlyArray<string>;
  readonly truncated: boolean;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly attention: AttentionValue;
  }
}

export const attentionFamily: FamilySpec<"attention"> = {
  family: "attention",
  authority: "mate",
  scope: { source: "mate", suffix: "attention", leaving: "removed", demand: "navigation" },
};

/** An open Mate's own attention scope. */
export const attentionScope = (projectId: string) => scopeOf(attentionFamily, projectId);
