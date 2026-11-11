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
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ArrowUpRightIcon, ChevronRightIcon, GitMergeIcon, GitPullRequestIcon } from "lucide-react";
import { use, useEffect, useRef, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestLinkWords, pullRequestName } from "~/zerops/automatedMate.logic";
import { useNowMs } from "~/zerops/useNowMs";

import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import type { CardChange } from "../projects/projectCard.logic";
import { changeTitle } from "../projects/projectHistory.logic";
import { changeReviewable } from "./ChangeRow.logic";
import { LedgerRows, PageRows } from "./pageRows";
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

/** When something last moved, as a card's rows say it: `9m`, `6h`, `2d`. */
export function ChangeAge({ at }: { readonly at: string | undefined }) {
  const nowMs = useNowMs();
  const when = at === undefined ? "" : compactSidebarTimeLabel(formatRelativeTimeLabel(at, nowMs));
  return when.length === 0 ? null : <span className="ov-change-time">{when}</span>;
}

/** What a row is about: a change, by its pull request; or work that is no change yet, by its words. */
export type ChangeRowSubject =
  | { readonly pull: FlowPullRequest; readonly title?: undefined }
  | {
      readonly pull?: undefined;
      /** "3 files not committed yet", "Could not read this repository". */
      readonly title: string;
    };

export type ChangeRowProps = ChangeRowSubject & {
  /** Still open: *Review* stands at its end, where no other `verb` is given. */
  readonly open?: boolean;
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
  const { pull, open = false, line, tone, at, by, face, bead, onOpen, verb } = props;
  // One title for a change on every page: GitHub's squash suffix "(#17)" is never part of it.
  const title = changeTitle(pull?.title ?? props.title ?? "");
  const Icon = open ? GitPullRequestIcon : GitMergeIcon;
  const github = pull?.pullRequest;
  const page = use(PageRows);
  const ledger = use(LedgerRows);
  // In a ledger *Review* stands only where a review is due; a change something stops says what.
  const review =
    open &&
    verb === undefined &&
    onOpen !== undefined &&
    (!ledger || (pull !== undefined && changeReviewable(pull)));
  // Where it leads: only a row that opens, and says so with no verb of its own.
  const goes = page && onOpen !== undefined && !review && (verb === undefined || verb === null);
  const when =
    by === undefined ? (
      <ChangeAge at={at} />
    ) : (
      <span className="ov-change-time">
        {by}
        {at === undefined ? null : " · "}
        <ChangeAge at={at} />
      </span>
    );
  const mark =
    ledger && bead !== undefined ? (
      <i
        aria-hidden="true"
        className="ln-bead ov-change-bead"
        data-mark={bead.mark}
        data-tint={bead.tint}
      />
    ) : face === undefined || face === null ? (
      pull === undefined ? (
        <span aria-hidden="true" className="ov-change-face" />
      ) : (
        <Icon aria-hidden="true" className="ov-change-icon" />
      )
    ) : (
      <span aria-hidden="true" className="ov-change-face">
        {face}
      </span>
    );
  const act = review ? (
    <span className="ov-change-act">
      <span className="ov-review" data-zerops-surface="card-change-review">
        Review
      </span>
    </span>
  ) : goes ? (
    <span className="ov-change-act">
      <ChevronRightIcon aria-hidden="true" className="ov-go" />
    </span>
  ) : null;
  const contents = ledger ? (
    <>
      {mark}
      <span className="ov-change-text">
        <CutText className="ov-change-title" text={title} />
      </span>
      {line === undefined ? null : (
        <span className="ov-change-state" data-tone={tone}>
          {line}
        </span>
      )}
      <span className="ov-change-when">{when}</span>
      {act}
    </>
  ) : (
    <>
      {mark}
      <span className="ov-change-text">
        {page ? (
          <span className="ov-change-head">
            <CutText className="ov-change-title" text={title} />
            <span className="ov-change-age">{when}</span>
          </span>
        ) : (
          <CutText className="ov-change-title" text={title} />
        )}
        {line === undefined ? null : (
          <span className="ov-change-line" data-tone={tone}>
            {line}
          </span>
        )}
      </span>
      {/* Review on a change still open, as the menu has it (the owner, 2026-10-12: "more
          limited in functionality than the left menu"); the row opens it too. */}
      {/* When it last moved: the list's last column of facts, after its pull request's. */}
      {page ? null : <span className="ov-change-when">{when}</span>}
      {act}
    </>
  );
  return (
    <li
      className="ov-change-row"
      data-zerops-change={pull === undefined ? undefined : lineChangeKey(pull)}
    >
      {onOpen === undefined ? (
        <div className="ov-change" data-plain="" data-open={open ? "true" : undefined}>
          {contents}
        </div>
      ) : (
        <button
          className="ov-change"
          data-open={open ? "true" : undefined}
          onClick={(event) => {
            onOpen(event.currentTarget);
          }}
          type="button"
        >
          {contents}
        </button>
      )}
      {verb === undefined || verb === null ? null : <span className="ov-change-verb">{verb}</span>}
      {/* Its pull request on GitHub, where the change is mirrored to one. */}
      {github === undefined ? null : (
        <a
          aria-label={pullRequestLinkWords(github)}
          className="ov-change-pr"
          href={github.url}
          rel="noreferrer"
          target="_blank"
        >
          {pullRequestName(github)}
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </a>
      )}
    </li>
  );
}

/** A list of `ChangeRow`s, their hover hanging past the column's edge as the card's do. */
export function ChangeList({
  children,
  label,
  group,
  page = false,
  ledger = false,
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
}) {
  return (
    <ul
      aria-label={label}
      className="ov-changes"
      data-ledger={ledger ? "" : undefined}
      data-page={page ? "" : undefined}
      data-zerops-change-group={group}
    >
      <PageRows value={page}>
        <LedgerRows value={ledger}>{children}</LedgerRows>
      </PageRows>
    </ul>
  );
}
