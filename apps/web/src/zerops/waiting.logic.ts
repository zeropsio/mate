/**
 * What needs the viewer, one list, and its one unit: one thing to act on — a Mate's plan to
 * approve, a question to answer, a Mate of theirs stopped on an error, a Mate's changes to review,
 * its agent's sign-in only the viewer can make, a crewmate's question or finished work, an
 * automated Mate's task waiting for an answer from the Mate's owner or the person who put it on the
 * Board, a task of theirs whose need broke — in the menu's order, then every project whose release
 * is offered, less what the viewer set aside until it changes (`snoozeOf`). One decision makes it (`needsYou`); every surface that
 * counts or says what
 * waits reads this list and these words: the menu's badge, its Needs you list and the rail, the
 * overview's tab, a project's card and page.
 */
import {
  changesCountWords,
  ASK_TO_MERGE,
  REVIEW_LABEL,
  REVIEW_RELEASE_LABEL,
} from "@t3tools/client-runtime/zerops";
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";
import {
  MATE_SHAPE_OF_TINT,
  type MateMarkState,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import type { BoardWait } from "@t3tools/client-runtime/data";
import type { CrewDigest } from "@t3tools/shared/mateLink";
import type { ThreadStatusKind } from "@t3tools/shared/threadStatus";

import { mateFaceOf, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { crewFaces } from "~/zerops/crew/crewDigest";
import { putLiveHoldsRelease } from "~/zerops/putLive.logic";

export type WaitingKind = "plan" | "question" | "failed" | "change" | "sign-in";

/** A Mate's change that waits for the viewer's review: the review's own target. */
export interface WaitingChange {
  readonly groupId: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  /**
   * The person cannot merge in its application and nobody asked yet (`changeStanding` `to-ask`):
   * what waits on them is their ask to merge, never a review.
   */
  readonly ask?: true | undefined;
  /** Its head as HQ last said it: a push is a new revision of the change (`snoozeOf`). */
  readonly head?: string | undefined;
  /**
   * Two or more of its Mate's changes the person reviews themselves, in the order reviewing them
   * together goes through (`reviewQueueOrder`): its Review steps through every one.
   */
  readonly queue?:
    | ReadonlyArray<{ readonly repository: string; readonly number: number }>
    | undefined;
}

export interface WaitingMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  /** The shape its person picked, else its tint's own (`mateShapeOf`). */
  readonly shape: MateShapeId;
  readonly face: MateMarkState;
  readonly kind: WaitingKind;
  /** Its words for it: the question, the plan, the error, the change's title, the sign-in. */
  readonly text?: string | undefined;
  /** How many of its changes wait for review, where that is what waits (`mateReviewCount`). */
  readonly changes?: number | undefined;
  /** Where its conversation is, for the list to answer it in place. */
  readonly environmentId?: string | undefined;
  readonly threadId?: string | undefined;
  /** Its change waiting for review, where that is what waits. */
  readonly change?: WaitingChange | undefined;
  /** When its conversation last moved (`ZeropsAgentActivity.at`): a new ask is a new revision. */
  readonly at?: string | undefined;
}

/** A project whose next release is offered: what is on its stage, not yet in production. */
export interface WaitingRelease {
  readonly changeCount?: number | undefined;
  readonly groupId: string;
  readonly name: string;
  /** How many changes the release would carry; unknown where HQ did not count. */
  readonly ahead: number | undefined;
}

/** Who on a Mate's crew needs the viewer, as its face shows it. */
export interface WaitingCrewmate {
  readonly handle: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  /** Its chat, where what it asks stands; `null` before its first turn. */
  readonly threadId: string | null;
}

/**
 * What a crewmate of the viewer's own Mate needs from them, as the crew's digest says it: a row of
 * the crew's own *Waiting on you* list (its kind, an open vocabulary: `question`, `plan`,
 * `conflict`…), its chat asking with no such row, or a finished task for the viewer to review and
 * add to the Mate's code.
 */
export type WaitingCrewNeed =
  | { readonly kind: "row"; readonly rowId: string; readonly row: string }
  | { readonly kind: "chat"; readonly turnId?: string }
  | { readonly kind: "ready"; readonly taskId: string };

export interface WaitingCrew {
  /** The Mate whose crew it is. */
  readonly projectId: string;
  readonly mateName: string;
  readonly environmentId?: string | undefined;
  readonly crewmate: WaitingCrewmate;
  readonly need: WaitingCrewNeed;
}

/** An automated Mate's task that waits for a person's answer (HQ's `task.waiting`). */
export interface WaitingTask {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly environmentId?: string | undefined;
  readonly taskId: string;
  readonly title: string;
  /** Where it came from, where its question was asked; none for a schedule's. */
  readonly url: string | null;
  /** When it last asked (`HqNavigationMateTask.askedAt`): a new question is a new revision. */
  readonly askedAt?: string | undefined;
  /**
   * The viewer put it on the Board from a chat: they answer it on their own card there (or on the
   * Board), not in the pool Mate's conversation.
   */
  readonly put?: true | undefined;
}

export type WaitingItem =
  | { readonly kind: WaitingKind; readonly key: string; readonly mate: WaitingMate }
  | { readonly kind: "crew"; readonly key: string; readonly crew: WaitingCrew }
  | { readonly kind: "task"; readonly key: string; readonly task: WaitingTask }
  /**
   * A task the viewer put on a Board whose automated Mate asks them, as HQ says it (`asksYou`),
   * where no Mate row of theirs carries it: answered on the Board.
   */
  | { readonly kind: "asked"; readonly key: string; readonly board: BoardWait }
  /**
   * A held task the viewer put whose need broke (`heldBroken`): it waits on them to drop that need
   * or stop it, on the Board.
   */
  | { readonly kind: "held"; readonly key: string; readonly board: BoardWait }
  | { readonly kind: "release"; readonly key: string; readonly release: WaitingRelease };

/** What waits in a Mate's own conversation: its plan, question, error, changes or sign-in. */
export type WaitingMateItem = Extract<WaitingItem, { readonly mate: WaitingMate }>;

export function isMateWait(item: WaitingItem): item is WaitingMateItem {
  return "mate" in item;
}

/** The Mate an item is about; none for a release or a Board's task. */
export function waitingProjectId(item: WaitingItem): string | undefined {
  switch (item.kind) {
    case "release":
    case "asked":
    case "held":
      return undefined;
    case "crew":
      return item.crew.projectId;
    case "task":
      return item.task.projectId;
    default:
      return item.mate.projectId;
  }
}

/** The project an item names itself, with no Mate between: a release's, a Board task's. */
export function waitingGroupId(item: WaitingItem): string | undefined {
  switch (item.kind) {
    case "release":
      return item.release.groupId;
    case "asked":
    case "held":
      return item.board.appId;
    default:
      return undefined;
  }
}

/**
 * What a Mate waiting on the viewer waits for, by the one resolver's kind (R5): asking comes
 * before its change, since the change waits on the answer. The one order: the waiting list and the
 * project card's lift (`cardMateReading`) both read it.
 */
export function waitingKindOf(input: {
  readonly activityKind: ThreadStatusKind | undefined;
  readonly reviewWaits: boolean;
}): WaitingKind {
  if (input.activityKind === "failed") return "failed";
  if (input.activityKind === "planReady") return "plan";
  if (input.activityKind === "input" || input.activityKind === "approval") return "question";
  return input.reviewWaits ? "change" : "question";
}

/**
 * Whether a project's next release is offered — the one gate every surface asks: the flow's gate
 * allows it, or the review would check a refused branch again (`GitDelivery.recheck`), and no Put
 * it live run is making the production it would release.
 */
export function releaseOffered(input: {
  readonly allowed: boolean | undefined;
  readonly recheck?: boolean | undefined;
  readonly putLive: Parameters<typeof putLiveHoldsRelease>[0];
}): boolean {
  return (input.allowed === true || input.recheck === true) && !putLiveHoldsRelease(input.putLive);
}

/** What of a Mate's row activity says whether, and how, it waits on the viewer. */
export type NeedsYouActivity = Pick<
  ZeropsAgentActivity,
  | "threadId"
  | "kind"
  | "face"
  | "snippet"
  | "pausedUntil"
  | "remembered"
  | "usageLimited"
  | "errorLine"
  | "question"
> &
  /** When its conversation last moved: a new ask is a new revision of it (`snoozeOf`). */
  Partial<Pick<ZeropsAgentActivity, "at">>;

/**
 * One of the viewer's listed Mates, as the data layer answers for it: what its row reads, what HQ
 * says of whom it waits on, its changes for the viewer's review, its crew and its task.
 */
export interface NeedsYouMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly environmentId?: string | undefined;
  /** Its socket is up. */
  readonly connected: boolean;
  /** It waits on the viewer, as HQ says it (`waitsOnViewer`): another's Mate waits on its owner. */
  readonly mine: boolean;
  /** What its row reads (`useMateRowActivity`): HQ's word, or its socket's. */
  readonly activity: NeedsYouActivity | undefined;
  /** Its agent's sign-in, where it waits on the viewer (`useSignInWaits`): its composer's words. */
  readonly signIn?: string | undefined;
  /** How many of its own changes wait for the viewer's review (`mateReviewCount`). */
  readonly reviewCount: number;
  /** Its change that waits for review, as the review opens it. */
  readonly change?: WaitingChange | undefined;
  /** Its applied crew as HQ last told of it; `current` while that is HQ's word of now. */
  readonly crew?:
    | {
        readonly digest: CrewDigest;
        readonly current: boolean;
        /** Whether a ready task's review is the viewer's to open (`crewTaskReviewable`). */
        readonly reviewable: (taskId: string) => boolean;
      }
    | undefined;
  /** The task an automated Mate is on (HQ's `task`); none for another Mate or a free one. */
  readonly task?:
    | {
        readonly id: string;
        readonly title: string;
        readonly url: string | null;
        readonly waiting?: true | undefined;
        readonly askedAt?: string | undefined;
        /** Who put it on the Board from a conversation, by Zerops user id: it waits on them too. */
        readonly putBy?: string | undefined;
      }
    | null
    | undefined;
  /** Its attention (`matesAttention`): how many of its chats work, and its finished turns. */
  readonly attention?:
    | {
        readonly live: boolean;
        readonly working: number;
        readonly results: ReadonlyArray<{ readonly completedAt: string }>;
      }
    | undefined;
}

