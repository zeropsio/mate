/**
 * The Chief at the menu's top, and the Chief page its row opens where the person has none.
 *
 * The row is the Chief whatever stands: its mark, "Chief", and a second line only while it has
 * something to say — read the way the menu's Mate rows read their Mates (`mateRowSecond`), cut to
 * what a person acts on: it works, it asks them, it waits for their sign-in, it is coming up. A
 * Chief at rest is its name alone. While it is set up, the line is its setup's; before that there
 * is no row (`chiefTopShown`).
 */
import type { OrgChief } from "~/zerops/chief";

import type { MateRowSecond, MateRowState } from "../SidebarMateRow.logic";
import type { ChiefSetup } from "./chiefSetup.logic";

/** Where the Chief's setup stands, as its row says it (`chiefSetupLine`, and its access missing). */
export type ChiefSetupRowState = "running" | "stopped" | "unfinished";

export type ChiefRowLine =
  | { readonly kind: "setup"; readonly state: ChiefSetupRowState }
  /** Its Mate's own line, as the list's row would draw it. */
  | { readonly kind: "mate"; readonly second: MateRowSecond }
  | undefined;

/**
 * | the Chief                                    | its line                       |
 * | -------------------------------------------- | ------------------------------ |
 * | its setup running, or stopped                | that                           |
 * | set up, its access never handed to it        | that its setup waits on you    |
 * | coming up                                    | its born line                  |
 * | working                                      | its step, or the dots          |
 * | asking the person                            | the question, in ink           |
 * | waiting for the person's sign-in             | that                           |
 * | anything else, or none                       | nothing: "Chief" stands alone  |
 */
export function chiefRowLine(input: {
  /** `chiefSetupLine`: its offer says nothing here, the row itself is the offer. */
  readonly setup: "offer" | "running" | "stopped" | null;
  /** Its own Chief stands without its access (`useChiefUnfinished`). */
  readonly unfinished: boolean;
  /** Its listed Mate's reading (`mateRowSecond`), once it is listed. */
  readonly mate: { readonly state: MateRowState; readonly second: MateRowSecond } | undefined;
}): ChiefRowLine {
  if (input.setup === "running" || input.setup === "stopped")
    return { kind: "setup", state: input.setup };
  if (input.unfinished) return { kind: "setup", state: "unfinished" };
  if (input.mate === undefined) return undefined;
  const { state, second } = input.mate;
  const says =
    second.kind === "coming" ||
    second.kind === "sign-in" ||
    (state === "working" && (second.kind === "reply" || second.kind === "ask")) ||
    (state === "needs" && second.kind === "reply" && second.tone === "ink");
  return says ? { kind: "mate", second } : undefined;
}

/**
 * Whether the menu's top holds the Chief's row: once it exists, or while its setup runs or stopped.
 * Never before — a Chief is optional, offered from the account menu (`chiefOffered`), never as a
 * menu row standing for something that does not exist.
 */
export function chiefTopShown(input: {
  readonly own: OrgChief;
  /** `chiefSetupLine`. */
  readonly setup: "offer" | "running" | "stopped" | null;
}): boolean {
  return typeof input.own === "string" || input.setup === "running" || input.setup === "stopped";
}

/** What a press on the row opens: the Chief's conversation, or the Chief page. */
export function chiefRowOpens(input: {
  readonly listed: boolean;
  readonly line: ChiefRowLine;
}): "mate" | "page" {
  return input.listed && input.line?.kind !== "setup" ? "mate" : "page";
}

export type ChiefPageView =
  /** Whose Chief it is is not known yet: the page holds its frame, saying nothing it takes back. */
  | { readonly kind: "reading" }
  /** What a Chief is, and *Set up Chief* — held, saying why, where it cannot start. */
  | { readonly kind: "offer"; readonly blocked: string | undefined }
  /** The setup's steps, running or stopped. */
  | { readonly kind: "steps"; readonly setup: Exclude<ChiefSetup, { phase: "idle" | "done" }> }
  /** Its Chief stands without its access: *Finish setting up*. */
  | { readonly kind: "finish"; readonly projectId: string }
  /** Set up: its container comes up, and the page hands over to its conversation. */
  | { readonly kind: "coming"; readonly projectId: string };

const HQ_READING = "Reaching your organization's HQ…";
const NO_HQ = "Your organization has no HQ to record a Chief.";
const HQ_BEHIND = "Your organization's HQ needs its update before it can record a Chief.";
const MAY_NOT_CREATE = "Only someone who may create projects in this organization can set one up.";

export function chiefPageView(input: {
  readonly own: OrgChief;
  readonly setup: ChiefSetup;
  /** Its own Chief stands without its access (`useChiefUnfinished`). */
  readonly unfinished: boolean;
  /**
   * The organization's HQ: reached, still being reached, none, or reached but running an older
   * Core than this app carries — one that cannot record a Chief, so a setup would stop half made.
   */
  readonly hq: "official" | "reading" | "none" | "behind";
  /** The person may make the project a Chief lives in (HQ's `create_app`). */
  readonly mayCreate: boolean;
}): ChiefPageView {
  const { setup, own } = input;
  if (setup.phase === "running" || setup.phase === "failed") return { kind: "steps", setup };
  if (setup.phase === "done") return { kind: "coming", projectId: setup.projectId };
  if (input.hq === "none") return { kind: "offer", blocked: NO_HQ };
  if (own === undefined) return { kind: "reading" };
  if (own !== null)
    return input.unfinished
      ? { kind: "finish", projectId: own }
      : { kind: "coming", projectId: own };
  const blocked =
    input.hq === "reading"
      ? HQ_READING
      : input.hq === "behind"
        ? HQ_BEHIND
        : input.mayCreate
          ? undefined
          : MAY_NOT_CREATE;
  return { kind: "offer", blocked };
}

/**
 * The Chief's row title in two parts: the words before its noun, which give way first when the
 * menu is narrow, and the noun itself — "Chief", "Chief Mate" — which always stays whole.
 */
export function chiefNameParts(title: string): { readonly head: string; readonly noun: string } {
  const at = title.lastIndexOf("Chief");
  if (at <= 0) return { head: "", noun: title };
  return { head: title.slice(0, at).trimEnd(), noun: title.slice(at) };
}
