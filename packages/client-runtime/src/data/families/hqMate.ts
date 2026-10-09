/**
 * A Mate as HQ relays it: whether it is online, its last overview and its source attention
 * (`HqAttentionScopeValue`), read from the `attention` scope HQ keeps per project. It is observed
 * for each Mate HQ places, as part of the organization's navigation (HANDOFF §4.1); HQ never says
 * it is gone — a Mate with no report keeps what was last said.
 *
 * @module data/families/hqMate
 */
import { HQ_ATTENTION_HEALTH_KEY, HqAttentionScopeValue } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export type HqMateValue = HqAttentionScopeValue;

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqMate: HqMateValue;
  }
}

const decodeMate = Schema.decodeUnknownOption(HqAttentionScopeValue);

export const hqMateFamily: FamilySpec<"hqMate"> = {
  family: "hqMate",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-mates", leaving: "removed", demand: "detail" },
  hq: {
    scope: "attention",
    // The Mate's health, taken apart from its record, is `mateHealth`'s alone.
    idOf: (key) => (key === HQ_ATTENTION_HEALTH_KEY ? null : key),
    keyOf: (id) => id,
    decode: (raw) => Option.getOrNull(decodeMate(raw)),
    wireScope: (projectId) => ({ kind: "attention", projectId, health: "apart" }),
  },
};

/** One Mate's attention scope under the organization's HQ link. */
export const hqMateScope = (orgId: string, projectId: string): ScopeKey =>
  scopeOf(hqMateFamily, orgId, projectId);
