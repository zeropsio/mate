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
 * What HQ's card offers an owner or an admin beside HQ's health: its update while HQ's health
 * names an older Core than this app carries, else the way to see that it is up to date — both from
 * data already read. `null` for anybody else, and while either Core is unread.
 */
export function hqUpdateTrigger(input: {
  readonly admin: boolean;
  readonly standing: HqStanding;
  /** The Core this app carries; `undefined` until read. */
  readonly carried: string | undefined;
}): "Update available" | "Up to date" | null {
  const { standing, carried } = input;
  if (!input.admin || carried === undefined) return null;
  if (standing.kind !== "healthy" && standing.kind !== "unchecked") return null;
  return hqUpdateOffered(standing.build, carried) ? "Update available" : "Up to date";
}
