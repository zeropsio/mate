/**
 * The Mates as HQ hands them to a reader on its structure socket (`apps/hq/src/stream.ts`), apart
 * from the structure itself: each Mate the reader may observe (`observe_mate`) by its project, and
 * the people the reader's view names.
 *
 * - The snapshot carries {@link HqMatesSnapshot} beside the structure: every such Mate, whole.
 * - `{ type: "mate", projectId, value }` carries only what changed of one Mate — its presence or
 *   any of its overview's sections (`mateLink.ts`), each replaced whole — or `null` once the reader
 *   may no longer observe it.
 * - `{ type: "people", people }` replaces the people map.
 *
 * A Mate's presence is HQ's own: whether one of its links is open, since when, and where its
 * overview comes from. Names are Zerops', as HQ last read its organization's members; HQ keeps none.
 * The people are those the view names: the Mates' makers and stand-up askers, their logins'
 * signers, and whoever an `OWNER` entry names on the reader's projects — never a token.
 *
 * @module hqMates
 */
import * as Schema from "effect/Schema";

import { MateOverviewSections } from "./mateLink.ts";

export const MatePresence = Schema.Struct({
  /** One of the Mate's links to HQ is open. */
  online: Schema.Boolean,
  /** When `online` last changed: ISO. */
  since: Schema.String,
  /**
   * `live`: sent on the open link. `stored`: read back from HQ's store while the Mate is offline.
   * `none`: online with no overview sent — a Mate from before the overview.
   */
  overview: Schema.Literals(["live", "stored", "none"]),
});
export type MatePresence = typeof MatePresence.Type;

/** A Mate as a reader observes it: its presence, and its overview where HQ holds one. */
export const MateLiveView = Schema.Struct({
  presence: MatePresence,
  ...MateOverviewSections.fields,
});
export type MateLiveView = typeof MateLiveView.Type;

/** What changed of a Mate a reader observes: each part present is replaced whole. */
export const MateLiveChange = Schema.Struct({
  presence: Schema.optionalKey(MatePresence),
  ...MateOverviewSections.fields,
});
export type MateLiveChange = typeof MateLiveChange.Type;

/**
 * A person by their Zerops user id: their name, and their member id (`clientUser`) — what a
 * project's `userRoles` name them by, so an `OWNER` entry finds its person here.
 */
export const HqPeople = Schema.Record(
  Schema.String,
  Schema.Struct({ name: Schema.String, clientUserId: Schema.optionalKey(Schema.String) }),
);
export type HqPeople = typeof HqPeople.Type;

/** What a structure snapshot carries beside the structure. */
export const HqMatesSnapshot = Schema.Struct({
  mates: Schema.Record(Schema.String, MateLiveView),
  people: HqPeople,
});
export type HqMatesSnapshot = typeof HqMatesSnapshot.Type;

export const HqMatesMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("mate"),
    projectId: Schema.String,
    value: Schema.NullOr(MateLiveChange),
  }),
  Schema.Struct({ type: Schema.Literal("people"), people: HqPeople }),
]);
export type HqMatesMessage = typeof HqMatesMessage.Type;
