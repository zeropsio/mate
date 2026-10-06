/**
 * A Mate's attention (`MateAttention`, HANDOFF §4.2 "Mate"): one value per Mate, by its project,
 * ordered by its own source revision. It arrives on two paths into this one family — straight from
 * a Mate the person has open (`adapters/mateAttention.ts`, `mate-direct`), and relayed by HQ for
 * every Mate HQ places (its `attention` scope, `hq-stream`) — and the reducer keeps whichever is
 * newer by that revision: never by a clock, never by which path is live. A Mate from before the
 * attention value relays none; its family holds nothing for it.
 *
 * @module data/families/mateAttention
 */
import { MateAttention } from "@t3tools/contracts";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type MateAttentionValue = MateAttention;

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateAttention: MateAttentionValue;
  }
}

export const mateAttentionFamily: FamilySpec<"mateAttention"> = {
  family: "mateAttention",
  authority: "mate",
  scope: { source: "mate", suffix: "mate-attention", leaving: "removed", demand: "detail" },
};

/** The attention an open Mate sends on its own link (`linkKeys.mate(projectId)`). */
export const mateAttentionScope = (projectId: string): ScopeKey =>
  scopeOf(mateAttentionFamily, projectId);
