/**
 * How a release's row reads among the others on its production's list: what it is titled by, and
 * whether a failure of it is over. Pure: no React.
 */
import { RELEASE_DIDNT_GO_LIVE } from "@t3tools/client-runtime/zerops/flow";
import type { FlowReleaseRow } from "@t3tools/client-runtime/zerops";

import { changeTitle } from "./projects/projectHistory.logic";
import { releaseRowTone } from "./ZeropsProjectRow.logic";

type Listed = Pick<FlowReleaseRow, "tag" | "verdict" | "standing" | "history">;

/** A failure that is over, as its row says it: the pill's words, quiet. */
export const DIDNT_GO_LIVE_QUIET = RELEASE_DIDNT_GO_LIVE.toLocaleLowerCase();

const changeKey = (change: { readonly repo: string; readonly number: number }) =>
  `${change.repo}#${String(change.number)}`;

/** Whether the release didn't go through: its deploy failed, or HQ refused it. */
const failed = (release: Listed) => releaseRowTone(release) !== "ok";

/**
 * Whether a release's failure is over: it didn't go live, and a newer release is live. It is then
 * history, said quietly; only a failure with nothing live after it keeps its pill. `every` is the
 * production's releases, newest first.
 */
export function releaseFailureIsOver(release: Listed, every: ReadonlyArray<Listed>): boolean {
  if (!failed(release)) return false;
  const at = every.findIndex((each) => each.tag === release.tag);
  const live = every.findIndex((each) => each.standing === "live");
  return at !== -1 && live !== -1 && live < at;
}

/** What a release is titled by among the others. */
export type ReleaseTitle =
  /** It carries exactly the changes of the release before it, which didn't go live. */
  | { readonly kind: "again"; readonly of: string; readonly text: string }
  /** The first change it carries that the last release to go live before it did not. */
  | { readonly kind: "change"; readonly text: string };

/**
 * A release's title among the others, from the changes each row already lists (`history.changes`):
 * one that carries exactly the changes of the release before it, which didn't go live, is those
 * changes released again and says so, so three releases of one change never read as three changes;
 * otherwise it is titled by the first change it carries that the last release to go live before it
 * did not. `undefined` where the changes cannot tell — none recorded for it, or for the last
 * release that went live before it, or nothing new against that one — and the row keeps its first
 * change. `every` is the production's releases, newest first; `releasing` the one on its way, which
 * has not gone live yet.
 */
export function releaseTitle(
  release: Listed,
  every: ReadonlyArray<Listed>,
  releasing?: string | undefined,
): ReleaseTitle | undefined {
  const changes = release.history?.changes;
  const at = every.findIndex((each) => each.tag === release.tag);
  if (changes === undefined || changes.length === 0 || at === -1) return undefined;
  const before = every[at + 1];
  const carried = new Set(changes.map(changeKey));
  if (
    before !== undefined &&
    failed(before) &&
    before.history !== undefined &&
    before.history.changes.length === carried.size &&
    before.history.changes.every((change) => carried.has(changeKey(change)))
  )
    return {
      kind: "again",
      of: before.tag,
      text: `Same changes as ${before.tag}, released again`,
    };
  const live = every.slice(at + 1).find((each) => !failed(each) && each.tag !== releasing);
  if (live?.history === undefined) return undefined;
  const had = new Set(live.history.changes.map(changeKey));
  const first = changes.find((change) => !had.has(changeKey(change)));
  return first === undefined ? undefined : { kind: "change", text: changeTitle(first.title) };
}
