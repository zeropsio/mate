/**
 * A change's row, the one drawing of a change on every page and panel: its Mate's face, its title,
 * whose and where it stands ("Juno · Ready to merge"), when it last moved, and at most one verb —
 * *Review* while it is open. The whole row opens it (today's change review, `openReview`), and its
 * pull request on GitHub stands beside it where it is mirrored to one.
 *
 * In a ledger (`ChangeList ledger`, a project's Changes under their line) a change is one line:
 * its bead as the line draws it, its title, then columns — what stops it, where anything does;
 * whose and when; *Review* where a review is due, else the mark of where the row leads.
 */
import {
  REVIEW_LABEL,
  standingPressLabel,
  standingWaits,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { ArrowUpRightIcon, ChevronRightIcon, GitMergeIcon, GitPullRequestIcon } from "lucide-react";
import { use, useEffect, useRef, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestLinkWords, pullRequestName } from "~/zerops/automatedMate.logic";
import { useNowMs } from "~/zerops/useNowMs";

import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import { Button, InlineButton } from "../../ui/button";
import { Row } from "../../ui/row";
import { cn } from "~/lib/utils";
import type { CardChange } from "../projects/projectCard.logic";
import { changeTitle } from "../projects/projectHistory.logic";
import { BeadMark } from "./BeadMark";
import { changeReviewable, type RowStanding } from "./ChangeRow.logic";
import { ChangeLookRows, LedgerRows, PageRows, type ChangeLook } from "./pageRows";
import { lineChangeKey, type LineBead } from "./projectLine.logic";

/** How long a cut line is pointed at before its whole shows, as a tooltip waits. */
const CUT_TEXT_DELAY_MS = 500;

/**
 * A line of text cut at its box's end, as a card's rows are: the whole of it in a tooltip while it
 * is pointed at, only where it was cut — the menu's change rows read theirs the same way. The
 * tooltip is made only then: a card's rows hold no tooltip of their own. `children`: the line as
 * it is drawn where its words carry tones or marks; the tooltip says `text`.
 */
export function CutText({
  className,
  text,
  children,
}: {
  readonly className: string;
  readonly text: string;
  readonly children?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const line = (
    <span
      className={className}
      onPointerEnter={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth <= element.clientWidth) return;
        timer.current = setTimeout(() => setShown(true), CUT_TEXT_DELAY_MS);
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current);
        setShown(false);
      }}
    />
  );
  if (!shown) return <span {...line.props}>{children ?? text}</span>;
  return (
    <Tooltip
      onOpenChange={(open) => {
        if (!open) setShown(false);
      }}
      open
    >
      <TooltipTrigger render={line}>{children ?? text}</TooltipTrigger>
      <TooltipPopup side="top">{text}</TooltipPopup>
    </Tooltip>
  );
}

/** When something last moved, in a row's facts: muted, its figures on one edge. */
export const CHANGE_TIME =
  "pt-0.5 text-caption leading-4.5 whitespace-nowrap text-muted-foreground tabular-nums";

/** A change's git mark where no face of its own stands, in the face's 20 px seat. */
export const CHANGE_ICON = "mx-0.5 mt-0.5 size-4 text-muted-foreground";

/** When something last moved, as a card's rows say it: `9m`, `6h`, `2d`. */
export function ChangeAge({
  at,
  className = CHANGE_TIME,
}: {
  readonly at: string | undefined;
  readonly className?: string;
}) {
  const nowMs = useNowMs();
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return when.length === 0 ? null : <span className={className}>{when}</span>;
}

/** What a row is about: a change, by its pull request; or work that is no change yet, by its words. */
type ChangeRowSubject =
  | { readonly pull: FlowPullRequest; readonly title?: undefined }
  | {
      readonly pull?: undefined;
      /** "3 files not committed yet", "Could not read this repository". */
      readonly title: string;
    };

