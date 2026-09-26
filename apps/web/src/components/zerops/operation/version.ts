/**
 * The version a settled deploy card names beside its frozen steps: the
 * `--version-name` zcp pushed (a full commit sha shortens to its first seven,
 * any other name stays whole — `displayVersionName`, the words the deploy
 * step's sentence names it by), else the platform's appVersion id. Pure,
 * props only (R2).
 */
import { displayVersionName } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

export function versionLabel(version: ZeropsOperation["version"]): string | undefined {
  const name = version?.name;
  return name !== undefined ? displayVersionName(name) : version?.id;
}
