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
