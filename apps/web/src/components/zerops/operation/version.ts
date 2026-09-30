/**
 * A version as a person reads it, wherever a deploy names the version it
 * shipped — its card, its row in the chat, its result row: the name zcp or
 * the broker wrote read through the one reader (`parseVersionName`), its
 * branch or tag and its short sha — `main 7e2d4c1`, `v0.1.0 7e2d4c1` — and a
 * Mate's own working branch (`mate/mate-<project>`: machine names, nothing a
 * reader can use) as its sha alone. A name that spells no commit stays as it
 * was written; without a name, the platform's appVersion id. Pure (R2).
 */
import { displayVersionName } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import { mateProjectOfBranch } from "@t3tools/client-runtime/zerops/mateIdentity";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { parseVersionName, SHORT_SHA_LENGTH } from "@t3tools/client-runtime/zerops/versionName";

/** A version's name in words: its label and short sha, a Mate's branch as its sha alone. */
export function versionText(name: string | undefined): string | undefined {
  if (name === undefined || name.trim().length === 0) return undefined;
  const parsed = parseVersionName(name);
  if (parsed === undefined) return displayVersionName(name);
  const sha = parsed.sha.slice(0, SHORT_SHA_LENGTH);
  const { label } = parsed;
  return label === undefined || mateProjectOfBranch(label) !== undefined ? sha : `${label} ${sha}`;
}

export function versionLabel(version: ZeropsOperation["version"]): string | undefined {
  return versionText(version?.name) ?? version?.id;
}
