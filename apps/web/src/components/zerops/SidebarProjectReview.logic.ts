/**
 * What waits for a review in a project, as its row's tags say it: *Review* (one item, opened at
 * once), *Review N* (a popover of them), *Release* (what waits for production).
 */
import {
  ASK_TO_MERGE,
  changeActBusy,
  changeActWords,
  changeTheirs,
  READY_TO_MERGE,
  REVIEW_LABEL,
  type ChangeAct,
  type ChangeStanding,
  type ChangeStandingRead,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId } from "@t3tools/contracts";
import type { MateShapeId, MateTintId } from "@t3tools/shared/brand";

import type { ReviewTarget } from "~/zerops/review";
import { reviewQueueOrder, type QueuedTarget } from "~/zerops/reviewQueue.logic";
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
  /**
   * It is the viewer's own Mate's, or no person's: else a colleague's — theirs to merge or to ask
   * for, said "open" and quieter (`changeTheirs`), unless somebody asked the viewer to merge it.
   */
  readonly mine: boolean;
  /** The Mate it is of, by its Zerops project: its row marks it after its name. */
  readonly mateProjectId?: string | undefined;
  /** A change's head as HQ gave it: what its Mate fixing it is about (`worksOnChange`). */
  readonly head?: string | undefined;
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
  /**
   * A comment somebody left on this change of the viewer's own Mate that they have not read
   * (`ChangeStandingRead.comment`): "Sam R. commented". It is theirs again — counted, and said in
   * its line in place of its standing — until they open its review.
   */
  readonly comment?: string | undefined;
  /**
   * What is being done to it now (`changeActOf`): its merge or close on its way, its Mate fixing it
   * — it asks the person nothing meanwhile, and says so — or its merge refused.
   */
  readonly act?: ChangeAct | undefined;
  /** The other open changes of its repository it merges after (`FlowPullRequest.buildsOn`). */
  readonly buildsOn?: ReadonlyArray<number> | undefined;
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
    ...(input.standing?.comment === undefined ? {} : { comment: input.standing.comment }),
    ...(input.standing?.act === undefined ? {} : { act: input.standing.act }),
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
    ...(pull.headSha === undefined ? {} : { head: pull.headSha }),
    ...(pull.buildsOn === undefined ? {} : { buildsOn: pull.buildsOn }),
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
  const number = item.target.kind === "change" ? item.target.number : undefined;
  if (item.act !== undefined && number !== undefined) {
    parts.push(changeActWords(item.act, number).word);
    return parts.join(" · ");
  }
  // Its standing says whose press it waits for; a colleague's own is only open — theirs to merge
  // or to ask for, unless it already waits on the people who merge.
  if (item.comment !== undefined) parts.push(item.comment);
  else if (changeTheirs(item))
    parts.push(item.standing === "waiting" ? (item.says ?? "open") : "open");
  else if (item.says !== undefined) parts.push(item.says);
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
  conversation: {
    readonly mateWorks: boolean;
    /**
     * The change its Mate is fixing (`worksOnChange`), by its review's target: it stays, saying so,
     * while the Mate works on it, as the composer's top says it.
     */
    readonly fixing?:
      | { readonly mateName: string; readonly is: (item: ProjectReviewItem) => boolean }
      | undefined;
  } = { mateWorks: false },
): ReadonlyArray<ProjectReviewItem> {
  const own = items.filter((item) => item.mateProjectId === mateProjectId);
  const { fixing } = conversation;
  const fixed = (item: ProjectReviewItem): ProjectReviewItem =>
    fixing === undefined || changeActBusy(item.act) || !fixing.is(item)
      ? item
      : { ...item, act: { kind: "fixing", mateName: fixing.mateName } };
  if (conversation.mateWorks) {
    return own.flatMap((item) => {
      const next = fixed(item);
      return next.act?.kind === "fixing" ? [next] : [];
    });
  }
  return own.filter((item) => item.inProgress !== true).map(fixed);
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

type StandingItem = Pick<ProjectReviewItem, "title" | "standing" | "mine" | "comment" | "act">;

/** It is on its way — merging, closing, asked for, its Mate fixing it — or just merged. */
const onItsWay = (item: Pick<ProjectReviewItem, "act">) =>
  changeActBusy(item.act) || item.act?.kind === "merged";

/**
 * A project's items by whose move each is: the person's review, their ask, the people who merge
 * (the person asked them), or a colleague's own.
 */
function byStanding<Item extends StandingItem>(items: ReadonlyArray<Item>) {
  // One on its way asks the person nothing until it ends.
  const own = items.filter((item) => !changeTheirs(item) && !onItsWay(item));
  // A comment the person has not read hands a change they asked for back to them.
  const waits = (item: Item) => item.standing === "waiting" && item.comment === undefined;
  return {
    reviews: own.filter((item) => item.standing !== "to-ask" && item.standing !== "waiting"),
    asks: own.filter((item) => item.standing === "to-ask"),
    comments: own.filter((item) => item.standing === "waiting" && item.comment !== undefined),
    waits: own.filter(waits),
    busy: items.filter((item) => !changeTheirs(item) && onItsWay(item)),
    theirs: items.filter(changeTheirs),
  };
}

/**
 * The changes of a project's list the person reviews themselves — theirs to review or to ask for,
 * nothing on its way, its Mate done with it, none a colleague's — in the order reviewing them
 * together goes through (`reviewQueueOrder`); none where fewer than two are.
 */
export function reviewTogether(
  items: ReadonlyArray<ProjectReviewItem>,
): ReadonlyArray<QueuedTarget> {
  const { reviews, asks } = byStanding(items.filter((item) => item.inProgress !== true));
  const queue = reviewQueueOrder(
    [...reviews, ...asks].flatMap((item) =>
      item.target.kind === "change" ? [{ target: item.target, buildsOn: item.buildsOn }] : [],
    ),
  );
  return queue.length < 2 ? [] : queue;
}

/** The tag over a project's items, as the person looking reads it. */
export interface ReviewTagRead<Item extends StandingItem = ProjectReviewItem> {
  /**
   * *Review*; *Ask to merge* where they cannot merge; *Waiting* where they asked for every one;
   * *Changes* where every one is a colleague's.
   */
  readonly word: string;
  /** Nothing in it asks the person: it is somebody else's move, and says so quietly. */
  readonly quiet: boolean;
  /** Its word says what is on its way ("Merging…"): it wears the busy mark. */
  readonly busy?: true | undefined;
  /** How many it counts, past one: what asks the person, else what it lists. */
  readonly count: number | undefined;
  /** How many it stands for, as a mark counts them. */
  readonly counted: number;
  /** What it says to somebody who cannot see it. */
  readonly label: string;
  /**
   * Its popover's rows: what somebody asked the person to merge first, then what asks them, in the
   * flow's order, then what only waits on the people who merge, then colleagues' own.
   */
  readonly listed: ReadonlyArray<Item>;
}

const countPast = (count: number) => (count > 1 ? count : undefined);

/**
 * A project's tag for the person looking: it counts their own Mates' changes and the ones asked
 * of them, never a colleague's. A person who merges reads *Review*, what somebody asked of them
 * first; a person who cannot reads *Ask to merge* over the changes nobody asked for yet, and a
 * quiet *Waiting* once they asked for every one — never *Review*. Colleagues' open changes are
 * listed under those, and alone make a quiet *Changes*.
 */
export function reviewTagOf<Item extends StandingItem>(
  items: ReadonlyArray<Item>,
  projectName: string,
): ReviewTagRead<Item> {
  const { reviews, asks, comments, waits, busy, theirs } = byStanding(items);
  if (reviews.length > 0) {
    const counted = [...reviews, ...asks, ...comments];
    const [only] = counted;
    return {
      // One whose merge was refused: said so, its tag still the way back to its review.
      word:
        counted.length === 1 &&
        (only?.act?.kind === "merge-failed" || only?.act?.kind === "merge-unconfirmed")
          ? changeActWords(only.act, 0).word
          : REVIEW_LABEL,
      quiet: false,
      count: countPast(counted.length),
      counted: counted.length,
      label: reviewTagLabel(counted, projectName),
      listed: [
        ...reviews.filter((item) => item.standing === "asked-of-me"),
        ...items.filter((item) => counted.includes(item) && item.standing !== "asked-of-me"),
        ...busy,
        ...waits,
        ...theirs,
      ],
    };
  }
  if (asks.length > 0) {
    const [ask] = asks;
    return {
      word: ASK_TO_MERGE,
      quiet: false,
      count: countPast(asks.length),
      counted: asks.length + comments.length,
      label:
        asks.length === 1 && ask !== undefined
          ? `${ASK_TO_MERGE} ${ask.title}`
          : `${String(asks.length)} ready in ${projectName}`,
      listed: [...comments, ...asks, ...busy, ...waits, ...theirs],
    };
  }
  if (comments.length > 0) {
    // Only changes somebody commented on since the person asked for them: theirs to read.
    const [comment] = comments;
    return {
      word: comments.length === 1 ? "Comment" : "Comments",
      quiet: false,
      count: countPast(comments.length),
      counted: comments.length,
      label:
        comments.length === 1 && comment !== undefined
          ? `${comment.comment ?? "Comment"}: ${comment.title}`
          : `${String(comments.length)} with new comments in ${projectName}`,
      listed: [...comments, ...busy, ...waits, ...theirs],
    };
  }
  const [first] = busy;
  if (first?.act !== undefined) {
    // Only what is on its way, and what waits on others: what the first is doing, quietly, busy.
    const listed = [...busy, ...waits, ...theirs];
    const { word } = changeActWords(first.act, 0);
    return {
      word,
      quiet: true,
      // Merged is said, not worked on: no busy mark beside it.
      ...(changeActBusy(first.act) ? { busy: true as const } : {}),
      count: countPast(busy.length),
      counted: busy.length,
      label:
        busy.length === 1 ? `${word} ${first.title}` : `${word} ${String(busy.length)} changes`,
      listed,
    };
  }
  const listed = [...waits, ...theirs];
  const [only] = listed;
  const word = waits.length > 0 ? WAITING_LABEL : listed.length === 1 ? "Change" : "Changes";
  const lead = waits.length > 0 ? WAITING_LABEL : "Open";
  return {
    word,
    quiet: true,
    count: countPast(listed.length),
    counted: listed.length,
    label:
      listed.length === 1 && only !== undefined
        ? `${lead}: ${only.title}`
        : `${String(listed.length)} ${lead.toLowerCase()} in ${projectName}`,
    listed,
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
  items: ReadonlyArray<
    Pick<ProjectReviewItem, "title" | "inProgress" | "standing" | "mine" | "comment">
  >,
  projectName: string,
): ReviewMark {
  const asking = items.filter((item) => item.inProgress !== true);
  if (asking.length > 0) {
    // What is somebody else's move — the people who merge, a colleague — asks the person
    // nothing: its mark is the quiet one, and never adds to a count of theirs.
    const tag = reviewTagOf(asking, projectName);
    return { asks: !tag.quiet, count: tag.counted, label: tag.label };
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
  items: ReadonlyArray<
    Pick<ProjectReviewItem, "target" | "title" | "standing" | "mine" | "comment">
  >,
  projectName: string,
): string {
  const count = items.length;
  const { reviews, asks, comments, waits, busy, theirs } = byStanding(items);
  if (reviews.length === 0 && asks.length > 0) {
    return `${String(asks.length)} ready in ${projectName}`;
  }
  if (
    reviews.length === 0 &&
    comments.length === 0 &&
    busy.length === 0 &&
    waits.length > 0 &&
    theirs.length === 0
  ) {
    return `${String(waits.length)} waiting in ${projectName}`;
  }
  if (reviews.some((item) => item.target.kind !== "change")) {
    // What is theirs to review: a colleague's own change listed under it is not.
    return `${String(reviews.length + asks.length + comments.length)} to review in ${projectName}`;
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
  /**
   * The release is offered to the person but is not their move (`releaseWaitsOnViewer`): the
   * project is somebody else's. Its tag and mark stay a door, in the quiet ink, asking nothing.
   */
  readonly quiet?: true | undefined;
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
