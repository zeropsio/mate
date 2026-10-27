/**
 * driverLaunch — the owned, typed "how do I launch the Codex CLI for a
 * single exec-mode turn" capability. `textGeneration/CodexTextGeneration.ts`
 * needs the launch-arg resolution/filtering logic that
 * `provider/Layers/codexLaunchArgs.ts` owns (it also builds the `app-server`
 * argv, which is driver-internal and NOT re-exported here — this module is
 * the exec-mode subset `textGeneration/` actually consumes).
 *
 * `resolveCodexLaunchArgs` picks between an operator env override
 * (`T3CODE_CODEX_LAUNCH_ARGS`) and the configured `launchArgs`;
 * `codexExecLaunchArgs` then filters the tokenized launch args down to the
 * subset `codex exec` accepts (dropping `app-server`-only flags like
 * `--listen`). A port that changes either behavior fails
 * `driverLaunch.test.ts`, not the `codex exec` spawn call in
 * `CodexTextGeneration.ts`.
 *
 * @module driverLaunch
 */
import {
  codexExecLaunchArgs as driverCodexExecLaunchArgs,
  resolveCodexLaunchArgs as driverResolveCodexLaunchArgs,
} from "../provider/Layers/codexLaunchArgs.ts";

/**
 * Resolves the launch-args string to use: the `T3CODE_CODEX_LAUNCH_ARGS`
 * environment override when set (and non-blank), otherwise the configured
 * `launchArgs`, otherwise `""`.
 */
export function resolveCodexLaunchArgs(
  launchArgs?: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return driverResolveCodexLaunchArgs(launchArgs, environment);
}

/**
 * Tokenizes a resolved launch-args string and keeps only the flags valid on
 * `codex exec` (config/enable/disable/strict-config), dropping
 * `app-server`-only flags such as `--listen`.
 */
export function codexExecLaunchArgs(launchArgs?: string): ReadonlyArray<string> {
  return driverCodexExecLaunchArgs(launchArgs);
}
