/**
 * One file of a change review as the Git browser's `compare-file` read answers it, from the
 * change's recorded merge base to its head: the lines a review draws once the file is unfolded.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module changeFileDiff
 */
import { parseChangeDiff, type ChangeDiffFile } from "./changeDiff.ts";

/** The read as the data layer holds it (`GitBrowseView` of `compare-file`). */
export type ChangeFileDiffView =
  | { readonly state: "withheld" }
  | { readonly state: "unread" }
  | { readonly state: "known"; readonly answer: { readonly hunks: string | null } }
  | { readonly state: "failed"; readonly words: string }
  | { readonly state: "refused"; readonly words: string };

export type ChangeFileDiffState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "read"; readonly file: ChangeDiffFile | undefined; readonly cut: boolean };

export function changeFileDiffState(
  view: ChangeFileDiffView | undefined,
  path: string,
): ChangeFileDiffState {
  if (view === undefined || view.state === "unread" || view.state === "withheld")
    return { kind: "reading" };
  if (view.state === "failed" || view.state === "refused")
    return { kind: "failed", reason: view.words };
  const { hunks } = view.answer;
  if (hunks === null) return { kind: "read", file: undefined, cut: true };
  return { kind: "read", file: parseChangeDiff(hunks).get(path), cut: false };
}