type ChangeRowProps = ChangeRowSubject & {
  /** Still open: *Review* stands at its end, where no other `verb` is given. */
  readonly open?: boolean;
  /**
   * Where a reviewable change stands for the person looking (`rowStanding`): its press says *Ask
   * to merge* where they cannot merge, a plain *View* once they asked. Absent: *Review*.
   */
  readonly standing?: RowStanding | undefined;
  /** Whose, and where it stands: `changeRowLine(mate, words)` — "Juno · Ready to merge". */
  readonly line?: string | undefined;
  readonly tone?: CardChange["tone"] | undefined;
  /** When it last moved (ISO); no time where `undefined`. */
  readonly at?: string | undefined;
  /** Whose it is, said before its time at the row's end ("Juno · 8d"), where no `line` says it. */
  readonly by?: string | undefined;
  /** Its Mate's face, 20 px; its git mark where `undefined` and it is a change. */
  readonly face?: ReactNode;
  /**
   * In a ledger, its bead as the line over the list draws it: its Mate's tint, the ring of one that
   * waits on the person or is stuck. Stands in the face's place.
   */
  readonly bead?: Pick<LineBead, "tint" | "mark"> | undefined;
  /**
   * Opens it — a change's review (`openReview({ kind: "change", … })` or `useOpenZeropsChange`).
   * The row is a button only with it; without it the row is plain.
   */
  readonly onOpen?: ((from: HTMLElement) => void) | undefined;
  /**
   * The one verb at its end, in place of *Review*: a `Button size="sm" variant="secondary"` —
   * Update from main, Read again, Ask <Mate> to fix it. Stands beside the row, never inside its
   * press.
   */
  readonly verb?: ReactNode;
};

/**
 * One row of a change, or of work that is no change yet. Renders an `<li>`: put it in a
 * `ChangeList`, whose columns its trailing facts stand in — its pull request, then when it last
 * moved, then its verb — so they run down the list whichever rows have them. In a page's list
 * (`ChangeList page`) when it last moved stands after its title instead, and a row that opens and
 * has no verb ends in a chevron while it is pointed at or focused.
 */
