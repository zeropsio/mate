/**
 * Whether a Mate's press in another browser is still at it, as HQ holds it (B5): no project's age
 * says so. A press holds its Mate's project at HQ from the moment Zerops takes the project, keeps
 * the hold with its HQ stream while it runs and lets it go at its end (`holdPress`); once Zerops
 * answered its container import, the import's own process is what the press is followed by. A hold
 * ends only by HQ's word: no reader times it out.
 *
 * - `pressing` — its hold runs on, or its import's process is queued, running or finished: its
 *   container is on its way, and nobody else imports one.
 * - `stopped` — its exact import process failed or was cancelled.
 * - `unknown` — no current owner result is known. No press, a released hold or an expired hold
 *   says whether accepted setup continues. None permits a second import.
 *
 * @module pressElsewhere
 */
/** A press HQ lists: `held` while its hold runs on, a stopped one's record unheld. */
export interface HqPressHold {
  readonly kind: "mate" | "stage" | "production";
  readonly appId?: string;
  readonly importProcessId?: string;
  readonly held: boolean;
}

/** The presses HQ holds, by project. */
export type HqPresses = Readonly<Record<string, HqPressHold>>;

export type PressElsewhere = "pressing" | "stopped" | "unknown";

const IMPORT_FAILED: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

export function pressElsewhere(input: {
  /** The presses HQ holds; null while it has said none. */
  readonly presses: HqPresses | null;
  readonly projectId: string;
  /** The exact import named by the press or HQ birth/Mate; absent until its owner answers. */
  readonly importStatus?: string | undefined;
}): PressElsewhere {
  if (input.presses === null) return "unknown";
  const held = input.presses[input.projectId];
  if (
    input.importStatus !== undefined &&
    (held === undefined || held.importProcessId !== undefined)
  ) {
    return IMPORT_FAILED.has(input.importStatus) ? "stopped" : "pressing";
  }
  if (held === undefined) return "unknown";
  return held.held ? "pressing" : "unknown";
}