/** The quiet line under what needs the viewer: what runs for them, and what they got today. */
export interface NeedsYouCounts {
  /** Their own Mates' chats at work now, and their crewmates at work. */
  readonly running: number;
  /** Their own Mates' turns finished since the day began. */
  readonly doneToday: number;
}

/** What waits in a Mate's own conversation — asking, stopped, its changes, its sign-in — if any. */
function conversationWait(mate: NeedsYouMate): WaitingMate | undefined {
  const where = {
    projectId: mate.projectId,
    name: mate.name,
    tint: mate.tint,
    shape: mate.shape,
    ...(mate.environmentId === undefined ? {} : { environmentId: mate.environmentId }),
  };
  // Nothing else of it moves before its agent is signed in: that is what waits.
  if (mate.signIn !== undefined)
    return { ...where, face: "needs", kind: "sign-in", text: mate.signIn };
  const { activity, mine } = mate;
  const reviewWaits = mate.reviewCount > 0;
  // The face its row wears (`mateFaceOf`): asking, or its change waiting for your review — read
  // from HQ or its socket, as the row reads it; a word at rest asks nothing now.
  const face = mateFaceOf({
    connected: mate.connected,
    activity,
    reviewWaits,
    mine,
    // Only a face that needs you stands here, and no pose of its life gives that.
    pose: undefined,
  });
  // Stopped on an error, a Mate of the viewer's waits on them for help: its face stands still.
  const failed = mine && activity?.remembered !== true && activity?.kind === "failed";
  if (face !== "needs" && !failed) return undefined;
  const kind = waitingKindOf({ activityKind: activity?.kind, reviewWaits });
  const change = kind === "change" ? mate.change : undefined;
  const text =
    kind === "failed"
      ? activity?.errorLine
      : kind === "change"
        ? change?.title
        : kind === "question"
          ? (activity?.question ?? activity?.snippet)
          : activity?.snippet;
  return {
    ...where,
    face,
    kind,
    ...(text === undefined ? {} : { text }),
    ...(activity?.at === undefined ? {} : { at: activity.at }),
    ...(kind === "change" ? { changes: mate.reviewCount } : {}),
    ...(activity?.threadId === undefined ? {} : { threadId: activity.threadId }),
    ...(change === undefined ? {} : { change }),
  };
}

