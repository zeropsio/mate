/**
 * The version a settled deploy card names beside its frozen steps: the
 * `--version-name` zcp pushed (a full commit sha shortens to its first seven,
 * any other name stays whole), else the platform's appVersion id. Pure,
 * props only (R2).
 */
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

const FULL_SHA = /^[0-9a-f]{40}$/;
const SHORT_SHA_LENGTH = 7;

export function versionLabel(version: ZeropsOperation["version"]): string | undefined {
  const name = version?.name;
  if (name !== undefined) {
    return FULL_SHA.test(name) ? name.slice(0, SHORT_SHA_LENGTH) : name;
  }
  return version?.id;
}
