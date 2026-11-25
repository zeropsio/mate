/**
 * A project's row says what waits on a review as tags at its end: *Review* opens the one item at
 * once, *Review N* a popover of them, oldest first — with *Review all* where two or more are the
 * person's to review, which steps through them in one review; *Release* opens the release review.
 *
 * The tags sit inside the row but never inside its button: a press, a pointer down or a key on
 * them (or in their popover, which React bubbles through them) never reaches the row.
 */
import { GitMergeIcon, GitPullRequestIcon, RocketIcon, UsersIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  changeActBusy,
  changeTheirs,
  REVIEW_LABEL,
  standingPressLabel,
  standingWaits,
  VIEW_CHANGE,
} from "@t3tools/client-runtime/zerops";
import { usePutLiveStanding } from "~/zerops/putLive";
import { putLiveMark } from "~/zerops/putLive.logic";
import { useOpenReview, useReviewShown } from "~/zerops/review";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Row } from "../ui/row";
import { SectionHeader } from "../ui/section";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { MateOwnerMark } from "./MateOwnerMark";
import { FACE_PALE } from "./menuFace";
import { REVIEW_ALL_LABEL, type QueuedTarget } from "~/zerops/reviewQueue.logic";
import { MateFace } from "./primitives";
import { ownerMark } from "./SidebarMateRow.logic";
import {
  releaseCount,
  releaseTagTip,
  reviewItemByline,
  reviewListWithLeaving,
  reviewMarkOf,
  reviewPopoverTitle,
  reviewTagOf,
  reviewTogether,
  type ProjectReviewItem,
  type ReleaseWaiting,
  type ReviewTagRead,
} from "./SidebarProjectReview.logic";

export {
  changeReviewItem,
  changeRowKey,
  crewTaskReviewItem,
  type ProjectReviewItem,
} from "./SidebarProjectReview.logic";

/** How long a tag, a digit or a popover item takes to go (`tag-out`, the list's row). */
const LEAVE_MS = 160;

/**
 * What waits in a project, after its row's name: the kit's Badge pills. Between a project's name
 * and its Mate's (in the row's title), room on both sides; there it gives way before either name
 * does, a whole mark at a time — a mark that no longer fits wraps under the line, out of sight,
 * never cut, and the empty first item keeps even the first mark from holding the line alone. Its
 * shrink dwarfs the names' so it gives all its room before the Mate's name loses a letter.
 */
const MARKS =
  "inline-flex flex-none items-center gap-1.5 in-data-[slot=row-title]:ms-1.75 in-data-[slot=row-title]:me-px in-data-[slot=row-title]:h-5 in-data-[slot=row-title]:min-w-0 in-data-[slot=row-title]:flex-[0_1000000000_auto] in-data-[slot=row-title]:flex-wrap in-data-[slot=row-title]:overflow-hidden in-data-[slot=row-title]:before:-me-1.5 in-data-[slot=row-title]:before:h-full in-data-[slot=row-title]:before:w-0";

/** A change's face in the popover: 22 px, a colleague's owner's 12 px mark cut out of its corner. */
const MAKER = "relative flex size-5.5 items-center justify-center text-muted-foreground";
const MAKER_CUT =
  "[mask-image:radial-gradient(circle_8px_at_18px_18px,transparent_7.5px,currentColor_8px)]";

/** The header's pill: Review and Release, one door per half (\`ProjectReviewTags\`). */
const TAGS =
  "inline-flex h-7 flex-none items-center overflow-hidden rounded-full bg-primary text-primary-foreground has-[>[data-quiet]:only-child]:bg-card has-[>[data-quiet]:only-child]:text-muted-foreground has-[>[data-quiet]:only-child]:inset-ring-1 has-[>[data-quiet]:only-child]:inset-ring-border";

/**
 * A half's press (the kit's bare Button), or its unseen stand-in's seat: it holds the tag and
 * carries its states — hover, an open popover, quiet, entering and leaving.
 */
