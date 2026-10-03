/**
 * What a release carried, as its row says it: the commits HQ compares from the release before it
 * to its own, per repository it moved (`carriedReads`, `movedCommits`).
 *
 * A release lists one whole sha per service and nothing else, so a row built from it alone can
 * say `api 3f9c1b2` and not what that is; the comparison answers the rest.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module releaseCarried
 */

import { historyLine } from "./groupHistory.ts";
import { shortCommit } from "./release.ts";
import { movedCount, type Moved } from "./releaseCompare.ts";

/** A release row's two lines: what it carried, over who, when and the shas. */
export interface ReleaseDescription {
  readonly primary: string;
  readonly secondary: string;
}

/**
 * What a release row says it carried: the newest commit's subject, the service it moved only
 * where it moved more than one repository, and how many more commits came with it — HQ's count,
 * past what it listed; under it, who wrote that commit and how long ago, then the per-service
 * shas the row said before (`line`).
 *
 * `undefined` where nothing carried is known — the row keeps its shas alone. The author goes
 * through {@link historyLine}, so a Mate's change is its name here exactly as it is in the
 * history.
 */
export function releaseDescription(
  carried: ReadonlyArray<Moved>,
  /** `FlowReleaseRow.line`: the per-service shas. */
  line: string,
  now: number,
  names?: {
    readonly mateNames?: ReadonlyMap<string, string> | undefined;
    readonly groupName?: string | undefined;
  },
): ReleaseDescription | undefined {
  const [lead] = carried;
  const head = lead?.commits[0];
  if (lead === undefined || head === undefined) return undefined;
  const { count, atLeast } = movedCount(carried);
  const more = count - 1;
  const primary =
    (carried.length > 1 ? `${lead.services[0] ?? lead.repository}: ` : "") +
    head.subject +
    (more > 0 ? `, +${String(more)}${atLeast ? "+" : ""} more` : "");
  const byline = historyLine(
    {
      sha: head.sha,
      shortSha: shortCommit(head.sha),
      subject: head.subject,
      author: head.authorName,
      at: head.at,
      change: head.change,
      deployedTo: [],
      tags: [],
    },
    now,
    names,
  );
  return { primary, secondary: byline === undefined ? line : `${byline} · ${line}` };
}

/** What a release row's chevron does, for a screen reader. */
export function releaseCarriedToggleLabel(tag: string, open: boolean): string {
  return `${open ? "Hide" : "Show"} what ${tag} carried`;
}

/** A roll back's row: the release it went back to, over its shas. */
export function rolledBackDescription(tag: string, line: string): ReleaseDescription {
  return { primary: `Rolled back to ${tag}`, secondary: line };
}
