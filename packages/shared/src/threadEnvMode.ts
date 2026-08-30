import type { ThreadEnvMode } from "@t3tools/contracts";

export function resolveThreadEnvModeForCapability(
  mode: ThreadEnvMode,
  worktreesAllowed: boolean | undefined,
): ThreadEnvMode {
  return worktreesAllowed === false && mode === "worktree" ? "local" : mode;
}

/**
 * Canonical priority order for a project's default thread env mode: an
 * explicit server refusal > per-project setting > checked-in t3.json >
 * global server setting. A missing capability preserves the upstream
 * worktree behavior under version skew.
 *
 * An explicit composer pick outranks the defaults but not a server refusal;
 * callers clamp explicit picks with resolveThreadEnvModeForCapability. Web
 * resolves the sources imperatively at draft creation, mobile reactively —
 * both must route through this function so the platforms cannot disagree on
 * the order.
 */
export function resolveDefaultThreadEnvMode(sources: {
  readonly projectSetting: ThreadEnvMode | null | undefined;
  readonly projectFile: ThreadEnvMode | null | undefined;
  readonly globalDefault: ThreadEnvMode;
  readonly worktreesAllowed?: boolean;
}): ThreadEnvMode {
  return resolveThreadEnvModeForCapability(
    sources.projectSetting ?? sources.projectFile ?? sources.globalDefault,
    sources.worktreesAllowed,
  );
}

/**
 * True once the resolved default can no longer change: an explicit pick or a
 * source that outranks t3.json decided, or the file read settled. While
 * false, nothing may persist the provisional default (for example into a
 * draft's workspace selection) — it could differ from the final value.
 */
export function isDefaultThreadEnvModeSettled(sources: {
  readonly explicitMode: ThreadEnvMode | undefined;
  readonly projectSetting: ThreadEnvMode | null | undefined;
  readonly projectFilePending: boolean;
}): boolean {
  return (
    sources.explicitMode !== undefined ||
    sources.projectSetting != null ||
    !sources.projectFilePending
  );
}