const TAG_PRESS =
  "group/tag flex h-full flex-none data-[phase=exit]:pointer-events-none motion-reduce:data-[phase=exit]:hidden";

/**
 * A half: its mark, word and count, shaded under the pointer and while its popover is open; the
 * seam before the second is a short light rule, so each half reads as its own.
 */
const TAG =
  "relative inline-flex h-full flex-none items-center gap-1.5 ps-3 pe-2.5 text-body leading-4 font-semibold whitespace-nowrap transition-[background-color,scale] duration-150 ease-out-strong group-last/tag:pe-3 group-data-popup-open/tag:bg-press-shade pointer-fine:group-hover/tag:bg-press-shade in-[[data-menu-tag]+*]:before:absolute in-[[data-menu-tag]+*]:before:start-0 in-[[data-menu-tag]+*]:before:top-1.75 in-[[data-menu-tag]+*]:before:h-3.5 in-[[data-menu-tag]+*]:before:w-px in-[[data-menu-tag]+*]:before:bg-primary-foreground/34 motion-safe:group-active/tag:scale-96 motion-safe:group-data-[phase=enter]/tag:animate-tag-in motion-safe:group-data-[phase=exit]/tag:animate-tag-out";

/** A count's digit, rolling in from the side its number moves to and out the other. */
const DIGIT = "col-start-1 row-start-1 text-end";
const DIGIT_IN = {
  up: `${DIGIT} motion-safe:animate-digit-from-below`,
  down: `${DIGIT} motion-safe:animate-digit-from-above`,
} as const;
const DIGIT_OUT = {
  up: `${DIGIT} motion-safe:animate-digit-to-above motion-reduce:hidden`,
  down: `${DIGIT} motion-safe:animate-digit-to-below motion-reduce:hidden`,
} as const;

type Phase = "rest" | "enter" | "exit";

/**
 * A tag's presence: there from the first paint without a motion; one that appears later fades in;
 * one that goes keeps its last words while it fades out.
 */
function usePresence<T>(value: T | undefined): {
  readonly shown: T | undefined;
  readonly phase: Phase;
} {
  const [state, setState] = useState<{ shown: T | undefined; phase: Phase }>({
    shown: value,
    phase: "rest",
  });
  let next = state;
  if (value !== undefined) {
    if (state.shown === undefined) next = { shown: value, phase: "enter" };
    else if (state.shown !== value || state.phase === "exit") {
      next = { shown: value, phase: state.phase === "exit" ? "rest" : state.phase };
    }
  } else if (state.shown !== undefined && state.phase !== "exit") {
    next = { shown: state.shown, phase: "exit" };
  }
  if (next !== state) setState(next);
  const leaving = next.phase === "exit";
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setState((current) =>
        current.phase === "exit" ? { shown: undefined, phase: "rest" } : current,
      );
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  return next;
}

function stopPress(event: SyntheticEvent) {
  event.stopPropagation();
}

/** Keys stay with the tags and their popover; Escape still reaches the popover's own dismissal. */
function stopKeys(event: KeyboardEvent) {
  if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
}