export function ChangeRow(props: ChangeRowProps) {
  const { pull, open = false, standing, line, tone, at, by, face, bead, onOpen, verb } = props;
  // One title for a change on every page: GitHub's squash suffix "(#17)" is never part of it.
  const title = changeTitle(pull?.title ?? props.title ?? "");
  const Icon = open ? GitPullRequestIcon : GitMergeIcon;
  const github = pull?.pullRequest;
  const page = use(PageRows);
  const ledger = use(LedgerRows);
  const look = use(ChangeLookRows);
  // In a ledger *Review* stands only where a review is due; a change something stops says what.
  const review =
    open &&
    verb === undefined &&
    onOpen !== undefined &&
    (!ledger || (pull !== undefined && changeReviewable(pull)));
  // Where it leads: only a row that opens, and says so with no verb of its own.
  const goes = page && onOpen !== undefined && !review && (verb === undefined || verb === null);
  // When it last moved: no air over it where it stands on the title's line.
  const time = cn(
    CHANGE_TIME,
    (ledger || page) && "pt-0",
    look === "release" && "pt-0 text-line leading-4.5",
  );
  const when =
    by === undefined ? (
      <ChangeAge at={at} className={time} />
    ) : (
      <span className={time}>
        {by}
        {at === undefined ? null : " · "}
        <ChangeAge at={at} className={time} />
      </span>
    );
  const mark =
    ledger && bead !== undefined ? (
      // Its bead, the line's own, standing still; quiet with a record's ink.
      <BeadMark
        className={cn(
          "pointer-events-none col-start-1 row-start-1 me-3 cursor-default",
          look === "record" && "opacity-60",
        )}
        mark={bead.mark}
        tint={bead.tint}
      />
    ) : face === undefined || face === null ? (
      pull === undefined ? (
        <span aria-hidden="true" className={FACE} data-change-face="" />
      ) : (
        <Icon
          aria-hidden="true"
          className={cn(
            CHANGE_ICON,
            "col-start-1 row-start-1 me-[calc(2px+var(--change-gap))]",
            open && "text-foreground",
          )}
          data-change-icon=""
        />
      )
    ) : (
      <span aria-hidden="true" className={FACE} data-change-face="">
        {face}
      </span>
    );
  const act = review ? (
    <span className={cn(ACT, ledger && ACT_LEDGER)}>
      {/* The row is the press; its verb wears the one Review look. */}
      <Button
        data-zerops-surface="card-change-review"
        render={<span />}
        size="xs"
        variant={standingWaits(standing) ? "ghost" : "secondary"}
      >
        {standingPressLabel(standing, REVIEW_LABEL)}
      </Button>
    </span>
  ) : goes ? (
    <span className={cn(ACT, ledger && ACT_LEDGER)}>
      <ChevronRightIcon aria-hidden="true" className={goClass(ledger)} />
    </span>
  ) : null;
  // Its title, cut at its end; a phone's reads whole on two lines.
  const titleClass = cn(
    "truncate text-body leading-5 max-sm:line-clamp-2 max-sm:whitespace-normal",
    look === "record" && "text-muted-foreground",
    look === "release" && "underline-offset-2 group-hover/row:underline",
  );
  const contents = ledger ? (
    <>
      {mark}
      <span className="col-start-2 row-start-1 grid min-w-0">
        <CutText className={titleClass} text={title} />
      </span>
      {line === undefined ? null : (
        // What stops it, where anything does; narrow, under its title.
        <span
          className={cn(
            "col-start-3 row-start-1 ms-4 text-caption leading-4.5 whitespace-nowrap @max-[639px]/changes:col-start-2 @max-[639px]/changes:row-start-2 @max-[639px]/changes:ms-0 @max-[639px]/changes:justify-self-start",
            toneInk(tone),
          )}
        >
          {line}
        </span>
      )}
      <span className={cn(WHEN, WHEN_LEDGER)}>{when}</span>
      {act}
    </>
  ) : (
    <>
      {mark}
      <span className="col-start-2 row-start-1 grid min-w-0">
        {page ? (
          // A page's row is as wide as its column: when it last moved stands after its title,
          // and in a narrow column at the title line's end.
          <span className="flex min-w-0 items-baseline gap-1.5">
            <CutText className={cn(titleClass, "min-w-0")} text={title} />
            <span className="ms-auto flex flex-none empty:hidden @min-[720px]/changes:ms-0 @min-[720px]/changes:before:me-1.5 @min-[720px]/changes:before:text-caption @min-[720px]/changes:before:leading-4.5 @min-[720px]/changes:before:text-muted-foreground/60 @min-[720px]/changes:before:content-['·']">
              {when}
            </span>
          </span>
        ) : (
          <CutText className={titleClass} text={title} />
        )}
        {line === undefined ? null : (
          <span
            className={cn(
              "truncate text-caption leading-4",
              tone === undefined ? "text-muted-foreground" : toneInk(tone),
            )}
          >
            {line}
          </span>
        )}
      </span>
      {/* Review on a change still open, as the menu has it (the owner, 2026-10-12: "more
          limited in functionality than the left menu"); the row opens it too. */}
      {/* When it last moved: the list's last column of facts, after its pull request's. */}
      {page ? null : <span className={cn(WHEN, open && "self-center")}>{when}</span>}
      {act}
    </>
  );
  // The row's press (`Row columns`): its cells on the row's line. A release's rows have no ground
  // of their own under the pointer: their title underlines.
  const rowClass = cn("row-start-1", (ledger || look === "release") && "items-center");
  return (
    <li
      className={cn(
        "col-span-full grid min-w-0 grid-cols-subgrid items-center [--change-gap:10px] [--row-pad-x:8px] [--row-pad-y:6px]",
        // The row of the change whose bead on the line is pointed at (`data-marked`).
        "[&[data-marked]>[data-slot=row]]:bg-foreground/5",
        (look === "ruled" || look === "record") && "[--row-pad-x:10px] [--row-pad-y:10px]",
        look === "ruled" && "border-t border-border/60 first:border-t-0",
        look === "record" && "border-t border-border/60",
        look === "release" &&
          "border-t border-border/60 [--change-gap:12px] [--row-pad-x:0px] [--row-pad-y:8px]",
      )}
      data-zerops-change={pull === undefined ? undefined : lineChangeKey(pull)}
    >
      {onOpen === undefined ? (
        <Row className={rowClass} columns data-open={open ? "true" : undefined}>
          {contents}
        </Row>
      ) : (
        <Row
          className={rowClass}
          columns
          data-open={open ? "true" : undefined}
          onClick={(event) => {
            onOpen(event.currentTarget);
          }}
          pressable={look === "release" ? "band" : true}
          render={<button type="button" />}
        >
          {contents}
        </Row>
      )}
      {verb === undefined || verb === null ? null : (
        // A row's own verb, beside its press: Update from main, Read again.
        <span
          className={cn(
            "col-start-5 row-start-1 ms-2 me-(--row-pad-x) flex",
            ledger && "col-start-6",
          )}
        >
          {verb}
        </span>
      )}
      {/* Its pull request on GitHub, where the change is mirrored to one: in the column before
          when it last moved, on the title's line. A phone's row opens the change, its pull request
          one press away there; a row that opens nothing keeps the link, its only way to it. */}
      {github === undefined ? null : (
        <span
          className={cn(
            "z-1 col-start-3 row-start-1 ms-(--change-gap) mt-[calc(var(--row-pad-y)+2px)] inline-flex items-center gap-0.5 self-start justify-self-end text-caption leading-4.5 tabular-nums",
            open && "mt-0 self-center",
            ledger && "col-start-4 ms-4 mt-0 self-center",
            onOpen !== undefined && "max-sm:hidden",
          )}
        >
          <InlineButton
            aria-label={pullRequestLinkWords(github)}
            render={<a href={github.url} rel="noreferrer" target="_blank" />}
            tone="muted"
          >
            {pullRequestName(github)}
            <ArrowUpRightIcon aria-hidden="true" className="size-3" />
          </InlineButton>
        </span>
      )}
    </li>
  );
}