/**
 * What a crew of the viewer's own Mate needs from them, while HQ's word of it is of now: each row
 * of its *Waiting on you* list (one naming nobody on the crew goes to its lead, or its first),
 * each crewmate whose chat asks with no row of its own, then each finished task the viewer lands
 * and may review — never a row for a ready task, which is that task's.
 */
function crewWaits(mate: NeedsYouMate): ReadonlyArray<WaitingItem> {
  const crew = mate.crew;
  if (crew === undefined || !crew.current || !mate.mine) return [];
  const faces = crewFaces(crew.digest, true);
  const fallback = faces.find((face) => face.lead) ?? faces[0];
  if (fallback === undefined) return [];
  const crewmateOf = (handle: string | null): WaitingCrewmate => {
    const face = faces.find((each) => each.handle === handle) ?? fallback;
    return {
      handle: face.handle,
      name: face.displayName,
      tint: face.tint,
      shape: MATE_SHAPE_OF_TINT[face.tint],
      threadId: face.threadId,
    };
  };
  const base = {
    projectId: mate.projectId,
    mateName: mate.name,
    ...(mate.environmentId === undefined ? {} : { environmentId: mate.environmentId }),
  };
  const item = (key: string, crewmate: WaitingCrewmate, need: WaitingCrewNeed): WaitingItem => ({
    kind: "crew",
    key: `c:${mate.projectId}:${key}`,
    crew: { ...base, crewmate, need },
  });
  const rows = crew.digest.attention.filter((row) => row.kind !== "ready-to-land");
  // Finished work the crew does not add itself (`crewPersonLands`), the viewer's to review.
  const ready = crew.digest.personLands ? crew.digest.readyTasks : [];
  const named = new Set(rows.map((row) => crewmateOf(row.handle).handle));
  return [
    ...rows.map((row) =>
      item(`r:${row.id}`, crewmateOf(row.handle), { kind: "row", rowId: row.id, row: row.kind }),
    ),
    ...faces
      .filter((face) => face.state === "needs" && !named.has(face.handle))
      .map((face) =>
        item(`h:${face.handle}`, crewmateOf(face.handle), {
          kind: "chat",
          ...(face.turnId === undefined ? {} : { turnId: face.turnId }),
        }),
      ),
    ...ready
      .filter((task) => crew.reviewable(task.id))
      .map((task) =>
        item(`t:${task.id}`, crewmateOf(task.owner), { kind: "ready", taskId: task.id }),
      ),
  ];
}

