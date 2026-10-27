import type { ThreadEnvMode } from "@t3tools/contracts";
import { resolveThreadEnvModeForCapability } from "@t3tools/shared/threadEnvMode";

export function resolveDraftWorkspaceMode(input: {
  readonly draftMode: ThreadEnvMode | undefined;
  readonly defaultMode: ThreadEnvMode;
  readonly worktreesAllowed: boolean | undefined;
}): ThreadEnvMode {
  return resolveThreadEnvModeForCapability(
    input.draftMode ?? input.defaultMode,
    input.worktreesAllowed,
  );
}

export function resolveWorkspaceModeSelection(
  mode: ThreadEnvMode,
  worktreesAllowed: boolean | undefined,
): ThreadEnvMode {
  return resolveThreadEnvModeForCapability(mode, worktreesAllowed);
}