export function ProjectReviewTags({
  groupId,
  projectName,
  items,
  release,
  reserve = false,
}: {
  readonly groupId: string;
  readonly projectName: string;
  /** Oldest first, as the project's flow lists them. */
  readonly items: ReadonlyArray<ProjectReviewItem>;
  /** HQ offers the viewer the release (`releaseOffered`): what waits for production. */
  readonly release: ReleaseWaiting | undefined;
  /** Its seat holds the width of every word its Review may take (`RESERVED_WORDS`). */
  readonly reserve?: boolean;
}): ReactNode {
  const review = usePresence(items.length > 0 ? items : undefined);
  const offer = usePresence(release);
  // What Review says to the person looking (`changeStanding`), and its rows in their order: the
  // list follows its items by identity, so the order is made once per items.
  const read = useMemo(
    () => (review.shown === undefined ? undefined : reviewTagOf(review.shown, projectName)),
    [review.shown, projectName],
  );
  if (read === undefined && offer.shown === undefined) return null;
  const tags = (
    // One solid pill, a door per half — Review, then Release, each with its count where more than
    // one waits (the owner's pick, direction B, 2026-10-13), arriving with a small rise, once.
    // Only changes that wait on the people who merge stand behind it: the door asks nothing, so it
    // drops the blue for the card's quiet ground in a hairline.
    <span
      className={`${TAGS} motion-safe:animate-review-arrive`}
      data-zerops-surface="sidebar-project-tags"
      onClick={stopPress}
      onKeyDown={stopKeys}
      onPointerDown={stopPress}
    >
      {read === undefined ? null : (
        <ReviewTag phase={review.phase} projectName={projectName} read={read} />
      )}
      {offer.shown === undefined ? null : (
        <ReleaseTag groupId={groupId} phase={offer.phase} release={offer.shown} />
      )}
    </span>
  );
  if (!reserve || read === undefined) return tags;
  // The widest the tags may grow stands under them unseen: the seat takes its width, the tags
  // keep their own.
  return (
    <span className="inline-grid *:col-start-1 *:row-start-1 *:justify-self-start">
      {tags}
      <span aria-hidden="true" className={`${TAGS} invisible`} inert>
        <span className={TAG_PRESS} data-menu-tag="">
          <span className={TAG}>
            <ReviewFace busy={false} count={read.count} word={<ReservedWord word={read.word} />} />
          </span>
        </span>
        {offer.shown === undefined ? null : (
          <span className={TAG_PRESS} data-menu-tag="">
            <span className={TAG}>
              <ReleaseFace count={releaseCount(offer.shown).count} />
            </span>
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A Mate's conversation's app-bar Review, a normal Mate's and an automated Mate's task
 * conversation alike — the door that stays while the composer's strip can be put away: its
 * changes to review, then what waits for production, together (the owner, 2026-10-12: "it's
 * pretty important after all … maybe placed on the left"). Held in place, unseen, while a review
 * stands open over it, so a merge pressed there never slides the line under the sheet.
 */
export function HeaderReviewDoor({
  review,
  held,
}: {
  readonly review: Parameters<typeof ProjectReviewTags>[0];
  readonly held: boolean;
}): ReactNode {
  const reviewShown = useReviewShown();
  return (
    <span
      aria-hidden={held || undefined}
      className={
        held
          ? "ms-3 me-3.5 inline-flex flex-none items-center invisible"
          : "ms-3 me-3.5 inline-flex flex-none items-center"
      }
      data-chat-header-review=""
      inert={held}
    >
      {/* Under an open review a merge pressed there changes its word: its seat is held as wide as
          the widest word it may take meanwhile, so nothing beside it moves. */}
      <ProjectReviewTags {...review} reserve={reviewShown} />
    </span>
  );
}

/** The words the header's tag may take while a review stands open over it (`changeActWords`). */
const RESERVED_WORDS = ["Merging…", "Couldn't merge", "Not confirmed", "Closing…", "Fixing…"];

/**
 * The door's seat while the menu that draws it is still being read: as wide as the door stood on
 * this page at the last visit (`doorSeatStood`), empty, so the door comes into it and what the
 * chat is about never moves over for it.
 */
export function HeaderReviewSeat({ width }: { readonly width: number }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="ms-3 me-3.5 inline-flex flex-none items-center"
      data-chat-header-review=""
      data-seat=""
      style={{ width }}
    />
  );
}

/**
 * The menu's word on what waits in a project (the owner, 2026-10-12: "in the left menu, just add
 * some clear indication without the ability to merge … after the name, one for merge one for
 * release … with small number when there are more"): a mark for the changes waiting on a review
 * and one for what waits for production, after the row's name. The merge mark is no door: the
 * row's press opens the conversation, whose header holds Review. The release is the project's,
 * not one Mate's (the owner, 2026-10-18: "it should be accessible from the left menu"): its mark
 * opens it, and the press goes no further than the mark.
 */
export function ProjectReviewMarks({
  groupId,
  projectName,
  items,
  release,
  withRun = false,
}: Parameters<typeof ProjectReviewTags>[0] & {
  /**
   * The project's own row: HQ's Put it live of it stands on it in the release mark's place,
   * wherever the person is — under way with its step on hover, stopped with why.
   */
  readonly withRun?: boolean;
}): ReactNode {
  const openReview = useOpenReview();
  const standing = usePutLiveStanding(groupId);
  const run = withRun ? putLiveMark(projectName, standing) : undefined;
  if (items.length === 0 && release === undefined && run === undefined) return null;
  const mark = items.length === 0 ? undefined : reviewMarkOf(items, projectName);
  return (
    <span className={MARKS} data-zerops-surface="sidebar-project-marks">
      {mark === undefined ? null : (
        <Badge
          aria-label={mark.label}
          data-zerops-surface="sidebar-project-review-mark"
          role="img"
          // Its Mate still works on every change it stands for, or every one waits on the people
          // who merge: a plain fact, asking the person nothing.
          tone={mark.asks ? "info" : "neutral"}
        >
          <GitMergeIcon aria-hidden="true" />
          {mark.count > 1 ? <span className="tabular-nums">{mark.count}</span> : null}
        </Badge>
      )}
      {run === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                aria-label={run.tip}
                data-zerops-surface="sidebar-project-run-mark"
                door
                onClick={(event) => {
                  event.stopPropagation();
                  openReview({ kind: "release", groupId }, { from: event.currentTarget });
                }}
                role="img"
                tone={run.kind === "failed" ? "danger" : "info"}
              >
                {run.kind === "releasing" ? (
                  <Spinner aria-hidden="true" role="presentation" size="xs" />
                ) : (
                  <RocketIcon aria-hidden="true" />
                )}
              </Badge>
            }
          />
          <TooltipPopup side="bottom">{run.tip}</TooltipPopup>
        </Tooltip>
      )}
      {release === undefined || run !== undefined ? null : (
        <Badge
          aria-label={`Release: ${releaseTagTip(release)}`}
          data-zerops-surface="sidebar-project-release-mark"
          door
          onClick={(event) => {
            event.stopPropagation();
            openReview({ kind: "release", groupId }, { from: event.currentTarget });
          }}
          role="img"
          // Somebody else's release: there, as plain as a change its Mate still works on.
          tone={release.quiet === true ? "neutral" : "info"}
        >
          <RocketIcon aria-hidden="true" />
          <ReleaseMarkCount release={release} />
        </Badge>
      )}
    </span>
  );
}

function ReleaseMarkCount({ release }: { readonly release: ReleaseWaiting }) {
  const { count, atLeast } = releaseCount(release);
  return count > 1 ? (
    <span className="tabular-nums">{`${String(count)}${atLeast ? "+" : ""}`}</span>
  ) : null;
}

function ReleaseTag({
  groupId,
  release,
  phase,
}: {
  readonly groupId: string;
  readonly release: ReleaseWaiting;
  readonly phase: Phase;
}) {
  const openReview = useOpenReview();
  const tip = releaseTagTip(release);
  const { count } = releaseCount(release);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Release: ${tip}`}
            className={TAG_PRESS}
            data-menu-tag=""
            data-phase={phase}
            // Somebody else's to make: a door still, asking the person nothing.
            data-quiet={release.quiet === true ? "" : undefined}
            data-zerops-surface="sidebar-project-release"
            inert={phase === "exit"}
            onClick={(event) => {
              openReview({ kind: "release", groupId }, { from: event.currentTarget });
            }}
            variant="bare"
          />
        }
      >
        <span className={TAG}>
          <ReleaseFace count={count} />
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tip}</TooltipPopup>
    </Tooltip>
  );
}

/** Release's face: its mark, its word, and its count where more than one waits. */
function ReleaseFace({ count }: { readonly count: number }) {
  return (
    <>
      <RocketIcon aria-hidden="true" className="block size-3.5 flex-none" />
      <span>Release</span>
      <TagCount count={count > 1 ? count : undefined} />
    </>
  );
}

/** Review's face: its mark, or a spinner while a change is acted on, its word and its count. */
function ReviewFace({
  busy,
  word,
  count,
}: {
  readonly busy: boolean;
  readonly word: ReactNode;
  readonly count: number | undefined;
}) {
  return (
    <>
      {busy ? (
        <span aria-hidden="true" className="block size-3.5 flex-none">
          <Spinner role="presentation" size="xs" />
        </span>
      ) : (
        <GitMergeIcon aria-hidden="true" className="block size-3.5 flex-none" />
      )}
      <span>{word}</span>
      <TagCount count={count} />
    </>
  );
}

function ReviewTag({
  read,
  projectName,
  phase,
}: {
  readonly read: ReviewTagRead;
  readonly projectName: string;
  readonly phase: Phase;
}) {
  const openReview = useOpenReview();
  const [open, setOpen] = useState(false);
  const tag = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /** An item was pressed: its review takes the focus, not the tag. */
  const pressed = useRef(false);
  const leaving = phase === "exit";
  // The last item left: the popover goes with its tag.
  if (open && leaving) setOpen(false);
  const listed = read.listed;
  const [only] = listed;
  const many = listed.length > 1;
  return (
    <Popover
      onOpenChange={(next) => {
        if (next && !many && only !== undefined) {
          openReview(only.target, { from: tag.current });
          return;
        }
        if (next && leaving) return;
        if (next) pressed.current = false;
        setOpen(next);
      }}
      open={open}
    >
      <Tooltip disabled={many || open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={read.label}
                  className={TAG_PRESS}
                  data-menu-tag=""
                  // What it holds, as the jump box keys a change (`changeRowKey`): a find lands here.
                  data-zerops-changes={listed.map((item) => item.key).join(" ")}
                  data-phase={phase}
                  // Every change in it waits on the people who merge: it asks the person nothing.
                  data-quiet={read.quiet ? "" : undefined}
                  data-zerops-surface="sidebar-project-review"
                  inert={leaving}
                  ref={tag}
                  variant="bare"
                />
              }
            />
          }
        >
          <span className={TAG}>
            <ReviewFace busy={read.busy === true} count={read.count} word={read.word} />
          </span>
        </TooltipTrigger>
        {only === undefined ? null : (
          <TooltipPopup side="bottom">
            {(only.comment ?? only.says) === undefined
              ? only.title
              : `${only.title} · ${only.comment ?? only.says ?? ""}`}
          </TooltipPopup>
        )}
      </Tooltip>
      <PopoverPopup
        align="end"
        // Below or above its tag, never out to the side over the conversation: where neither
        // holds it whole, the roomier one, its list scrolling in what it has.
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        collisionPadding={8}
        padding="none"
        side="bottom"
        sideOffset={6}
        width="lg"
        data-zerops-surface="sidebar-project-changes"
        // An item pressed keeps the focus its review takes; a tag that left with its last item
        // hands it to its row, never to the page.
        finalFocus={() =>
          pressed.current
            ? false
            : leaving
              ? (tag.current
                  ?.closest("[data-menu-row-box]")
                  ?.querySelector<HTMLElement>("[data-zerops-row]") ?? true)
              : true
        }
        // A press opens it calm, nothing lit as if picked; ↓ then walks into it. Keys land on
        // its first item.
        initialFocus={(openType) => (openType === "keyboard" ? true : list.current)}
      >
        <ReviewList
          items={listed}
          listRef={list}
          onOpen={(item) => {
            pressed.current = true;
            setOpen(false);
            openReview(item.target, { from: tag.current });
          }}
          onOpenAll={(queue) => {
            const [first] = queue;
            if (first === undefined) return;
            pressed.current = true;
            setOpen(false);
            openReview(first, { from: tag.current, queue });
          }}
          projectName={projectName}
        />
      </PopoverPopup>
    </Popover>
  );
}

/** A word in a seat as wide as the widest it may take (`RESERVED_WORDS`), at the seat's start. */
function ReservedWord({ word }: { readonly word: string }) {
  return (
    <span className="inline-grid">
      <span className="col-start-1 row-start-1">{word}</span>
      {RESERVED_WORDS.filter((other) => other !== word).map((other) => (
        <span aria-hidden="true" className="invisible col-start-1 row-start-1" key={other}>
          {other}
        </span>
      ))}
    </span>
  );
}

/** The count after *Review*: a new number slides in as the old one slides out, like a counter. */
function TagCount({ count }: { readonly count: number | undefined }) {
  const [last, setLast] = useState(count);
  const [gone, setGone] = useState<{ count: number | undefined; up: boolean } | undefined>();
  if (count !== last) {
    setGone({ count: last, up: (count ?? 1) > (last ?? 1) });
    setLast(count);
  }
  useEffect(() => {
    if (gone === undefined) return;
    const timer = setTimeout(() => setGone(undefined), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [gone]);
  if (count === undefined && gone?.count === undefined) return null;
  const direction = gone === undefined ? undefined : gone.up ? "up" : "down";
  return (
    // In its own clipped cell: the new number rolls in as the old rolls out. Behind a quiet door
    // alone, a step of its ink.
    <span
      aria-hidden="true"
      className="ms-px inline-grid h-4.5 min-w-4.5 place-items-center overflow-hidden rounded-full bg-primary-foreground/22 px-1.5 text-2xs tabular-nums group-only/tag:group-data-quiet/tag:bg-current/12"
    >
      {gone?.count === undefined ? null : (
        <span className={DIGIT_OUT[direction ?? "up"]} key={`out-${String(gone.count)}`}>
          {String(gone.count)}
        </span>
      )}
      {count === undefined ? null : (
        <span className={direction === undefined ? DIGIT : DIGIT_IN[direction]} key={String(count)}>
          {String(count)}
        </span>
      )}
    </span>
  );
}

/**
 * The popover's items, oldest first, one stop for the arrow keys each: a press anywhere on one
 * opens its review, *Review* at its end is the verb said. It follows the project live: an item
 * that leaves fades where it stood and the list closes over it, one that arrives opens its place.
 */
function ReviewList({
  items,
  projectName,
  onOpen,
  onOpenAll,
  listRef,
}: {
  readonly items: ReadonlyArray<ProjectReviewItem>;
  readonly projectName: string;
  readonly onOpen: (item: ProjectReviewItem) => void;
  /** Reviews the changes that are the person's together, in this order (`reviewTogether`). */
  readonly onOpenAll: (queue: ReadonlyArray<QueuedTarget>) => void;
  /** Where a press's opening puts the focus: on the list, so ↓ walks into it. */
  readonly listRef: RefObject<HTMLDivElement | null>;
}) {
  const headingId = useId();
  const [given, setGiven] = useState(items);
  const [shown, setShown] = useState(() => reviewListWithLeaving([], items));
  // What arrived while it was open opens its place; what was there when it opened just is.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  if (items !== given) {
    const before = new Set(shown.map((entry) => entry.item.key));
    const next = reviewListWithLeaving(shown, items);
    setGiven(items);
    setShown(next);
    setArrived(
      new Set(
        next.map((entry) => entry.item.key).filter((key) => arrived.has(key) || !before.has(key)),
      ),
    );
  }
  // Each time another item starts to leave, every leaving one gets its full fade.
  const leavingKeys = shown
    .filter((entry) => entry.leaving)
    .map((entry) => entry.item.key)
    .join(" ");
  useEffect(() => {
    if (leavingKeys === "") return;
    const timer = setTimeout(() => {
      setShown((current) => current.filter((entry) => !entry.leaving));
    }, LEAVE_MS + 40);
    return () => clearTimeout(timer);
  }, [leavingKeys]);

  const live = shown.filter((entry) => !entry.leaving).map((entry) => entry.item);
  const keys = live.map((item) => item.key);
  const together = reviewTogether(live);
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const current = activeKey !== undefined && keys.includes(activeKey) ? activeKey : keys[0];
  const buttons = useRef(new Map<string, HTMLElement>());

  // The focused item left: the focus moves to the one that now leads, never to the page.
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const left = shown.find(
      (entry) => entry.leaving && buttons.current.get(entry.item.key) === focused,
    );
    if (left === undefined || current === undefined) return;
    buttons.current.get(current)?.focus();
  }, [shown, current]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (keys.length === 0) return;
    const onItem = [...buttons.current.values()].includes(event.target as HTMLElement);
    const at = !onItem || current === undefined ? -1 : keys.indexOf(current);
    let to: string | undefined;
    switch (event.key) {
      case "ArrowDown":
        to = keys[at < 0 ? 0 : Math.min(at + 1, keys.length - 1)];
        break;
      case "ArrowUp":
        to = keys[at < 0 ? keys.length - 1 : Math.max(at - 1, 0)];
        break;
      case "Home":
        to = keys[0];
        break;
      case "End":
        to = keys[keys.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (to === undefined) return;
    setActiveKey(to);
    buttons.current.get(to)?.focus();
  };

  return (
    <div
      aria-labelledby={headingId}
      className="flex max-h-[min(480px,70vh,var(--available-height))] flex-col outline-none"
      onKeyDown={move}
      ref={listRef}
      role="group"
      tabIndex={-1}
    >
      <div className="px-2.5 pt-3 pb-1.5">
        <SectionHeader
          action={
            together.length === 0 ? undefined : (
              <Button
                onClick={() => {
                  onOpenAll(together);
                }}
                size="xs"
                variant="secondary"
              >
                {REVIEW_ALL_LABEL}
              </Button>
            )
          }
          level={3}
          title={<span id={headingId}>{reviewPopoverTitle(live, projectName)}</span>}
        />
      </div>
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {shown.map(({ item, leaving }) => (
          <div
            // An item that leaves fades and the list closes over it; one that arrives opens its
            // place.
            className={
              leaving
                ? "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong *:min-h-0 *:overflow-hidden motion-reduce:transition-opacity motion-reduce:duration-150 grid-rows-[0fr] opacity-0"
                : arrived.has(item.key)
                  ? "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong *:min-h-0 *:overflow-hidden motion-reduce:transition-opacity motion-reduce:duration-150 grid-rows-[1fr] motion-safe:animate-tagpop-arrive"
                  : "grid transition-[grid-template-rows,opacity] duration-200 ease-out-strong *:min-h-0 *:overflow-hidden motion-reduce:transition-opacity motion-reduce:duration-150 grid-rows-[1fr]"
            }
            inert={leaving}
            key={item.key}
          >
            {/* The cell the row closes and opens: no padding of its own, so it reaches 0. */}
            <div>
              <ReviewListItem
                current={item.key === current}
                item={item}
                together={together.length > 0}
                onFocus={() => setActiveKey(item.key)}
                onOpen={() => onOpen(item)}
                refOf={(element) => {
                  if (element === null) buttons.current.delete(item.key);
                  else buttons.current.set(item.key, element);
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewListItem({
  item,
  current,
  together,
  onFocus,
  onOpen,
  refOf,
}: {
  readonly item: ProjectReviewItem;
  readonly current: boolean;
  /** *Review all* stands over the list: no item's verb is a second press as loud as it. */
  readonly together: boolean;
  readonly onFocus: () => void;
  readonly onOpen: () => void;
  readonly refOf: (element: HTMLElement | null) => void;
}) {
  const bylineId = useId();
  const [truncated, setTruncated] = useState(false);
  const Mark = item.target.kind === "crew-task" ? UsersIcon : GitPullRequestIcon;
  // Its verb by where it stands for the person: Review, Ask to merge, or — where it waits on the
  // people who merge — a plain way in, on a row as quiet as a colleague's.
  // A colleague's own change is theirs to merge or to ask for: the same plain way in.
  // One somebody commented on is the person's to read: its way in is not the quiet one.
  // One on its way — merging, closing, its Mate fixing it — is only to look at meanwhile.
  const waits =
    (standingWaits(item.standing) && item.comment === undefined) ||
    changeTheirs(item) ||
    changeActBusy(item.act) ||
    item.act?.kind === "merged";
  const verb =
    waits || standingWaits(item.standing)
      ? VIEW_CHANGE
      : standingPressLabel(item.standing, REVIEW_LABEL);
  return (
    <Row
      aria-describedby={bylineId}
      aria-label={`${verb} ${item.title}`}
      className="group/change"
      data-standing={item.standing}
      data-zerops-change={item.key}
      data-zerops-surface="sidebar-project-change"
      // In full where it is the viewer's move; paler where it is somebody else's.
      lead={<ReviewMaker by={item.by} pale={waits} />}
      line={<span id={bylineId}>{reviewItemByline(item)}</span>}
      meta={
        // The row is the press; its verb wears the one Review look, or none where nothing is asked.
        <Button
          className="motion-safe:group-active/change:scale-96"
          render={<span aria-hidden="true" />}
          size="xs"
          variant={waits || together ? "ghost" : "secondary"}
        >
          {verb}
        </Button>
      }
      onClick={onOpen}
      onFocus={onFocus}
      pressable
      ref={refOf}
      render={<button type="button" />}
      size="sm"
      tabIndex={current ? 0 : -1}
      title={
        <Tooltip disabled={!truncated}>
          <TooltipTrigger
            render={
              <span
                className="block truncate text-body leading-4.5 font-medium"
                onPointerEnter={(event) => {
                  const element = event.currentTarget;
                  setTruncated(element.scrollWidth > element.clientWidth);
                }}
              />
            }
          >
            <Mark
              aria-hidden="true"
              className="me-1.25 inline-block size-3 align-[-1px] text-muted-foreground"
            />
            {item.title}
          </TooltipTrigger>
          <TooltipPopup side="top">{item.title}</TooltipPopup>
        </Tooltip>
      }
    />
  );
}

/** Who made it: its Mate's face, a colleague's with its owner's mark on the corner. */
function ReviewMaker({
  by,
  pale,
}: {
  readonly by: ProjectReviewItem["by"];
  /** Somebody else's to move: its face paler. */
  readonly pale: boolean;
}) {
  if (by === undefined) {
    return (
      <span aria-hidden="true" className={MAKER}>
        <GitPullRequestIcon className="me-1.25 inline-block size-3 align-[-1px] text-muted-foreground" />
      </span>
    );
  }
  const mark =
    by.owner ??
    (by.ownerName === undefined
      ? undefined
      : ownerMark({ name: by.ownerName, initials: "", avatarUrl: null }));
  return (
    <span aria-hidden="true" className={MAKER}>
      <span className={cn("flex", mark !== undefined && MAKER_CUT, pale && FACE_PALE)}>
        <MateFace className="size-5.5" shape={by.shape} size={20} state="idle" tint={by.tint} />
      </span>
      {mark === undefined ? null : (
        <MateOwnerMark className="top-3 left-3 size-3 text-5xs" seat={{ kind: "person", mark }} />
      )}
    </span>
  );
}
