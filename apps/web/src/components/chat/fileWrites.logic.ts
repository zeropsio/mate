/**
 * A written or edited file's row opens onto what was written (D9, the owner:
 * "Are these unclickable on purpose?"): a new file's content, an edit's
 * change, asked of the server (`threads.fileWrites`) from the call's own
 * payload. A call whose driver sent none keeps the row it had — the control
 * opens only onto what it draws.
 */
import type { ThreadWrittenFileRefusal } from "@t3tools/contracts";

import type { WorkStep } from "./workSteps.logic";

/**
 * The calls of a step whose payloads show what they wrote, by id: only once
 * each has written (a running one has not yet, a failed one never did).
 */
export function stepWriteCalls(step: WorkStep): string[] {
  if (step.kind !== "edit" || step.state !== "done") return [];
  return step.entries.flatMap((entry) =>
    entry.wroteFile === true &&
    entry.toolLifecycleStatus === "completed" &&
    entry.toolCallId !== undefined
      ? [entry.toolCallId]
      : [],
  );
}

/** Where "Open in Files" takes a written file: the workspace's own tab, or the read-only view outside it. */
export type FilesTarget =
  | { readonly kind: "workspace"; readonly path: string }
  | { readonly kind: "outside"; readonly path: string };

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

/**
 * A path as the Files tab opens it: inside the workspace by its path there,
 * outside it by its absolute path. A relative path is the workspace's; one
 * that climbs out of it names no file the tab can show.
 */
export function filesTarget(path: string, cwd: string | null): FilesTarget | null {
  if (!isAbsolute(path)) {
    const relative = path.replace(/^\.\//u, "");
    return relative.length === 0 || relative.split(/[\\/]/u).includes("..")
      ? null
      : { kind: "workspace", path: relative };
  }
  const root = cwd?.replace(/[\\/]+$/u, "") ?? null;
  if (root !== null && root.length > 0 && path.startsWith(`${root}/`)) {
    const relative = path.slice(root.length + 1).replace(/\/+$/u, "");
    return relative.length === 0 ? null : { kind: "workspace", path: relative };
  }
  return { kind: "outside", path };
}

/** A change that only removed lines, said as a count: its lines are never shown. */
export function removedWords(count: number): string {
  return `Removed ${count} ${count === 1 ? "line" : "lines"}`;
}

/** The Files tab's label on a written file: what the Mate wrote, and when — never the file now. */
export function writtenAtWords(mate: string | null, time: string): string {
  return `As ${mate ?? "your Mate"} wrote it at ${time}`;
}

/** Why the Files tab shows no written file, said plainly, the Mate by its name where known. */
export function writtenFileRefusalWords(
  reason: ThreadWrittenFileRefusal | null,
  mate: string | null,
): string {
  return reason === "not_written"
    ? `${mate ?? "Your Mate"} didn't write this file in this conversation, so it isn't shown.`
    : "This file can't be shown here.";
}
