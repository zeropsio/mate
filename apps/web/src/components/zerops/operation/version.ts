/**
 * A version as a person reads it, wherever a deploy names the version it
 * shipped — its card, its row in the chat, its result row: the name zcp, HQ's
 * Core or main's broker wrote read through the one reader (`parseVersionName`), its
 * branch or tag and its short sha — `main 7e2d4c1`, `v0.1.0 7e2d4c1` — and a
 * Mate's own working branch (`mate/mate-<project>`: machine names, nothing a
 * reader can use) as its sha alone; zcp's push of uncommitted changes as its
 * sha, said uncommitted. A name that spells no commit stays as it
 * was written; without a name, the platform's appVersion id. Pure (R2).
 */
import { displayVersionName } from "@t3tools/client-runtime/zerops/activity/pipelineReadout";
import { mateProjectOfBranch } from "@t3tools/client-runtime/zerops/mateIdentity";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import {
  parseDirtyVersionName,
  parseVersionName,
  SHORT_SHA_LENGTH,
} from "@t3tools/client-runtime/zerops/versionName";

/** A version's name in words: its label and short sha, a Mate's branch as its sha alone. */
export function versionText(name: string | undefined): string | undefined {
  if (name === undefined || name.trim().length === 0) return undefined;
  // A push of uncommitted changes: the commit its tree started from, said so.
  const dirty = parseDirtyVersionName(name);
  if (dirty !== undefined) return `${labelled(dirty.label, dirty.sha)} · uncommitted`;
  const parsed = parseVersionName(name);
  if (parsed === undefined) return displayVersionName(name);
  return labelled(parsed.label, parsed.sha.slice(0, SHORT_SHA_LENGTH));
}

/** A sha with its branch or tag — a Mate's own working branch never named. */
function labelled(label: string | undefined, sha: string): string {
  return label === undefined || mateProjectOfBranch(label) !== undefined ? sha : `${label} ${sha}`;
}

export function versionLabel(version: ZeropsOperation["version"]): string | undefined {
  return versionText(version?.name) ?? version?.id;
}
