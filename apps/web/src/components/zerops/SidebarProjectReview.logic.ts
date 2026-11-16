/**
 * What waits for a review in a project, as its row's tags say it: *Review* (one item, opened at
 * once), *Review N* (a popover of them), *Release* (what waits for production).
 */
import {
  ASK_TO_MERGE,
  READY_TO_MERGE,
  REVIEW_LABEL,
  type ChangeStanding,
  type ChangeStandingRead,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";

import type { ReviewTarget } from "~/zerops/review";
import type { OwnerMark } from "./SidebarMateRow.logic";

export interface ProjectReviewItem {
  /** Stable: a change's `changeRowKey(pull)`, a crew task's `crew:<environmentId>:<taskId>`. */
  readonly key: string;
  readonly target: ReviewTarget;
  readonly title: string;
  /** Who made it: its Mate, or a crewmate with its Mate's name (`crewOf`) — "Sid, in Ada's crew". */
  readonly by:
    | {
        readonly name: string;
        readonly tint: MateTintId;
        readonly shape: MateShapeId;
        /** A colleague's Mate: what its owner is called (`ZeropsPerson.called`, "Vira · Theo's"). */
        readonly ownerName?: string | undefined;
        /**
         * A colleague's Mate: its owner's mark as the menu's row draws it (`ownerMark`), picture
         * and hue. Absent, the mark is drawn from `ownerName`.
         */
        readonly owner?: OwnerMark | undefined;
        readonly crewOf?: string | undefined;
      }
    | undefined;
  /** "#12", with its repository where the project's changes span several. */
  readonly label: string;
  /** The review waits on the viewer: else a colleague's, said "in review" and quieter. */
  readonly mine: boolean;
  /** The Mate it is of, by its Zerops project: its row marks it after its name. */
  readonly mateProjectId?: string | undefined;
  /**
   * Its Mate still works (`changeShowsReview`): it asks for no review yet, and its mark stays,
   * quieter, so the change is always findable.
   */
  readonly inProgress?: true | undefined;
  /**
   * Where a change that asks stands for the person looking (`changeStanding`), where its
   * application limits who merges: somebody asked them to merge it, it is theirs to ask for, or
   * it waits on the people who merge. Absent, it is theirs to review, as without a limit.
   */
  readonly standing?: Exclude<ChangeStanding["kind"], "to-merge"> | undefined;
  /**
   * Its standing in its line (`standingWord`): "Dana L. asks to merge", "Ready", "Waiting for
   * Ada K. or Sam R.". Absent where it says nothing past today's words.
   */
  readonly says?: string | undefined;
}

/** A change's row, as the menu keys it and the jump box finds it: `repository#number`. */
export function changeRowKey(pull: Pick<FlowPullRequest, "repository" | "number">): string {
  return `${pull.repository}#${String(pull.number)}`;
}

/**
 * A change as a review item: its label among the project's others, its Mate's face.
 *
 * Its repository leads its number where the project's changes stand open in more than one: a
 * popover lists every Mate's, and `#1` of two repositories would read as one change.
 */
export function changeReviewItem(input: {
  readonly pull: FlowPullRequest;
  readonly among: ReadonlyArray<Pick<FlowPullRequest, "repository">>;
  readonly groupId: string;
  readonly by: ProjectReviewItem["by"];
  readonly mine: boolean;
  /** Where it stands for the person looking (`useChangeStandingOf`); absent reads as theirs to review. */
  readonly standing?: ChangeStandingRead | undefined;
}): ProjectReviewItem {
  const { pull, among } = input;
  const number = `#${String(pull.number)}`;
  const several = among.some((other) => other.repository !== pull.repository);
  const kind = input.standing?.standing.kind;
  const says = input.standing?.word;
  return {
    ...(kind === undefined || kind === "to-merge" ? {} : { standing: kind }),
    ...(says === undefined || says === READY_TO_MERGE ? {} : { says }),
    key: changeRowKey(pull),
    target: {
      kind: "change",
      groupId: input.groupId,
      repository: pull.repository,
      number: pull.number,
    },
    title: pull.title,
    by: input.by,
    label: several ? `${pull.repository} ${number}` : number,
    mine: input.mine,
    mateProjectId: pull.mateProjectId,
  };
}

/** A crew task waiting for the viewer's Land, as a review item: its crewmate in its Mate's crew. */
export function crewTaskReviewItem(input: {
  readonly environmentId: EnvironmentId;
  readonly taskId: string;
  readonly title: string;
  readonly by: ProjectReviewItem["by"];
  readonly mine: boolean;
  /** The Mate whose crew it is, by its Zerops project. */
  readonly mateProjectId?: string | undefined;
}): ProjectReviewItem {
  return {
    key: `crew:${input.environmentId}:${input.taskId}`,
    target: { kind: "crew-task", environmentId: input.environmentId, taskId: input.taskId },
    title: input.title,
    by: input.by,
    label: "",
    mine: input.mine,
    mateProjectId: input.mateProjectId,
  };
}

/** The line under an item's title: who made it, whose Mate that is, its number. */
export function reviewItemByline(item: ProjectReviewItem): string {
  const parts: string[] = [];
  const { by } = item;
  if (by !== undefined) {
    parts.push(by.crewOf === undefined ? by.name : `${by.name}, in ${by.crewOf}'s crew`);
    if (by.ownerName !== undefined) parts.push(`${by.ownerName}'s`);
  }
  if (item.label.length > 0) parts.push(item.label);
  // Its standing says whose press it waits for; without one, a colleague's is "in review".
  if (item.says !== undefined) parts.push(item.says);
  else if (!item.mine) parts.push("in review");
  return parts.join(" · ");
}

/**
 * What a Mate's conversation header asks to review: its Mate's changes that ask for it — none
 * while the Mate still works on them (`changeShowsReview`), which the menu's mark keeps, quieter.
 * The conversation's own word that its Mate works wins over the menu's, as it does for the
 * composer's strip: the two never disagree on one screen (a run 2 follow-up: the header's Review
 * came and went while the conversation's card said Working).
 */
export function headerReviewItems(
  items: ReadonlyArray<ProjectReviewItem>,
  mateProjectId: string | undefined,
  conversation: { readonly mateWorks: boolean } = { mateWorks: false },
): ReadonlyArray<ProjectReviewItem> {
  if (conversation.mateWorks) return [];
  return items.filter((item) => item.mateProjectId === mateProjectId && item.inProgress !== true);
}

/**
 * An automated Mate's task conversation's app-bar Review (`headerReviewItems`), led by the change
 * of the task the conversation shows: one waiting opens at once, several list it first. Its Mate
 * holds a change per task, so the others wait there too, in the flow's order.
 */
export function taskReviewItems(
  items: ReadonlyArray<ProjectReviewItem>,
  change: { readonly repo: string; readonly number: number } | null,
): ReadonlyArray<ProjectReviewItem> {
  if (change === null) return items;
  const isTasks = (item: ProjectReviewItem) =>
    item.target.kind === "change" &&
    item.target.repository === change.repo &&
    item.target.number === change.number;
  const own = items.filter(isTasks);
  return own.length === 0 ? items : [...own, ...items.filter((item) => !isTasks(item))];
}

/** What the Review tag says to somebody who cannot see it. */
export function reviewTagLabel(
  items: ReadonlyArray<Pick<ProjectReviewItem, "title">>,
  projectName: string,
): string {
  const [only] = items;
  if (items.length === 1 && only !== undefined) return `Review ${only.title}`;
  return `${String(items.length)} to review in ${projectName}`;
}

/** The tag over changes the person asked for, every one: they wait on the people who merge. */
const WAITING_LABEL = "Waiting";

type StandingItem = Pick<ProjectReviewItem, "title" | "standing">;

/** A project's items by whose press each waits for: the person's review, their ask, or nobody's of theirs. */
function byStanding<Item extends StandingItem>(items: ReadonlyArray<Item>) {
  return {
    reviews: items.filter((item) => item.standing !== "to-ask" && item.standing !== "waiting"),
    asks: items.filter((item) => item.standing === "to-ask"),
    waits: items.filter((item) => item.standing === "waiting"),
  };
}

/** The tag over a project's items, as the person looking reads it. */
export interface ReviewTagRead<Item extends StandingItem = ProjectReviewItem> {
  /** *Review*; *Ask to merge* where they cannot merge; *Waiting* where they asked for every one. */
  readonly word: string;
  /** Nothing in it asks the person: it waits on the people who merge, and says so quietly. */
  readonly quiet: boolean;
  /** How many it counts, past one: what asks the person, else what waits. */
  readonly count: number | undefined;
  /** What it says to somebody who cannot see it. */
  readonly label: string;
  /**
   * Its popover's rows: what somebody asked the person to merge first, then what asks them, in the
   * flow's order, then what only waits on the people who merge.
   */
  readonly listed: ReadonlyArray<Item>;
}

const countPast = (count: number) => (count > 1 ? count : undefined);

/**
 * A project's tag for the person looking (`changeStanding`): a person who merges reads *Review*,
 * what somebody asked of them first; a person who cannot reads *Ask to merge* over the changes
 * nobody asked for yet, and a quiet *Waiting* once they asked for every one — never *Review*.
 */
export function reviewTagOf<Item extends StandingItem>(
  items: ReadonlyArray<Item>,
  projectName: string,
): ReviewTagRead<Item> {
  const { reviews, asks, waits } = byStanding(items);
  const [only] = items;
  if (reviews.length > 0) {
    const counted = [...reviews, ...asks];
    return {
      word: REVIEW_LABEL,
      quiet: false,
      count: countPast(counted.length),
      label: reviewTagLabel(counted, projectName),
      listed: [
        ...items.filter((item) => item.standing === "asked-of-me"),
        ...items.filter((item) => item.standing !== "asked-of-me" && item.standing !== "waiting"),
        ...waits,
      ],
    };
  }
  if (asks.length > 0) {
    const [ask] = asks;
    return {
      word: ASK_TO_MERGE,
      quiet: false,
      count: countPast(asks.length),
      label:
        asks.length === 1 && ask !== undefined
          ? `${ASK_TO_MERGE} ${ask.title}`
          : `${String(asks.length)} ready in ${projectName}`,
      listed: [...asks, ...waits],
    };
  }
  return {
    word: WAITING_LABEL,
    quiet: true,
    count: countPast(waits.length),
    label:
      waits.length === 1 && only !== undefined
        ? `${WAITING_LABEL}: ${only.title}`
        : `${String(waits.length)} waiting in ${projectName}`,
    listed: waits,
  };
}

/** The mark after a name: what asks for review there, else what its Mate still works on. */
interface ReviewMark {
  /** Something there asks for the person's review; else every change is still in progress. */
  readonly asks: boolean;
  /** How many it stands for: those that ask, else those in progress. */
  readonly count: number;
  /** What it says to somebody who cannot see it. */
  readonly label: string;
}

/**
 * The mark a row's changes wear: *Review* while any asks for review, else, quieter, that its Mate
 * still works on them — never gone while a change is open (Eli, 2026-10-14).
 */
export function reviewMarkOf(
  items: ReadonlyArray<Pick<ProjectReviewItem, "title" | "inProgress" | "standing">>,
  projectName: string,
): ReviewMark {
  const asking = items.filter((item) => item.inProgress !== true);
  if (asking.length > 0) {
    // What only waits on the people who merge asks the person nothing: its mark is the quiet one.
    const tag = reviewTagOf(asking, projectName);
    const { waits } = byStanding(asking);
    return {
      asks: !tag.quiet,
      count: tag.quiet ? waits.length : asking.length - waits.length,
      label: tag.label,
    };
  }
  const [only] = items;
  return {
    asks: false,
    count: items.length,
    label:
      items.length === 1 && only !== undefined
        ? `In progress: ${only.title}`
        : `${String(items.length)} changes in progress in ${projectName}`,
  };
}

/**
 * The popover's heading: its changes, or what is to review when crew tasks are among them. To a
 * person who cannot merge there, how many are ready for their ask — "2 ready in Tea" — or, once
 * they asked for every one, how many wait.
 */
export function reviewPopoverTitle(
  items: ReadonlyArray<Pick<ProjectReviewItem, "target" | "title" | "standing">>,
  projectName: string,
): string {
  const count = items.length;
  const { reviews, asks, waits } = byStanding(items);
  if (reviews.length === 0 && asks.length > 0) {
    return `${String(asks.length)} ready in ${projectName}`;
  }
  if (reviews.length === 0 && waits.length > 0) {
    return `${String(waits.length)} waiting in ${projectName}`;
  }
  if (items.some((item) => item.target.kind !== "change")) {
    return `${String(count)} to review in ${projectName}`;
  }
  return `${String(count)} ${count === 1 ? "change" : "changes"} in ${projectName}`;
}

/** What waits for production, as the menu's Release tag and mark tell it. */
export interface ReleaseWaiting {
  /** Commits on main production does not run. */
  readonly waiting: number;
  readonly atLeast: boolean;
  /** The changes among those commits, when HQ counted them. */
  readonly changeCount?: number | undefined;
}

/**
 * The count the Release tag and mark show: the changes HQ counted, else the commits. A history
 * that was never released counts its changes, never every commit it brought along.
 */
export function releaseCount(release: ReleaseWaiting): {
  readonly count: number;
  readonly atLeast: boolean;
} {
  const { changeCount } = release;
  return changeCount === undefined || changeCount <= 0
    ? { count: release.waiting, atLeast: release.atLeast }
    : { count: changeCount, atLeast: false };
}

/** The Release tag's tooltip: what waits for production. */
export function releaseTagTip(release: ReleaseWaiting): string {
  const { count: waiting, atLeast } = releaseCount(release);
  if (waiting <= 0) return "Ready for production";
  const what = waiting === 1 ? "1 change waits" : `${String(waiting)} changes wait`;
  return `${atLeast ? "At least " : ""}${what} for production`;
}

interface ShownReviewItem {
  readonly item: ProjectReviewItem;
  /** It has left the project's list: it fades where it stood, then goes. */
  readonly leaving: boolean;
}

/**
 * The open popover's list after the project's items change: an item that left stays where it was,
 * leaving, so nothing under it jumps before it has faded; an item that arrives takes its place in
 * the flow's order, after the item it follows there.
 */
export function reviewListWithLeaving(
  shown: ReadonlyArray<ShownReviewItem>,
  items: ReadonlyArray<ProjectReviewItem>,
): ReadonlyArray<ShownReviewItem> {
  const next = new Map(items.map((item) => [item.key, item]));
  const result: ShownReviewItem[] = shown.map((entry) => {
    const item = next.get(entry.item.key);
    return item === undefined ? { item: entry.item, leaving: true } : { item, leaving: false };
  });
  const placed = new Set(result.map((entry) => entry.item.key));
  items.forEach((item, index) => {
    if (placed.has(item.key)) return;
    const before = items[index - 1];
    const at = before === undefined ? -1 : result.findIndex((e) => e.item.key === before.key);
    result.splice(at + 1, 0, { item, leaving: false });
    placed.add(item.key);
  });
  return result;
}
