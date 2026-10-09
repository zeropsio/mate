/**
 * A Mate's health (`MateHealth`): one value per Mate, by its project,
 * ordered by its own source revision. It arrives on two paths into this one family — straight from
 * a Mate the person has open (`adapters/mateHealth.ts`, `mate-direct`), and relayed by HQ for
 * every Mate HQ places (its `attention` scope, `hq-stream`, as its own value or inside the Mate's
 * record) — and the reducer keeps whichever is
 * newer by that revision: never by a clock, never by which path is live. A Mate from before the
 * health value relays none; its family holds nothing for it.
 *
 * @module data/families/mateHealth
 */
import type { MateHealth } from "@t3tools/contracts";
import { HQ_ATTENTION_HEALTH_KEY, HqAttentionHealthValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type MateHealthValue = MateHealth;

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateHealth: MateHealthValue;
  }
}

export const mateHealthFamily: FamilySpec<"mateHealth"> = {
  family: "mateHealth",
  authority: "mate",
  scope: { source: "mate", suffix: "mate-health", leaving: "removed", demand: "detail" },
  // HQ's relay rides the attention scope `hqMate` demands for each Mate it places.
  hq: {
    scope: "attention",
    // Its own value where HQ takes it apart, else inside the Mate's record (an HQ from before).
    idOf: (key, { ownerId }) => (key === HQ_ATTENTION_HEALTH_KEY ? ownerId : key),
    keyOf: (id) => id,
    decode: (raw) => Option.getOrNull(decodeRelayed(raw))?.health ?? null,
    revisionOf: ({ source }, raw) => ({
      kind: "mate-attention",
      environmentId: source.environmentId,
      epoch: source.epoch,
      incarnation: source.incarnation,
      revision: source.revision,
      // What HQ stored of a Mate it does not hear is no word of the run now running.
      live: Option.getOrNull(decodeRelayed(raw))?.healthState === "live",
    }),
  },
};

// Both shapes carry the two fields; the record's others are passed by.
const decodeRelayed = Schema.decodeUnknownOption(HqAttentionHealthValue);

/** The health HQ relays of one Mate, under the organization's HQ link. */
export const hqMateHealthScope = (orgId: string, projectId: string): ScopeKey =>
  `hq:${orgId}:${mateHealthFamily.scope.suffix}:${projectId}`;

/** The health an open Mate sends on its own link (`linkKeys.mateHealth(projectId)`). */
export const mateHealthScope = (projectId: string): ScopeKey =>
  scopeOf(mateHealthFamily, projectId);
