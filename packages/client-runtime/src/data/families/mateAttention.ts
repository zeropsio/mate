/**
 * A Mate's attention (`MateAttention`): one value per Mate, by its project,
 * ordered by its own source revision. It arrives on two paths into this one family — straight from
 * a Mate the person has open (`adapters/mateAttention.ts`, `mate-direct`), and relayed by HQ for
 * every Mate HQ places (its `attention` scope, `hq-stream`) — and the reducer keeps whichever is
 * newer by that revision: never by a clock, never by which path is live. A Mate from before the
 * attention value relays none; its family holds nothing for it.
 *
 * @module data/families/mateAttention
 */
import type { MateAttention } from "@t3tools/contracts";
import { HqAttentionScopeValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
  // HQ's relay rides the attention scope `hqMate` demands for each Mate it places.
  hq: {
    scope: "attention",
    idOf: (key) => key,
    keyOf: (id) => id,
    decode: (raw) => Option.getOrNull(decodeRelayed(raw))?.attention ?? null,
    revisionOf: ({ source }, raw) => ({
      kind: "mate-attention",
      environmentId: source.environmentId,
      epoch: source.epoch,
      incarnation: source.incarnation,
      revision: source.revision,
      // What HQ stored of a Mate it does not hear is no word of the run now running.
      live: Option.getOrNull(decodeRelayed(raw))?.attentionState === "live",
    }),
  },
};

const decodeRelayed = Schema.decodeUnknownOption(HqAttentionScopeValue);

/** The attention HQ relays of one Mate, under the organization's HQ link. */
export const hqMateAttentionScope = (orgId: string, projectId: string): ScopeKey =>
  `hq:${orgId}:${mateAttentionFamily.scope.suffix}:${projectId}`;

/** The attention an open Mate sends on its own link (`linkKeys.mate(projectId)`). */
export const mateAttentionScope = (projectId: string): ScopeKey =>
  scopeOf(mateAttentionFamily, projectId);
