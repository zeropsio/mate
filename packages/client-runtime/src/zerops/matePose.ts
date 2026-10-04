/**
 * Which pose a Mate's face wears for where it is in its life — the one rule every surface that
 * draws a Mate's face reads through the function that picks it (`mateFaceFor` on the web), so no
 * two places draw a Mate on its way up differently.
 *
 * | its life                                       | the pose                        |
 * | ---------------------------------------------- | ------------------------------- |
 * | coming up: from the press until it is listed   | waking                          |
 * | up and arriving: at rest or not answering yet  | waking                          |
 * | up, arrived                                    | the face its conversation gives |
 * | did not come up                                | asleep (the red dot says why)   |
 * | on its way off Zerops                          | asleep                          |
 *
 * Waking is asleep's closed eyes, alive: it breathes, so a Mate on its way up never stands still
 * like one at rest or one that stopped (run 6, 2026-10-03). It breathes only while it arrives
 * (`mateArriving`): a Mate nobody signs in rests after its window with its sign-in line and dot,
 * since a menu of faces must not fidget for days.
 *
 * Pure; the renderers map the pose to their motion.
 */
import type { MateMarkState } from "@t3tools/shared/brand";

import { FIRST_BUILD_GIVE_UP_MS, type ZeropsCandidate } from "./candidates.ts";
import { mateSignedInOnce } from "./mateAccess.ts";

/** Where a Mate is in its life, as its faces need it. */
export type MateLife =
  /** On its way up: from its press until its container answers (`mateComing`). */
  | "coming"
  /** It did not come up. */
  | "failed"
  /** On its way off Zerops. */
  | "deleting"
  /** Listed and up, or at least not known to be any of the above. */
  | "up";

/** What a Mate's pose reads beside the face its conversation gives it. */
export interface MatePoseFacts {
  /** Up where absent. */
  readonly life?: MateLife | undefined;
  /** It is still arriving (`mateArriving`); not where absent. */
  readonly arriving?: boolean | undefined;
}

/**
 * How long from its project's creation a Mate may be arriving: the first build's own give-up
 * (`FIRST_BUILD_GIVE_UP_MS`) — half an hour on, a Mate that has not come up is not coming.
 */
export const MATE_ARRIVAL_WINDOW_MS = FIRST_BUILD_GIVE_UP_MS;

/**
 * Until when a Mate is arriving, in epoch milliseconds — from its press, through its container
 * coming up, to its first sign-in, bounded to {@link MATE_ARRIVAL_WINDOW_MS} from its project's
 * creation. `undefined` when it is not arriving at all: somebody has signed one of its logins in
 * (`mateSignedInOnce` — a sign-out keeps its last signer, so a Mate once signed in has arrived for
 * good), its container is unavailable, or its creation time is not known.
 */
export function mateArrivingUntil(
  candidate: Pick<ZeropsCandidate, "group"> & {
    readonly project: Pick<ZeropsCandidate["project"], "hq" | "created">;
  },
): number | undefined {
  if (candidate.group === "unavailable") return undefined;
  if (mateSignedInOnce(candidate.project)) return undefined;
  const created = Date.parse(candidate.project.created ?? "");
  return Number.isNaN(created) ? undefined : created + MATE_ARRIVAL_WINDOW_MS;
}

/** Whether a Mate is arriving at `nowMs`, from {@link mateArrivingUntil}. */
export function mateArriving(arrivingUntil: number | undefined, nowMs: number): boolean {
  return arrivingUntil !== undefined && nowMs < arrivingUntil;
}

export function matePose(face: MateMarkState, facts: MatePoseFacts = {}): MateMarkState {
  switch (facts.life ?? "up") {
    case "coming":
      return "waking";
    case "failed":
    case "deleting":
      return "sleep";
    case "up":
      return facts.arriving === true && (face === "idle" || face === "sleep") ? "waking" : face;
  }
}

/** What a listed Mate's pose reads (`matePose`) at `nowMs`, from its candidate and its life. */
export function matePoseOf(
  candidate: Parameters<typeof mateArrivingUntil>[0],
  nowMs: number,
  life: MateLife = "up",
): MatePoseFacts {
  return { life, arriving: mateArriving(mateArrivingUntil(candidate), nowMs) };
}
