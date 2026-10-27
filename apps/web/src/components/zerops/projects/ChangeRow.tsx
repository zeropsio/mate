/**
 * A change's row, as a project's card and its page's History both draw one: its Mate's face, its
 * title, whose and where it stands, when it last moved — a click opens it — and its pull request
 * on GitHub where it is mirrored to one.
 */
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { ArrowUpRightIcon, GitMergeIcon, GitPullRequestIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { pullRequestLinkWords, pullRequestName } from "~/zerops/automatedMate.logic";
import { useNowMs } from "~/zerops/useNowMs";

import { compactSidebarTimeLabel } from "../../Sidebar.logic";
import type { CardChange } from "./projectCard.logic";

/** How long a cut line is pointed at before its whole shows, as a tooltip waits. */
const CUT_TEXT_DELAY_MS = 500;

/**
 * A line of text cut at its box's end, as a card's rows are: the whole of it in a tooltip while it
 * is pointed at, only where it was cut — the menu's change rows read theirs the same way. The
 * tooltip is made only then: a card's rows hold no tooltip of their own.
 */
export function CutText({
  className,
  text,
}: {
  readonly className: string;
  readonly text: string;
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
  if (!shown) return <span {...line.props}>{text}</span>;
  return (
    <Tooltip
      onOpenChange={(open) => {
        if (!open) setShown(false);
      }}
      open
    >
      <TooltipTrigger render={line}>{text}</TooltipTrigger>
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

export function ChangeRow({
  pull,
  open,
  line,
  tone,
  at,
  face,
  onOpen,
}: {
  readonly pull: FlowPullRequest;
  /** Still open: *Review* stands at its end. */
  readonly open: boolean;
  /** Whose, and where it stands. */
  readonly line: string;
  readonly tone?: CardChange["tone"] | undefined;
  /** When it last moved. */
  readonly at: string | undefined;
  /** Its Mate's face, where the surface holds it; its git mark otherwise. */
  readonly face: ReactNode;
  readonly onOpen: (from: HTMLElement) => void;
}) {
  const Icon = open ? GitPullRequestIcon : GitMergeIcon;
  const github = pull.pullRequest;
  return (
    <li className="ov-change-row">
      <button
        className="ov-change"
        data-open={open ? "true" : undefined}
        onClick={(event) => {
          onOpen(event.currentTarget);
        }}
        type="button"
      >
        {face === undefined || face === null ? (
          <Icon aria-hidden="true" className="ov-change-icon" />
        ) : (
          <span aria-hidden="true" className="ov-change-face">
            {face}
          </span>
        )}
        <span className="ov-change-text">
          <CutText className="ov-change-title" text={pull.title} />
          <span className="ov-change-line" data-tone={tone}>
            {line}
          </span>
        </span>
        {/* Review on a change still open, as the menu has it (the owner, 2026-10-12: "more
            limited in functionality than the left menu"); the row opens it too. */}
        <span className="ov-change-end">
          <ChangeAge at={at} />
          {open ? (
            <span className="ov-review" data-zerops-surface="card-change-review">
              Review
            </span>
          ) : null}
        </span>
      </button>
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
