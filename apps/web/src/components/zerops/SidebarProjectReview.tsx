/**
 * A project's row says what waits on a review as tags at its end: *Review* opens the one item at
 * once, *Review N* a popover of them, oldest first; *Release* opens the release review.
 *
 * The tags sit inside the row but never inside its button: a press, a pointer down or a key on
 * them (or in their popover, which React bubbles through them) never reaches the row.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { GitMergeIcon, GitPullRequestIcon, RocketIcon, UsersIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";

import { useOpenReview } from "~/zerops/review";
import { gatedPortal } from "../ui/portal-gate";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MateOwnerMark } from "./MateOwnerMark";
import { MateFace } from "./primitives";
import { ownerMark } from "./SidebarMateRow.logic";
import {
  releaseTagTip,
  reviewItemByline,
  reviewListWithLeaving,
  reviewPopoverTitle,
  reviewTagLabel,
  type ProjectReviewItem,
} from "./SidebarProjectReview.logic";

export {
  changeReviewItem,
  changeRowKey,
  crewTaskReviewItem,
  type ProjectReviewItem,
} from "./SidebarProjectReview.logic";

const TagPortal = gatedPortal(PopoverPrimitive.Portal);

/** How long a tag, a digit or a popover item takes to go (`.menu-tag`, `.menu-tagpop-row`). */
const LEAVE_MS = 160;

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
  word = "Review",
  releaseWord = "Release",
}: {
  readonly groupId: string;
  readonly projectName: string;
  /** Oldest first, as the project's flow lists them. */
  readonly items: ReadonlyArray<ProjectReviewItem>;
  /** HQ offers the viewer the release (`releaseOffered`): what waits for production. */
  readonly release: { readonly waiting: number; readonly atLeast: boolean } | undefined;
  /** Review's own word. */
  readonly word?: string;
  /** Release's own word; the conversation's header says what a press does, "Review release". */
  readonly releaseWord?: string;
}): ReactNode {
  const review = usePresence(items.length > 0 ? items : undefined);
  const offer = usePresence(release);
  if (review.shown === undefined && offer.shown === undefined) return null;
  return (
    <span
      className="menu-tags"
      data-zerops-surface="sidebar-project-tags"
      onClick={stopPress}
      onKeyDown={stopKeys}
      onPointerDown={stopPress}
    >
      {review.shown === undefined ? null : (
        <ReviewTag
          items={review.shown}
          phase={review.phase}
          projectName={projectName}
          word={word}
        />
      )}
      {offer.shown === undefined ? null : (
        <ReleaseTag
          groupId={groupId}
          phase={offer.phase}
          release={offer.shown}
          word={releaseWord}
        />
      )}
    </span>
  );
}

/**
 * The menu's word on what waits in a project (the owner, 2026-10-12: "in the left menu, just add
 * some clear indication without the ability to merge … after the name, one for merge one for
 * release … with small number when there are more"): a mark for the changes waiting on a review
 * and one for what waits for production, after the row's name, never a door — the row's press
 * opens the conversation, whose header holds Review and Release (`ProjectReviewTags`).
 */
export function ProjectReviewMarks({
  projectName,
  items,
  release,
}: Parameters<typeof ProjectReviewTags>[0]): ReactNode {
  if (items.length === 0 && release === undefined) return null;
  return (
    <span className="menu-marks" data-zerops-surface="sidebar-project-marks">
      {items.length === 0 ? null : (
        <span
          aria-label={reviewTagLabel(items, projectName)}
          className="menu-mark menu-mark-merge"
          data-zerops-surface="sidebar-project-review-mark"
          role="img"
        >
          <GitMergeIcon aria-hidden="true" className="menu-mark-icon" />
          {items.length > 1 ? <span className="menu-mark-count">{items.length}</span> : null}
        </span>
      )}
      {release === undefined ? null : (
        <span
          aria-label={`Release: ${releaseTagTip(release)}`}
          className="menu-mark menu-mark-release"
          data-zerops-surface="sidebar-project-release-mark"
          role="img"
        >
          <RocketIcon aria-hidden="true" className="menu-mark-icon" />
          {release.waiting > 1 ? (
            <span className="menu-mark-count">{`${String(release.waiting)}${release.atLeast ? "+" : ""}`}</span>
          ) : null}
        </span>
      )}
    </span>
  );
}

