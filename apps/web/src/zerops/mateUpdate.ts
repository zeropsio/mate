/**
 * The one reader of "is there a newer Mate" the client renders (spec-mate.md
 * §2.9, MU-1): a pure presenter over the descriptor's `update` field, never
 * a version comparison of its own. `update` absent — a standalone server, or
 * `zcp` unreachable (MU-3) — shows the installed version alone, same as a
 * server that checked and found nothing newer.
 */
import { MATE_UPDATE_DRAIN_MINUTES } from "@t3tools/shared/mateAutoUpdatePolicy";
import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";

export interface MateUpdateLine {
  readonly text: string;
  /** `"attention"` marks the trailing "· x.y.z available" clause only. */
  readonly tone: "default" | "attention";
}

export function mateUpdateLine(
  update: ExecutionEnvironmentUpdate | undefined,
  serverVersion: string,
): MateUpdateLine {
  if (update === undefined) {
    return { text: `Server ${serverVersion}`, tone: "default" };
  }
  // The Mate's own restart, while one is asked for: what it waits on, or why it did not happen.
  const restart = update.restart;
  if (restart?.phase !== undefined) {
    const text =
      restart.phase === "draining"
        ? "Update ready; waiting for your work to finish"
        : restart.phase === "restarting"
          ? `Restarting to update${update.zcp?.behind === true ? " zcp" : ""} — your conversations are safe`
          : `Update postponed; ${restart.reason ?? "the restart did not happen"}`;
    return { text, tone: "default" };
  }
  // A settled attempt speaks only while its version is the one installed: a later update (a
  // manual one) leaves the updater's record behind, and its version is not what runs now.
  const automatic =
    (update.automatic?.phase === "updated" || update.automatic?.phase === "postponed") &&
    update.automatic.runningVersion !== update.installed
      ? undefined
      : update.automatic;
  if (automatic !== undefined) {
    const text =
      automatic.phase === "draining"
        ? "Update ready; waiting for your work to finish"
        : automatic.phase === "switching" || automatic.phase === "verifying"
          ? "Updating — your conversations are safe"
          : // "Updated" only while nothing newer waits: beside an Update it said none did.
            automatic.phase === "updated" && !update.available
            ? `Updated to ${automatic.runningVersion}`
            : automatic.phase === "postponed"
              ? `Update postponed; Mate is running ${automatic.runningVersion}`
              : update.available && !automatic.rollbackCompatible
                ? "Update available — needs your confirmation"
                : undefined;
    if (text !== undefined) return { text, tone: "default" };
  }
  const available = [
    ...(update.available ? [`${update.latest} available`] : []),
    ...(update.zcp?.behind === true ? [`zcp ${update.zcp.latest} available`] : []),
  ];
  if (available.length === 0) {
    return { text: `Server ${update.installed}`, tone: "default" };
  }
  return {
    text: `Server ${update.installed} · ${available.join(" · ")}`,
    tone: "attention",
  };
}

/**
 * Where one Mate's update or check stands (`useZeropsMateUpdate`), read by
 * every surface that shows that Mate.
 */
export type MateUpdateState =
  | { readonly phase: "idle" }
  | { readonly phase: "checking" }
  | {
      readonly phase: "updating";
      readonly to: string;
      /** Past its budget: still the update's, only slower than usual — never failed by a clock. */
      readonly overdue?: true;
    }
  | { readonly phase: "already-current" }
  | { readonly phase: "updated"; readonly to: string }
  | { readonly phase: "failed"; readonly message: string };

export interface MateUpdateStatus {
  readonly text: string;
  readonly tone: "quiet" | "failed";
}

/**
 * What a Mate's card says while a check or an update runs, and for a moment
 * after; `null` while nothing was asked of it. The menu that starts either
 * closes on the click, so the card is where the answer is seen (the owner,
 * 2026-09-26: "I pressed that update button on all of them, there is no
 * indication and nothing seems to be happening").
 */
export function mateUpdateStatus(state: MateUpdateState | undefined): MateUpdateStatus | null {
  switch (state?.phase) {
    case undefined:
    case "idle":
      return null;
    case "checking":
      return { text: "Checking for updates…", tone: "quiet" };
    case "updating":
      return {
        text: `Updating to ${state.to}…${state.overdue === true ? " taking longer than usual" : ""}`,
        tone: "quiet",
      };
    case "updated":
      return { text: `Updated to ${state.to}`, tone: "quiet" };
    case "already-current":
      return { text: "Up to date", tone: "quiet" };
    case "failed":
      return { text: state.message, tone: "failed" };
  }
}

/**
 * The status said beside the update line: the person's own answer, unless the line already says
 * the same — the server's record of the update and the person's both read "Updated to 0.15.31"
 * (Milo's stress run 6 read it twice).
 */
export function mateUpdateStatusBeside(
  line: MateUpdateLine,
  state: MateUpdateState | undefined,
): MateUpdateStatus | null {
  const status = mateUpdateStatus(state);
  return status !== null && status.text === line.text ? null : status;
}

/**
 * The version an update goes to where no check could name it: the update installs the newest
 * there is, so a version an older check knew would be a version it may not install.
 */
export const NEWEST_MATE_VERSION = "the newest version";

/**
 * What the app's confirm dialog asks before an update: the Mate and the
 * version, and what the update does with its work, said before the click.
 * The update waits until the Mate's work is done, up to the drain's deadline,
 * and past it does not happen (`drainMateUpdate`); it never stops the work.
 * The line ending in "?" is the dialog's title. `latest` is the version a
 * check just found; null where none could say (`NEWEST_MATE_VERSION`).
 */
export function mateUpdateQuestion(
  mateName: string | undefined,
  latest: string | null,
  /** Only a container restart gets the Mate current; `zcp` is the version it installs. */
  restart?: { readonly zcp?: string | undefined },
): string {
  const who = mateName ?? "It";
  const name = mateName ?? "this Mate";
  const target =
    restart?.zcp === undefined
      ? (latest ?? NEWEST_MATE_VERSION)
      : latest === null
        ? `zcp ${restart.zcp}`
        : `${latest} and zcp ${restart.zcp}`;
  const how =
    restart === undefined
      ? "then restarts on the new version, which takes about a minute"
      : "then its container restarts to install it, which takes a few minutes";
  return [
    `Update ${name} to ${target}?`,
    `${who} finishes the work it's doing first, its helpers' too, ${how}. Its conversations stay. If that work isn't done within ${MATE_UPDATE_DRAIN_MINUTES} minutes, ${mateName ?? "it"} doesn't update and keeps working.`,
  ].join("\n");
}