/**
 * What the viewer set aside until it changes (HQ's `HqSnooze`), as the decision reads it: an item's
 * key (`snoozeOf`) and its revision when it was set aside.
 */
export interface NeedsYouSnooze {
  readonly item: string;
  readonly revision: string;
}

/**
 * An item as the viewer sets it aside (`PUT /api/me/snoozes`): its key — `task:<id>`,
 * `held:<id>`, `change:<project>/<repo>#<n>`, `ask:<mate>:<what>`, `release:<project>` — and its
 * own revision, which moves when it changes (a new question, a need broken again, a push, a
 * release grown); `null` for one whose revision is not known, which cannot be set aside. A task
 * that asks is one key whether its Mate's row or HQ's `asksYou` shows it, so a snooze holds both.
 */
export function snoozeOf(item: WaitingItem): NeedsYouSnooze | null {
  switch (item.kind) {
    case "task":
      return item.task.askedAt === undefined
        ? null
        : { item: `task:${item.task.taskId}`, revision: item.task.askedAt };
    case "asked":
      return { item: `task:${item.board.taskId}`, revision: item.board.at };
    case "held":
      return { item: `held:${item.board.taskId}`, revision: item.board.at };
    case "release":
      return item.release.ahead === undefined
        ? null
        : { item: `release:${item.release.groupId}`, revision: String(item.release.ahead) };
    case "crew": {
      // A crewmate's new ask is a new row of its crew's list, a new ready task its own, and a new
      // question in its chat a new turn: the row's, the task's or the turn's id is the revision. A
      // chat from a Mate whose digest names no turn cannot be set aside.
      const { need, crewmate } = item.crew;
      const who = `ask:${item.crew.projectId}:${crewmate.handle}`;
      return need.kind === "row"
        ? { item: `${who}:row`, revision: need.rowId }
        : need.kind === "ready"
          ? { item: `${who}:ready:${need.taskId}`, revision: need.taskId }
          : need.turnId === undefined
            ? null
            : { item: `${who}:chat`, revision: need.turnId };
    }
    case "change": {
      const change = item.mate.change;
      return change?.head === undefined
        ? null
        : {
            item: `change:${change.groupId}/${change.repository}#${String(change.number)}`,
            revision: change.head,
          };
    }
    default: {
      // What its conversation asks, by when it last moved: a new question is a new ask.
      const at = item.mate.at;
      return at === undefined
        ? null
        : { item: `ask:${item.mate.projectId}:${item.kind}`, revision: at };
    }
  }
}

