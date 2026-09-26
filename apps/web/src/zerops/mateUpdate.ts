/**
 * The one reader of "is there a newer Mate" the client renders (spec-mate.md
 * §2.9, MU-1): a pure presenter over the descriptor's `update` field, never
 * a version comparison of its own. `update` absent — a standalone server, or
 * `zcp` unreachable (MU-3) — shows the installed version alone, same as a
 * server that checked and found nothing newer.
 */
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
  if (!update.available) {
    return { text: `Server ${update.installed}`, tone: "default" };
  }
  return {
    text: `Server ${update.installed} · ${update.latest} available`,
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
  | { readonly phase: "updating"; readonly to: string }
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
      return { text: `Updating to ${state.to}…`, tone: "quiet" };
    case "updated":
      return { text: `Updated to ${state.to}`, tone: "quiet" };
    case "already-current":
      return { text: "Up to date", tone: "quiet" };
    case "failed":
      return { text: state.message, tone: "failed" };
  }
}

/**
 * What the app's confirm dialog asks before an update: the Mate and the
 * version, and that its running work stops (spec-mate.md §2.9 step 4, said
 * before the click). The line ending in "?" is the dialog's title.
 */
export function mateUpdateQuestion(mateName: string | undefined, latest: string): string {
  return [
    `Update ${mateName ?? "this Mate"} to ${latest}?`,
    `${mateName ?? "It"} restarts on the new version, which takes about a minute. Work running in it stops; its conversations stay.`,
  ].join("\n");
}
