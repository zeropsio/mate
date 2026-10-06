/**
 * Whether a Mate's press in another browser is still at it, as HQ holds it (B5): no project's age
 * says so. A press holds its Mate's project at HQ from the moment Zerops takes the project, renews
 * the hold while it runs and lets it go at its end (`holdPress`); once Zerops answered its container
 * import, the import's own process is what the press is followed by.
 *
 * - `pressing` — HQ holds its press, or its import's process is queued, running or finished: its
 *   container is on its way, and nobody else imports one.
 * - `stopped` — HQ holds no press of it (its hold ran out: its tab closed), or its import's process
 *   failed: what it left is half made, for *Finish setup*.
 * - `unknown` — HQ has said nothing of its presses yet: neither is offered.
 *
 * @module pressElsewhere
 */
/** The presses HQ holds, by project; each as long as HQ lists it. */
export type HqPresses = Readonly<
  Record<
    string,
    {
      readonly kind: "mate" | "stage" | "production";
      readonly appId?: string;
      readonly importProcessId?: string;
    }
  >
>;

export type PressElsewhere = "pressing" | "stopped" | "unknown";

const IMPORT_FAILED: ReadonlySet<string> = new Set(["FAILED", "CANCELED"]);

export function pressElsewhere(input: {
  /** The presses HQ holds; null while it has said none. */
  readonly presses: HqPresses | null;
  readonly projectId: string;
  /** Where the press's import's process stands, as its project's processes read it; none unread. */
  readonly importStatus?: string | undefined;
}): PressElsewhere {
  if (input.presses === null) return "unknown";
  const held = input.presses[input.projectId];
  if (held === undefined) return "stopped";
  if (held.importProcessId !== undefined && input.importStatus !== undefined) {
    return IMPORT_FAILED.has(input.importStatus) ? "stopped" : "pressing";
  }
  return "pressing";
}