/**
 * What needs the viewer, the one decision every surface reads: for each of their Mates in the
 * menu's order (one the menu does not hold, last), what waits in its conversation, then what its
 * crew needs, then its task waiting for an answer — said only where its conversation says nothing
 * of its own, since that is where the task asks; then every release offered to them. Another's
 * Mate waits on its owner, not here — but a task it holds that the viewer put on the Board waits
 * on them (`viewer`, their Zerops user id). After every Mate, the tasks HQ says the viewer put
 * whose Mate asks them (`asked`) that no Mate row carries — one a row carries is that row's, said
 * once — then their held tasks whose need broke (`broken`), each oldest first. What the viewer set
 * aside (`snoozes`) is left out while its revision is still the one set aside. Beside it, what runs for the viewer and what they got
 * today, counted from `dayStart` (the start of the viewer's day, in epoch milliseconds).
 */
export function needsYou(input: {
  readonly mates: ReadonlyArray<NeedsYouMate>;
  readonly order: ReadonlyArray<string>;
  readonly releases: ReadonlyArray<WaitingRelease>;
  readonly dayStart: number;
  readonly viewer?: string | undefined;
  /** HQ's `asksYou`: the viewer's puts whose automated Mate asks them (`boardWaits`). */
  readonly asked?: ReadonlyArray<BoardWait> | undefined;
  /** HQ's `heldBroken`: the viewer's held tasks whose need broke (`boardWaits`). */
  readonly broken?: ReadonlyArray<BoardWait> | undefined;
  readonly snoozes?: ReadonlyArray<NeedsYouSnooze> | undefined;
}): { readonly items: ReadonlyArray<WaitingItem>; readonly counts: NeedsYouCounts } {
  const place = (projectId: string) => {
    const at = input.order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const mates = input.mates.toSorted(
    (left, right) => place(left.projectId) - place(right.projectId),
  );
  const items: Array<WaitingItem> = [];
  const finishedToday = (at: string) => Date.parse(at) >= input.dayStart;
  let running = 0;
  let doneToday = 0;
  // The asking tasks a Mate row says, in its task's item or its own conversation's.
  const carried = new Set<string>();
  for (const mate of mates) {
    const wait = conversationWait(mate);
    if (wait !== undefined) items.push({ kind: wait.kind, key: `m:${mate.projectId}`, mate: wait });
    items.push(...crewWaits(mate));
    const task = mate.task;
    // Its owner hears the task's question, and so does the person who put it on the Board
    // whoever's Mate holds it — where its conversation says nothing of its own.
    const asks =
      task?.waiting === true &&
      wait === undefined &&
      (mate.mine || (input.viewer !== undefined && task.putBy === input.viewer));
    if (task?.waiting === true && (asks || wait !== undefined)) carried.add(task.id);
    if (asks)
      items.push({
        kind: "task",
        key: `t:${mate.projectId}:${task.id}`,
        task: {
          projectId: mate.projectId,
          name: mate.name,
          tint: mate.tint,
          shape: mate.shape,
          ...(mate.environmentId === undefined ? {} : { environmentId: mate.environmentId }),
          taskId: task.id,
          title: task.title,
          url: task.url,
          ...(task.askedAt === undefined ? {} : { askedAt: task.askedAt }),
          ...(input.viewer !== undefined && task.putBy === input.viewer
            ? { put: true as const }
            : {}),
        },
      });
    if (!mate.mine) continue;
    const attention = mate.attention;
    if (attention?.live === true) running += attention.working;
    if (mate.crew?.current === true)
      running += crewFaces(mate.crew.digest, true).filter(
        (face) => face.state === "working",
      ).length;
    doneToday +=
      attention?.results.filter((result) => finishedToday(result.completedAt)).length ?? 0;
  }
  const oldestFirst = (tasks: ReadonlyArray<BoardWait> | undefined) =>
    (tasks ?? []).toSorted((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  for (const board of oldestFirst(input.asked))
    if (!carried.has(board.taskId))
      items.push({ kind: "asked", key: `a:${board.appId}:${board.taskId}`, board });
  for (const board of oldestFirst(input.broken))
    items.push({ kind: "held", key: `b:${board.appId}:${board.taskId}`, board });
  for (const release of input.releases)
    items.push({ kind: "release", key: `r:${release.groupId}`, release });
  const aside = new Map((input.snoozes ?? []).map((snooze) => [snooze.item, snooze.revision]));
  const shown = items.filter((item) => {
    const snooze = snoozeOf(item);
    return snooze === null || aside.get(snooze.item) !== snooze.revision;
  });
  return { items: shown, counts: { running, doneToday } };
}

/** What waits, in its leading words: the menu's line, a card's and a page's say these first. */
export function waitingPhrase(item: WaitingItem): string {
  if (item.kind === "release") return `Release ${item.release.name}`;
  if (item.kind === "task") return `Answer ${item.task.name}`;
  if (item.kind === "asked") return `Answer ${crewPossessive(item.board.appName)} task`;
  if (item.kind === "held") return `Unblock ${crewPossessive(item.board.appName)} task`;
  if (item.kind === "crew") {
    const { crewmate, need } = item.crew;
    if (need.kind === "ready") return `Review ${crewPossessive(crewmate.name)} work`;
    if (need.kind === "chat" || need.row === "question") return `Answer ${crewmate.name}`;
    return need.row === "plan"
      ? `See ${crewPossessive(crewmate.name)} plan`
      : `Help ${crewmate.name}`;
  }
  const { name, changes } = item.mate;
  switch (item.kind) {
    case "plan":
      return `Approve ${name}'s plan`;
    case "change": {
      const verb = waitingVerb(item);
      return changes !== undefined && changes > 1
        ? `${verb} ${name}'s ${String(changes)} changes`
        : `${verb} ${name}'s change`;
    }
    case "failed":
      return `Help ${name}`;
    case "question":
      return `Answer ${name}`;
    case "sign-in":
      return `Sign ${name} in`;
  }
}

/** The one verb a wait offers, by its kind, on every surface that offers one. */
export const WAITING_VERBS = {
  change: REVIEW_LABEL,
  plan: "See plan",
  question: "Answer",
  failed: "Ask to fix it",
  release: REVIEW_RELEASE_LABEL,
  "sign-in": "Sign in",
  task: "Answer",
  asked: "Answer",
  held: "Open Board",
  crew: "Open",
} as const satisfies Record<WaitingItem["kind"], string>;

export type WaitingVerb =
  | (typeof WAITING_VERBS)[WaitingItem["kind"]]
  | typeof ASK_TO_MERGE
  | typeof REVIEW_LABEL;

/**
 * A wait's verb for the person looking: its kind's (`WAITING_VERBS`), and *Ask to merge* for a
 * change of an application they cannot merge in — it waits on their ask, never on their review.
 * A crewmate's question is answered, its finished work reviewed, the rest opened in its crew.
 */
export function waitingVerb(item: WaitingItem): WaitingVerb {
  if (item.kind === "crew") {
    const { need } = item.crew;
    if (need.kind === "ready") return REVIEW_LABEL;
    if (need.kind === "chat" || need.row === "question") return WAITING_VERBS.question;
    return need.row === "plan" ? WAITING_VERBS.plan : WAITING_VERBS.crew;
  }
  return item.kind === "change" && item.mate.change?.ask === true
    ? ASK_TO_MERGE
    : WAITING_VERBS[item.kind];
}

/** The row's line: the first two things, and how many more wait. */
export function waitingSummary(items: ReadonlyArray<WaitingItem>): {
  readonly words: string;
  readonly more: number;
} {
  const shown = items.slice(0, 2);
  return { words: shown.map(waitingPhrase).join(" · "), more: items.length - shown.length };
}

/** The list's name, wherever it is named: its title, its count's tooltip. */
export const NEEDS_YOU_TITLE = "Needs you";

/** What the list holds, under its title. */
export const NEEDS_YOU_LINE = "Everything waiting on you, from every conversation and the crew";

/** The quiet line under the list: what runs for the person, and what they got today. */
export function needsYouCountsLine(counts: NeedsYouCounts): string {
  return `Running ${String(counts.running)} · Done today ${String(counts.doneToday)}`;
}

/** The press, and the field it opens, that steers what waits with a message. */
export const needsYouTellLabel = (name: string): string => `Tell ${name}…`;

/** An automated Mate's task, under its name: what it is on, waiting for an answer. */
export const needsYouTaskLine = (title: string): string => `${title} · waiting for your answer`;

/** A held task of the person's, under its project's name: one of the tasks it needs broke. */
export const needsYouHeldLine = (title: string): string => `${title} · a task it needs broke`;

/** A Mate's changes for the person's review, under its name, where there are several. */
export const needsYouChangesLine = (count: number): string =>
  `${String(count)} changes waiting for you`;

/** A crewmate's finished work, under its name, and whether a review already passed it. */
export const needsYouReadyLine = (title: string, reviewed: boolean): string =>
  reviewed ? `${title} · ready, reviewed` : `${title} · ready for your review`;

/** Whose crew a crewmate is on, beside its name. */
export const needsYouCrewOf = (mateName: string): string => `${crewPossessive(mateName)} crew`;

/** What a crewmate needs, under its name, before its crew is read: its digest's kind in words. */
export function needsYouCrewLine(need: WaitingCrewNeed): string {
  if (need.kind === "ready") return "Its work is ready";
  if (need.kind === "chat" || need.row === "question") return "It asks you something.";
  return need.row === "plan" ? "The lead has a plan." : "Needs you.";
}

/**
 * What a bare count of the waiting things says it counts — its accessible name, and the line its
 * tooltip carries under its name (`NEEDS_YOU_TITLE`) — so a number never stands without its noun.
 */
export function waitingCountWords(items: ReadonlyArray<WaitingItem>): {
  readonly label: string;
  readonly line: string;
} {
  const { words, more } = waitingSummary(items);
  return {
    label: `${NEEDS_YOU_TITLE}, ${String(items.length)}: ${words}${more > 0 ? `, ${String(more)} more` : ""}`,
    line: `${words}${more > 0 ? ` · ${String(more)} more` : ""}`,
  };
}

/** An item's title in the list: the Mate's name, or the release in a sentence. */
export function waitingTitle(item: WaitingItem): string {
  switch (item.kind) {
    case "release":
      return `${item.release.name} is ready to release`;
    case "crew":
      return item.crew.crewmate.name;
    case "task":
      return item.task.name;
    case "asked":
    case "held":
      return item.board.appName;
    default:
      return item.mate.name;
  }
}

export function releaseWaitingLine(release: WaitingRelease): string {
  const { ahead } = release;
  if (ahead === undefined || ahead <= 0) return "What is on stage is not in production yet.";
  if (release.changeCount !== undefined)
    return `${changesCountWords(ahead, false, release.changeCount)} waiting for production.`;
  return `${String(ahead)} change${ahead === 1 ? " is" : "s are"} on stage, not yet in production.`;
}
