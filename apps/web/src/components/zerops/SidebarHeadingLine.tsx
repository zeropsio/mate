/**
 * A project heading's second line (D′), drawn: 12/16 under the name, the fact in its tone and
 * the rest muted after a middle dot, its words cut before the door, never the door — Review or
 * Details, 13/500 blue at the line's end, in the column of each pull request's Review below it.
 *
 * It opens and folds as a height reveal the Mates ride on (220 ms, a strong ease-out), never a
 * jump cut; its words stay while it folds. What it says is `SidebarHeadingLine.logic.ts`'s.
 */
import { TagIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import {
  headingLanding,
  headingLine,
  type HeadingMark,
  LANDING_MS,
  type HeadingLanding,
  type HeadingLine,
  type HeadingLineInput,
} from "./SidebarHeadingLine.logic";

/** How long a folding line keeps its words: the fold's own length. */
const FOLD_MS = 220;

/**
 * The line for `input`, with what this tab watched land standing on it for {@link LANDING_MS}.
 * Read whether the heading is open or folded, so a release that lands while folded is still
 * watched.
 */
export function useHeadingLine(input: HeadingLineInput | undefined): {
  readonly line: HeadingLine | undefined;
  /** What this tab watched land, while it stands: its pill wears ok. */
  readonly landing: HeadingLanding | undefined;
} {
  const [landing, setLanding] = useState<HeadingLanding | undefined>(undefined);
  const [before, setBefore] = useState<HeadingLineInput | undefined>(input);
  if (before !== input) {
    setBefore(input);
    const landed = input === undefined ? undefined : headingLanding(before, input);
    if (landed !== undefined) setLanding(landed);
  }
  useEffect(() => {
    if (landing === undefined) return;
    const timer = setTimeout(() => {
      setLanding(undefined);
    }, LANDING_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [landing]);
  return { line: input === undefined ? undefined : headingLine(input, landing), landing };
}

/**
 * Which pills turn their stepped spinner while their place comes up, and which wear ok for the
 * landing: "prod", "stage", both or none, as a token list the pills' rules read.
 */
export function headingPillMotion(
  input: HeadingLineInput | undefined,
  landing: HeadingLanding | undefined,
): { readonly coming: string | undefined; readonly landed: string | undefined } {
  const coming = [
    ...(input?.stages.some((stage) => stage.coming?.kind === "coming") === true ? ["stage"] : []),
    ...(input?.production?.coming?.kind === "coming" ? ["prod"] : []),
  ];
  return {
    coming: coming.length === 0 ? undefined : coming.join(" "),
    landed: landing === undefined ? undefined : landing.kind === "live" ? "prod" : "stage",
  };
}

/** The line shown, kept through its fold so its words leave with it. */
function useFoldingLine(line: HeadingLine | undefined): {
  readonly shown: HeadingLine | undefined;
  readonly open: boolean;
} {
  const [held, setHeld] = useState(line);
  if (line !== undefined && line !== held) setHeld(line);
  const open = line !== undefined;
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      setHeld(undefined);
    }, FOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [open]);
  return { shown: line ?? held, open };
}

export function HeadingSubLine({
  line,
  onReview,
  onDetails,
}: {
  readonly line: HeadingLine | undefined;
  /** Opens the release's review. */
  readonly onReview: (from: HTMLElement) => void;
  /** Opens what failed for the environment that did not come up. */
  readonly onDetails: (projectId: string | undefined, from: HTMLElement) => void;
}) {
  const { shown, open } = useFoldingLine(line);
  return (
    <div
      aria-hidden={shown === undefined ? true : undefined}
      className="zerops-heading-line"
      data-open={open ? "" : undefined}
      data-zerops-surface="sidebar-project-line"
    >
      <div className="zerops-heading-line-clip">
        {shown === undefined ? null : (
          <div className="zerops-heading-line-row">
            <span className="zerops-heading-line-words">
              {shown.spinner ? (
                <span aria-hidden="true" className="zerops-envdot" data-dot="spinner" />
              ) : shown.release ? (
                <TagIcon aria-hidden="true" className="zerops-heading-line-tag" />
              ) : null}
              <span className="zerops-heading-line-fact" data-tone={shown.tone}>
                {shown.fact}
              </span>
              {shown.rest === undefined ? null : ` · ${shown.rest}`}
            </span>
            {shown.verb === undefined ? null : (
              <button
                className="menu-textbtn zerops-heading-line-door"
                data-zerops-surface="sidebar-project-line-door"
                onClick={(event) => {
                  const verb = shown.verb;
                  if (verb?.kind === "review") onReview(event.currentTarget);
                  else if (verb?.kind === "details") onDetails(verb.projectId, event.currentTarget);
                }}
                tabIndex={open ? undefined : -1}
                type="button"
              >
                {shown.verb.kind === "review" ? "Review" : "Details"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The line's own words — "1 change not released · since v0.1.0" — for its folded mark. */
export function headingLineWords(line: HeadingLine): string {
  return line.rest === undefined ? line.fact : `${line.fact} · ${line.rest}`;
}

/** A folded heading's release mark, in words, where its line is about something else. */
function markWords(mark: HeadingMark): string {
  switch (mark.kind) {
    case "waiting":
      return mark.count === 1
        ? "1 change not released"
        : `${String(mark.count)} changes not released`;
    case "releasing":
      return mark.version === undefined ? "Releasing" : `Releasing ${mark.version}`;
    case "live":
      return "The release is live";
    case "failed":
      return "The release didn’t go out";
  }
}

/**
 * A folded heading's release mark after its faces (D) — its open line, folded: the same tag the
 * line leads with and how many changes wait, the stepped spinner and the version on its way, the
 * tag in ok as it lands, in amber where it did not go out; the count in the ink the line's fact
 * wears. Hovered, it says the line's own words.
 */
export function HeadingReleaseMark({
  mark,
  line,
}: {
  readonly mark: HeadingMark | undefined;
  /** The heading's line while open: its words are the mark's tooltip. */
  readonly line: HeadingLine | undefined;
}) {
  if (mark === undefined) return null;
  const words = line?.release === true ? headingLineWords(line) : markWords(mark);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="zerops-heading-mark"
            data-tone={mark.kind === "live" ? "ok" : mark.kind === "failed" ? "amber" : undefined}
            data-zerops-surface="sidebar-project-release-mark"
          />
        }
      >
        {mark.kind === "releasing" ? (
          <span aria-hidden="true" className="zerops-envdot" data-dot="spinner" />
        ) : (
          <TagIcon aria-hidden="true" className="size-3.5" />
        )}
        {mark.kind === "waiting" ? (
          <span aria-hidden="true">{mark.count}</span>
        ) : mark.kind === "releasing" && mark.version !== undefined ? (
          <span aria-hidden="true">{mark.version}</span>
        ) : null}
        <span className="sr-only">{words}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{words}</TooltipPopup>
    </Tooltip>
  );
}