function ReleaseTag({
  groupId,
  release,
  phase,
  word,
}: {
  readonly groupId: string;
  readonly release: { readonly waiting: number; readonly atLeast: boolean };
  readonly phase: Phase;
  readonly word: string;
}) {
  const openReview = useOpenReview();
  const tip = releaseTagTip(release);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={`Release: ${tip}`}
            className="menu-tag menu-tag-release"
            data-phase={phase}
            data-zerops-surface="sidebar-project-release"
            inert={phase === "exit"}
            onClick={(event) => {
              openReview({ kind: "release", groupId }, { from: event.currentTarget });
            }}
            type="button"
          />
        }
      >
        {/* In a narrow menu the word gives way to its mark, so the project's name keeps its room. */}
        <RocketIcon aria-hidden="true" className="menu-tag-icon" />
        <span className="menu-tag-word">{word}</span>
        <TagCount count={release.waiting > 1 ? release.waiting : undefined} />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tip}</TooltipPopup>
    </Tooltip>
  );
}

function ReviewTag({
  items,
  projectName,
  phase,
  word,
}: {
  readonly items: ReadonlyArray<ProjectReviewItem>;
  readonly projectName: string;
  readonly phase: Phase;
  readonly word: string;
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
  const [only] = items;
  const many = items.length > 1;
  return (
    <PopoverPrimitive.Root
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
            <PopoverPrimitive.Trigger
              render={
                <button
                  aria-label={reviewTagLabel(items, projectName)}
                  className="menu-tag menu-tag-review"
                  // What it holds, as the jump box keys a change (`changeRowKey`): a find lands here.
                  data-zerops-changes={items.map((item) => item.key).join(" ")}
                  data-phase={phase}
                  data-zerops-surface="sidebar-project-review"
                  inert={leaving}
                  ref={tag}
                  type="button"
                />
              }
            />
          }
        >
          <GitMergeIcon aria-hidden="true" className="menu-tag-icon" />
          <span className="menu-tag-word">{word}</span>
          <TagCount count={many ? items.length : undefined} />
        </TooltipTrigger>
        {only === undefined ? null : <TooltipPopup side="bottom">{only.title}</TooltipPopup>}
      </Tooltip>
      <TagPortal>
        <PopoverPrimitive.Positioner
          align="end"
          className="z-130"
          // Below or above its tag, never out to the side over the conversation: where neither
          // holds it whole, the roomier one, its list scrolling in what it has.
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          collisionPadding={8}
          side="bottom"
          sideOffset={6}
        >
          <PopoverPrimitive.Popup
            className="menu-tagpop"
            data-zerops-surface="sidebar-project-changes"
            // An item pressed keeps the focus its review takes; a tag that left with its last item
            // hands it to its row, never to the page.
            finalFocus={() =>
              pressed.current
                ? false
                : leaving
                  ? (tag.current
                      ?.closest(".menu-row-box")
                      ?.querySelector<HTMLElement>("[data-zerops-row]") ?? true)
                  : true
            }
            // A press opens it calm, nothing lit as if picked; ↓ then walks into it. Keys land on
            // its first item.
            initialFocus={(openType) => (openType === "keyboard" ? true : list.current)}
          >
            <ReviewList
              items={items}
              listRef={list}
              onOpen={(item) => {
                pressed.current = true;
                setOpen(false);
                openReview(item.target, { from: tag.current });
              }}
              projectName={projectName}
            />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </TagPortal>
    </PopoverPrimitive.Root>
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
    <span aria-hidden="true" className="menu-tag-count">
      {gone?.count === undefined ? null : (
        <span
          className="menu-tag-digit"
          data-dir={direction}
          data-out=""
          key={`out-${String(gone.count)}`}
        >
          {String(gone.count)}
        </span>
      )}
      {count === undefined ? null : (
        <span className="menu-tag-digit" data-dir={direction} data-in="" key={String(count)}>
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
  listRef,
}: {
  readonly items: ReadonlyArray<ProjectReviewItem>;
  readonly projectName: string;
  readonly onOpen: (item: ProjectReviewItem) => void;
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
  const [activeKey, setActiveKey] = useState<string | undefined>();
  const current = activeKey !== undefined && keys.includes(activeKey) ? activeKey : keys[0];
  const buttons = useRef(new Map<string, HTMLButtonElement>());

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
    const onItem = [...buttons.current.values()].includes(event.target as HTMLButtonElement);
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
      className="menu-tagpop-list"
      onKeyDown={move}
      ref={listRef}
      role="group"
      tabIndex={-1}
    >
      <p className="menu-tagpop-title" id={headingId}>
        {reviewPopoverTitle(live, projectName)}
      </p>
      {shown.map(({ item, leaving }) => (
        <div
          className="menu-tagpop-row"
          data-arrive={arrived.has(item.key) ? "" : undefined}
          data-leaving={leaving ? "" : undefined}
          inert={leaving}
          key={item.key}
        >
          {/* The cell the row closes and opens: no padding of its own, so it reaches 0. */}
          <div>
            <ReviewListItem
              current={item.key === current}
              item={item}
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
  );
}

function ReviewListItem({
  item,
  current,
  onFocus,
  onOpen,
  refOf,
}: {
  readonly item: ProjectReviewItem;
  readonly current: boolean;
  readonly onFocus: () => void;
  readonly onOpen: () => void;
  readonly refOf: (element: HTMLButtonElement | null) => void;
}) {
  const bylineId = useId();
  const [truncated, setTruncated] = useState(false);
  const Mark = item.target.kind === "crew-task" ? UsersIcon : GitPullRequestIcon;
  return (
    <button
      aria-describedby={bylineId}
      aria-label={`Review ${item.title}`}
      className="menu-tagpop-item"
      data-mine={item.mine ? "" : undefined}
      data-zerops-change={item.key}
      data-zerops-surface="sidebar-project-change"
      onClick={onOpen}
      onFocus={onFocus}
      ref={refOf}
      tabIndex={current ? 0 : -1}
      type="button"
    >
      <ReviewMaker by={item.by} />
      <span className="menu-tagpop-text">
        <Tooltip disabled={!truncated}>
          <TooltipTrigger
            render={
              <span
                className="menu-tagpop-name"
                onPointerEnter={(event) => {
                  const element = event.currentTarget;
                  setTruncated(element.scrollWidth > element.clientWidth);
                }}
              />
            }
          >
            <Mark aria-hidden="true" className="menu-tagpop-mark" />
            {item.title}
          </TooltipTrigger>
          <TooltipPopup side="top">{item.title}</TooltipPopup>
        </Tooltip>
        <span className="menu-tagpop-by" id={bylineId}>
          {reviewItemByline(item)}
        </span>
      </span>
      <span aria-hidden="true" className="menu-tagpop-verb">
        Review
      </span>
    </button>
  );
}

/** Who made it: its Mate's face, a colleague's with its owner's mark on the corner. */
function ReviewMaker({ by }: { readonly by: ProjectReviewItem["by"] }) {
  if (by === undefined) {
    return (
      <span aria-hidden="true" className="menu-tagpop-face">
        <GitPullRequestIcon className="menu-tagpop-mark" />
      </span>
    );
  }
  const mark =
    by.owner ??
    (by.ownerFirstName === undefined
      ? undefined
      : ownerMark({ name: by.ownerFirstName, initials: "", avatarUrl: null }));
  return (
    <span aria-hidden="true" className="menu-tagpop-face">
      <span className={mark === undefined ? "flex" : "menu-tagpop-cut flex"}>
        <MateFace className="size-5.5" shape={by.shape} size="sm" state="idle" tint={by.tint} />
      </span>
      {mark === undefined ? null : (
        <MateOwnerMark className="menu-tagpop-owner" seat={{ kind: "person", mark }} />
      )}
    </span>
  );
}
