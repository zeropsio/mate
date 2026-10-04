/**
 * The words of HQ's update (`ZeropsHqUpdate.tsx`): where HQ's Core stands against the one this app
 * carries, as Zerops says it (`@t3tools/client-runtime/zerops/hq` `HqUpdateState`), and the one
 * action it offers.
 */
import { hqUpdateOffered, type HqUpdateState } from "@t3tools/client-runtime/zerops/hq";

import type { HqStanding } from "~/zerops/accountHq";

const IDENTITY = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}Z\.([0-9a-f]{12})$/u;

/** A Core as a person reads it: its commit's time and its digest, or the name Zerops gives it. */
export function coreLabel(build: string): string {
  if (build === "") return "an unnamed Core";
  const match = IDENTITY.exec(build);
  if (match === null) return `Core ${build}`;
  const [, year, month, day, hour, minute, digest] = match;
  return `Core ${year}-${month}-${day} ${hour}:${minute} UTC · ${digest}`;
}

/** A Core in a few words, for a line with others: its commit's day, or the name Zerops gives it. */
export function coreDayLabel(build: string): string | null {
  if (build === "") return null;
  const match = IDENTITY.exec(build);
  if (match === null) return `Core ${build}`;
  const [, year, month, day] = match;
  return `Core ${year}-${month}-${day}`;
}

export interface HqUpdateWords {
  readonly line: string;
  readonly action: "Update HQ" | "Update again" | null;
}

/**
 * `answering` is the Core HQ's health names, `undefined` while unread: a deploy that finished in
 * Zerops runs beside the old Core until the new one answers (rolling deploy).
 */
export function hqUpdateWords(state: HqUpdateState, answering: string | undefined): HqUpdateWords {
  switch (state.kind) {
    case "available":
      return {
        line: `HQ runs ${coreLabel(state.running)}. This app carries ${coreLabel(state.carried)}.`,
        action: "Update HQ",
      };
    case "updating":
      return {
        line:
          state.target === undefined
            ? "HQ is being updated."
            : `HQ is being updated to ${coreLabel(state.target)}.`,
        action: null,
      };
    case "failed":
      return {
        line: `HQ's last update failed: ${state.reason.replace(/\.$/u, "")}. HQ still runs ${coreLabel(state.running)}.`,
        action: "Update again",
      };
    case "current":
      return {
        line:
          answering === undefined || !hqUpdateOffered(answering, state.running)
            ? `HQ runs ${coreLabel(state.running)}. It is up to date.`
            : `HQ's update to ${coreLabel(state.running)} finished. Waiting for HQ to answer with it.`,
        action: null,
      };
  }
}

/**
 * What HQ's card offers an owner or an admin beside HQ's health: its update while HQ's stream
 * names an older Core than this app carries, else the way to see that it is up to date — both from
 * data already read. A stream that names no Core leaves it to Zerops: the `hq` service's active
 * app version, read when an admin opens the card (`hqUpdateState`). `null` for anybody else, and
 * while either Core is unread.
 */
export function hqUpdateTrigger(input: {
  readonly admin: boolean;
  readonly standing: HqStanding;
  /** The Core this app carries; `undefined` until read. */
  readonly carried: string | undefined;
  /** Where Zerops says HQ's Core stands, once the opened card read it. */
  readonly zerops?: HqUpdateState | undefined;
}): "Update available" | "Up to date" | null {
  const { standing, carried, zerops } = input;
  if (!input.admin || carried === undefined) return null;
  if (standing.kind !== "healthy" && standing.kind !== "unchecked") return null;
  if (standing.build !== undefined) {
    return hqUpdateOffered(standing.build, carried) ? "Update available" : "Up to date";
  }
  // The Core it runs not named by its stream, nor read from Zerops yet: nothing offered on a guess.
  switch (zerops?.kind) {
    case "available":
    case "failed":
      return "Update available";
    case "current":
      return "Up to date";
    default:
      return null;
  }
}