/** A change's Mate's face, a bit smaller than a Mate row's, where the git mark would stand. */
const FACE = "col-start-1 row-start-1 me-(--change-gap) flex size-5";

/** When it last moved: the list's last column of facts, its figures ending on one edge. */
const WHEN = "col-start-4 row-start-1 ms-(--change-gap) flex justify-end empty:hidden";
const WHEN_LEDGER = "col-start-5 ms-4 self-center @max-[639px]/changes:row-[1/span_2]";

/** Review, or where the row leads, at its end. */
const ACT = "col-start-5 row-start-1 ms-2 flex justify-end self-center";
// The verb's seat is held in every ledger row, so a chevron ends where a Review does.
const ACT_LEDGER =
  "col-start-6 ms-3 min-h-5.5 min-w-14.5 items-center @max-[639px]/changes:row-[1/span_2]";

/** Where a row leads: shown while it is pointed at or focused, and always where nothing hovers. */
export function goClass(ledger: boolean): string {
  return cn(
    "size-4 flex-none text-muted-foreground opacity-0 transition-opacity duration-150 ease-out-strong group-hover/row:opacity-100 group-focus-visible/row:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100",
    // A ledger's always stands, quieter at rest.
    ledger && "opacity-55",
  );
}

/** A state's ink: amber where it waits on someone, red where it failed, else muted. */
function toneInk(tone: CardChange["tone"] | undefined): string {
  return tone === "attention"
    ? "text-status-attention-text"
    : tone === "failed"
      ? "text-status-failed-text"
      : "text-muted-foreground";
}

/** A list of `ChangeRow`s, their hover hanging past the column's edge as the card's do. */
export function ChangeList({
  children,
  label,
  group,
  page = false,
  ledger = false,
  look = "card",
}: {
  readonly children: ReactNode;
  /** Its accessible name where no heading names it. */
  readonly label?: string;
  /** The group of a page's changes it is, by which the page's picture leads to it. */
  readonly group?: string | undefined;
  /** A page's own list, as wide as its column (`PageRows`). */
  readonly page?: boolean;
  /** A ledger of changes, a line each under the line that pictures them (`LedgerRows`). */
  readonly ledger?: boolean;
  /** How its rows stand on what holds them (`ChangeLook`). */
  readonly look?: ChangeLook;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        // One grid for the list: a row's face and words, then its trailing facts in columns of
        // their own, each as wide as the widest in the list.
        "grid list-none grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] p-0",
        look === "card" && "-mx-2 -mt-1.5",
        look === "record" && "[[data-group]+&]:mt-1.5",
        page && "@container/changes",
        ledger &&
          "grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] [--ln-ground:transparent] [--ln-track:color-mix(in_oklab,var(--foreground)_30%,transparent)]",
        // A place's next release that lists commits of no change fills no face's seat: the seat
        // goes, and the subjects stand on the card's own edge.
        "[[data-zerops-next-block]_&:not(:has([data-change-face]>*,[data-change-icon]))_[data-change-face]]:hidden",
      )}
      data-zerops-change-group={group}
    >
      <PageRows value={page}>
        <LedgerRows value={ledger}>
          <ChangeLookRows value={look}>{children}</ChangeLookRows>
        </LedgerRows>
      </PageRows>
    </ul>
  );
}
