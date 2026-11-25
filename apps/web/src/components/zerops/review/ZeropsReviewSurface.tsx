import { isField } from "./ZeropsReview.logic";
/**
 * The review, drawn: every read already done and handed in, so a harness and a test can show
 * every state of it without a forge or a crew behind it. The reads and the verbs are the per-kind
 * reviews'.
 *
 * One surface in two frames (`ReviewFrame`), the same sections in the same words in each. As a
 * sheet over the page — `ZeropsReviewDialog`'s — its top line says whose it is (a Mate's face and
 * "Sage · Tea Shop", or the project), offers its own page where it has one, and × closes it. As a
 * page, at its own address, the page's bar says where it sits, and the review is the page.
 *
 * One reading order, top to bottom: where it acts and whose it is; its title; one line of where
 * it stands in plain words — "#12 · Ready to merge · ✓ checks passed" — and, where that is not
 * all, why; what it does, how to try it, what it changes; what was said and its commits, folded.
 * The buttons stand at the foot: the ask and the one button a pair at the row's end, the one
 * button last, the quiet word at its start — under the pair where the row has no room, never
 * above the one button — and under them one line of what happens next, or why the button is held.
 * What is rare or takes something away stands behind ⋯ in the top line.
 */
import type { ChangeDiffFile, ReviewVerdict } from "@t3tools/client-runtime/zerops";
import { changeFileParts } from "@t3tools/client-runtime/zerops";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GlobeIcon,
  Maximize2Icon,
  RotateCcwIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Skeleton } from "~/components/ui/skeleton";
import { Badge } from "~/components/ui/badge";
import { Kbd } from "~/components/ui/kbd";
import { Row } from "~/components/ui/row";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Failure } from "~/components/ui/failure";
import { Button, InlineButton } from "~/components/ui/button";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isMacPlatform } from "~/lib/utils";

import {
  GitBrowserLink,
  gitCommitLink,
  useGitLinkProps,
  type GitLink,
} from "../gitBrowser/GitBrowserLink";
import { MateFace } from "../primitives";
import { InPhoneBar } from "../system/PhoneBar";

import { ZeropsDeployAnswer, type DeployWhereRow } from "../ZeropsDeployAnswer";
import {
  changeFileLetter,
  diffFold,
  pressesPrimary,
  type ReleaseChangeRow,
  type ReviewFrame,
  type ReviewKind,
  tryItEverything,
  tryItWords,
} from "./ZeropsReview.logic";
import { Loading } from "~/components/ui/loading";
import { Text } from "~/components/ui/text";
import { DiffStat } from "~/components/ui/diff-stat";
import { List } from "~/components/ui/list";
import { SectionHeader } from "~/components/ui/section";

/** The keys that press the primary, as this platform writes them. */
const PRESS_KEYS =
  typeof navigator !== "undefined" && !isMacPlatform(navigator.platform) ? "Ctrl ↵" : "⌘↵";

export interface ReviewFaceProps {
  readonly tint: MateTintId;
  /** The shape its person picked; its tint's own when absent. */
  readonly shape?: MateShapeId | undefined;
  readonly state?: MateMarkState;
}

export interface ReviewButton {
  readonly label: string;
  readonly onPress: () => void;
}

/** One of the rare ways behind ⋯: a press, or a place in the Git browser. */
export type ReviewMenuItem =
  | (ReviewButton & { readonly destructive?: boolean | undefined })
  | { readonly label: string; readonly to: GitLink };

export interface ReviewPrimaryButton extends ReviewButton {
  readonly enabled: boolean;
  readonly safe: boolean;
  /** Its keys shown before it takes them (`ReviewPrimary.shortcut`). */
  readonly shortcut?: true | undefined;
  /**
   * Not the press the review recommends (`ReviewPrimary.plain`): drawn plainly, with the fix
   * highlighted beside it in the foot instead of a link under the title.
   */
  readonly plain?: true | undefined;
  /** Pressed and running: the label says so, and it takes no second press. */
  readonly busy?: boolean;
  readonly icon?: "tag" | "rollback" | "globe" | undefined;
  /** The words it shows where they say more than its label: "Merge to stage". */
  readonly text?: string | undefined;
  /**
   * Why it cannot be pressed yet, where the review says so elsewhere: the id of the line that
   * says it, read with the button, and its words, shown over it.
   */
  readonly held?: { readonly by: string; readonly words: string } | undefined;
}

/**
 * Several changes reviewed together (`reviewQueue.logic`): where the person stands — "1 of 3" — and
 * the steps to the change before and after, said quietly in the top line.
 */
export interface ReviewQueueLine {
  /** "1 of 3"; once every change is done, what was done: "#7 and #8 merged". */
  readonly words: string;
  readonly onPrevious?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  /** How this change was reached: its review comes in from that side. */
  readonly arrived?: "next" | "previous" | undefined;
}

export interface ZeropsReviewSurfaceProps {
  /** A sheet over the page (the default), or a page of its own. */
  readonly frame?: ReviewFrame | undefined;
  readonly kind: ReviewKind;
  /** The top line, beside ×: whose it is and where — "Sage · Tea Shop", or the project's name. */
  readonly kindLabel: string;
  /** The face beside the top line: the Mate whose change it is. */
  readonly face?: ReviewFaceProps | undefined;
  /**
   * Where it acts, before the top line's words: "Production" — the only red — or the branch a
   * change merges into.
   */
  readonly where?: { readonly words: string; readonly production?: boolean } | undefined;
  /** The rare ways, behind ⋯ in the top line; none where there is none. */
  readonly menu?: ReadonlyArray<ReviewMenuItem> | undefined;
  /**
   * The page's trail — Overview / Tea Shop / #7 — over its title, on a page only: it heads the
   * title, so it hugs it, and on a phone it is the frame's bar.
   */
  readonly trail?: ReactNode;
  readonly title: string;
  /** The title as it is drawn, where it sets a name apart; `title` is its text. */
  readonly titleWords?: ReactNode;
  readonly titleId?: string | undefined;
  /**
   * The one line under the title, where the review says where it stands itself: it takes the
   * place of the verdict's line and its why, and never wraps, so the head keeps its height.
   */
  readonly subtitle?: ReactNode;
  /** The line under the title, before the verdict's words: "#12". */
  readonly meta?: ReactNode;
  /** After the meta: where else it lives — the pull request it is on GitHub, linked. */
  readonly elsewhere?: ReactNode;
  /** After that: its code in the Git browser, linked. */
  readonly code?: ReactNode;
  /** The line's last words, after the verdict's: "✓ checks passed". */
  readonly status?: ReactNode;
  readonly verdict: ReviewVerdict;
  /** Whether the line says the verdict's title; a release ready to go says its own line only. */
  readonly verdictInLine?: boolean | undefined;
  /** Whether the verdict's why is said under the line (`whySaid`). */
  readonly whySaid?: boolean | undefined;
  /**
   * A fact said under the line, before the verdict's why: one the person acts on before pressing
   * (a change's checks on GitHub).
   */
  readonly notice?: ReactNode;
  /** "Ask Nova to resolve it": the fix, where there is a Mate of the person's to ask. */
  readonly fix?: ReviewButton | undefined;
  /** Whose move the fix is where the Mate is a colleague's: said where the press would stand. */
  readonly fixNote?: string | undefined;
  /** The sections, in reading order. */
  readonly children?: ReactNode;
  /** The foot's note, under the buttons: what happens next, or why the button is held. */
  readonly consequence: string;
  /** The note that will stand once what is loading has loaded: the foot keeps its room. */
  readonly consequenceRoom?: string | undefined;
  /**
   * What the foot's words are of, where they swap in place while the review stays open (a change
   * asked for its merge, the ask taken back): once it has moved, the words that come ease in.
   */
  readonly noteKey?: string | undefined;
  /** A fact said over the note, to the person the button is for: who asked them to press it. */
  readonly asked?: string | undefined;
  /** The note's tone where it says why the button is held, or what stopped. */
  readonly consequenceTone?: "attention" | "failed" | undefined;
  /** The note is a wait under way: said beside the busy mark. */
  readonly consequenceBusy?: boolean | undefined;
  /** A press in the note: "Review again", "Roll back to v0.1.3…". */
  readonly noteAction?: ReviewButton | undefined;
  /** The quiet way out, at the row's start: "Cancel" before a press, "Close" or "Done" after. */
  readonly dismiss?: string | undefined;
  /** "Ask Sage to change it…": the soft button beside the one button. */
  readonly ask?: ReviewButton | undefined;
  /** A quiet word beside the way out that does not close the sheet: "Keep it open". */
  readonly secondary?: (ReviewButton & { readonly enabled: boolean }) | undefined;
  /** The quiet press that takes back what the person did here: "Take back". */
  readonly undo?: (ReviewButton & { readonly enabled: boolean }) | undefined;
  readonly primary?: ReviewPrimaryButton | undefined;
  /**
   * The one question after a merge, in the buttons' place: the foot swaps in place and the body
   * never moves under the person's eye (a run 2 follow-up: it came in above the description and
   * pushed the body 98 px down).
   */
  readonly answers?: ReactNode;
  /** What was already done, said where the button would stand: "Merged". */
  readonly settled?: string | undefined;
  /**
   * The sheet's way back to the review this one was stepped into from — "← Release" — in the
   * place of the top line.
   */
  readonly back?: ReviewButton | undefined;
  /**
   * Pressed: from here its buttons never rise under the pointer. A sheet as tall as what it says
   * keeps at least the height that holds them where they stood, whatever it says next.
   */
  readonly held?: boolean | undefined;
  /** The sheet's way to the same review as a page, where it has one. */
  readonly onOpenPage?: (() => void) | undefined;
  /** Several changes reviewed together: where the person stands, in the top line. */
  readonly queue?: ReviewQueueLine | undefined;
  readonly onClose: () => void;
}

export function ZeropsReviewSurface({
  frame = "dialog",
  kind,
  kindLabel,
  face,
  where,
  menu,
  trail,
  title,
  titleWords,
  titleId,
  subtitle,
  meta,
  elsewhere,
  code,
  status,
  verdict,
  verdictInLine = true,
  whySaid = true,
  notice,
  fix,
  fixNote,
  children,
  consequence,
  consequenceRoom,
  noteKey,
  asked,
  consequenceTone,
  consequenceBusy = false,
  noteAction,
  dismiss,
  ask,
  secondary,
  undo,
  primary,
  answers,
  settled,
  back,
  held = false,
  onOpenPage,
  queue,
  onClose,
}: ZeropsReviewSurfaceProps) {
  const Title = frame === "page" ? "h1" : "h2";
  const buttonsRow = useRef<HTMLDivElement | null>(null);
  const pressed = useHeldButtons(held, buttonsRow);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "the refusal" });
  // Where the foot's words stood as the review opened: only what replaces them eases in.
  const [openedAt] = useState(noteKey);
  const [moved, setMoved] = useState(false);
  if (!moved && noteKey !== openedAt) setMoved(true);
  const swap = moved ? "" : undefined;
  // Where the fix is the press the review recommends, it stands highlighted in the foot, once: no
  // link under the title, and the foot's one ask of the Mate — the soft one steps aside, so the
  // buttons keep their one row.
  const leadingFix = primary?.plain === true ? fix : undefined;
  const linkedFix = leadingFix === undefined ? fix : undefined;
  const whyCopy =
    whySaid && verdict.copyWhy === true ? (
      <Button onClick={() => copyToClipboard(verdict.why)} size="sm" variant="link">
        {isCopied ? "Copied" : "Copy"}
      </Button>
    ) : null;
  const softAsk = leadingFix === undefined ? ask : undefined;
  const line: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (meta !== undefined && meta !== null) line.push({ key: "meta", node: meta });
  if (elsewhere !== undefined && elsewhere !== null)
    line.push({ key: "elsewhere", node: elsewhere });
  if (code !== undefined && code !== null) line.push({ key: "code", node: code });
  if (verdictInLine) {
    line.push({
      key: noteKey === undefined ? "verdict" : `verdict ${noteKey}`,
      node: (
        <span
          className={
            swap === undefined
              ? VERDICT_TONE[verdict.tone]
              : `${VERDICT_TONE[verdict.tone]} motion-safe:animate-zerops-appear`
          }
        >
          {verdict.tone === "busy" ? <Spinner size="sm" tone="muted" /> : null}
          {verdict.title}
        </span>
      ),
    });
  }
  if (status !== undefined && status !== null) line.push({ key: "status", node: status });
  const content = (
    <>
      {frame === "page" ? null : (
        <div className="flex flex-none items-center gap-0.5 ps-6 pe-4 pt-4.5 max-sm:ps-4 max-sm:pe-2.5">
          {back === undefined ? (
            <span className={KIND}>
              {where === undefined ? null : (
                <Badge tone={where.production === true ? "danger" : "neutral"}>{where.words}</Badge>
              )}
              {face === undefined ? null : (
                <MateFace
                  className="size-5.5"
                  shape={face.shape}
                  size={20}
                  state={face.state ?? "idle"}
                  tint={face.tint}
                />
              )}
              <span className="min-w-0 truncate">{kindLabel}</span>
            </span>
          ) : (
            <span className={KIND}>
              <Button
                className="-ms-2.5"
                data-review-back=""
                onClick={back.onPress}
                size="sm"
                variant="ghost-muted"
              >
                <ArrowLeftIcon aria-hidden="true" />
                {back.label}
              </Button>
            </span>
          )}
          {queue === undefined ? null : <ReviewQueueSteps queue={queue} />}
          {menu === undefined || menu.length === 0 ? null : <ReviewMenu items={menu} />}
          {onOpenPage === undefined ? null : (
            <Button
              aria-label="Open as page"
              onClick={onOpenPage}
              size="icon-sm"
              variant="ghost-muted"
            >
              <Maximize2Icon aria-hidden="true" />
            </Button>
          )}
          <Button
            aria-label="Close"
            className="-me-1.5"
            onClick={onClose}
            size="icon-sm"
            variant="ghost-muted"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      )}
      <header
        className={`${frame === "page" ? HEAD_PAGE : HEAD_SHEET} ${QUEUE_IN_SLIDES}`}
        data-queue-in={queue?.arrived}
        data-review-kind={kind}
      >
        {frame !== "page" || trail === undefined ? null : (
          <InPhoneBar>
            <div className="mb-1 flex min-w-0">{trail}</div>
          </InPhoneBar>
        )}
        <Title className={frame === "page" ? TITLE_PAGE : TITLE_SHEET} id={titleId} title={title}>
          {titleWords ?? title}
        </Title>
        {subtitle === undefined ? (
          <p aria-live="polite" className={LINE} data-review-state={verdict.state}>
            {line.map((part, index) => (
              <Fragment key={part.key}>
                {index === 0 ? null : (
                  <span aria-hidden="true" className="text-muted-foreground max-sm:hidden">
                    ·
                  </span>
                )}
                <span className={index === 0 ? LINE_PART : LINE_PART_AFTER_DOT}>{part.node}</span>
              </Fragment>
            ))}
          </p>
        ) : (
          // A release's one line, what is known of it as it stands: it never wraps, so the head
          // keeps its height from reading to done.
          <p
            aria-live="polite"
            className="truncate text-body leading-4.5 text-muted-foreground tabular-nums"
            data-review-state={verdict.state}
          >
            {subtitle}
          </p>
        )}
        {subtitle === undefined ? notice : null}
        {subtitle === undefined && (whySaid || linkedFix !== undefined || fixNote !== undefined) ? (
          verdict.tone === "attention" || verdict.tone === "failed" ? (
            // Trouble: a tinted callout, its fix the callout's action.
            <Alert
              className="mt-2.5"
              controlAlignment="first-line"
              data-review-why={verdict.tone}
              surface="tint"
              variant={verdict.tone === "failed" ? "error" : "warning"}
            >
              {whySaid ? <AlertTitle>{verdict.why}</AlertTitle> : null}
              {fix !== undefined || fixNote === undefined ? null : (
                <AlertDescription>{fixNote}</AlertDescription>
              )}
              {whyCopy === null && linkedFix === undefined ? null : (
                <AlertAction>
                  {whyCopy}
                  {linkedFix === undefined ? null : (
                    <Button onClick={linkedFix.onPress} size="sm" variant="link">
                      {linkedFix.label}
                    </Button>
                  )}
                </AlertAction>
              )}
            </Alert>
          ) : (
            // All is well: the why is a quiet line under the title.
            <div className={WHY}>
              {whySaid ? <span>{verdict.why}</span> : null}
              {whyCopy}
              {linkedFix === undefined ? null : (
                <Button onClick={linkedFix.onPress} size="sm" variant="link">
                  {linkedFix.label}
                </Button>
              )}
              {fix !== undefined || fixNote === undefined ? null : <span>{fixNote}</span>}
            </div>
          )
        ) : null}
      </header>
      <div
        className={`${frame === "page" ? BODY_PAGE : BODY_SHEET} ${QUEUE_IN_SLIDES}`}
        data-queue-in={queue?.arrived}
        data-review-body=""
      >
        {children}
      </div>
      {/* Nothing left to press or say (a merged change on its page): no empty bar. */}
      {answers === undefined &&
      primary === undefined &&
      settled === undefined &&
      ask === undefined &&
      secondary === undefined &&
      undo === undefined &&
      asked === undefined &&
      noteAction === undefined &&
      (dismiss === undefined || frame === "page") &&
      consequence === "" ? null : (
        <footer
          className={`${frame === "page" ? FOOT_PAGE : FOOT_SHEET} ${QUEUE_IN_FADES}`}
          data-queue-in={queue?.arrived}
        >
          <div className="flex flex-wrap-reverse items-center gap-2 empty:hidden" ref={buttonsRow}>
            {answers !== undefined ? (
              answers
            ) : (
              <>
                {(dismiss === undefined || frame === "page") &&
                secondary === undefined &&
                undo === undefined ? null : (
                  // The quiet words' text stands on the foot's edge, over the line of what happens
                  // next: a button's padding and border sit outside it.
                  <div className="-ms-3 flex items-center gap-2">
                    {dismiss === undefined || frame === "page" ? null : (
                      <Button
                        data-review-secondary={secondary === undefined ? "" : undefined}
                        onClick={onClose}
                        variant="ghost"
                      >
                        {dismiss}
                      </Button>
                    )}
                    {secondary === undefined ? null : (
                      <Button
                        data-review-secondary=""
                        disabled={!secondary.enabled}
                        onClick={secondary.onPress}
                        variant="ghost"
                      >
                        {secondary.label}
                      </Button>
                    )}
                    {undo === undefined ? null : (
                      <Button
                        data-review-undo=""
                        disabled={!undo.enabled}
                        onClick={undo.onPress}
                        variant="ghost"
                      >
                        {undo.label}
                      </Button>
                    )}
                  </div>
                )}
                {softAsk === undefined && settled === undefined && primary === undefined ? null : (
                  <div className="ms-auto flex items-center gap-2">
                    {softAsk === undefined ? null : (
                      <Button data-review-ask="" onClick={softAsk.onPress} variant="secondary">
                        {softAsk.label}
                      </Button>
                    )}
                    {settled === undefined ? null : (
                      // What was already done, where the button would stand: "Merged" — standing
                      // where a button stood a moment ago, the button's own height.
                      <span
                        className={
                          noteKey === undefined
                            ? `${SETTLED} h-8.5`
                            : swap === undefined
                              ? `${SETTLED} h-8`
                              : `${SETTLED} h-8 motion-safe:animate-zerops-appear`
                        }
                        key={noteKey}
                      >
                        <CheckIcon aria-hidden="true" />
                        {settled}
                      </span>
                    )}
                    {primary === undefined ? null : primary.held === undefined ? (
                      <ReviewPrimary onPress={pressed} primary={primary} />
                    ) : (
                      // A held button takes no pointer: the words over it are its wrapper's.
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <ReviewPrimary onPress={pressed} primary={primary} />
                        </TooltipTrigger>
                        <TooltipPopup>{primary.held.words}</TooltipPopup>
                      </Tooltip>
                    )}
                    {leadingFix === undefined ? null : (
                      <Button data-review-fix="" onClick={leadingFix.onPress}>
                        {leadingFix.label}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {/* Who asked the person to press the one button, hugging the note it belongs with. */}
          {asked === undefined ? null : (
            <p className="-mb-2 text-body leading-4.5 text-foreground tabular-nums">{asked}</p>
          )}
          {consequence === "" &&
          noteAction === undefined &&
          consequenceRoom === undefined ? null : (
            <p
              aria-live={consequenceBusy || noteKey !== undefined ? "polite" : undefined}
              className={`${consequenceRoom === undefined ? CONSEQ : CONSEQ_ROOM} ${CONSEQ_TONE[consequenceTone ?? "quiet"]}`}
            >
              {consequence === "" ? null : consequenceBusy ? (
                <Badge dot tone="info" wrap>
                  {consequence}
                </Badge>
              ) : (
                <span
                  className={swap === undefined ? undefined : "motion-safe:animate-zerops-appear"}
                  key={noteKey}
                >
                  {consequence}
                </span>
              )}
              {consequenceRoom === undefined ? null : (
                <span aria-hidden="true" className="invisible">
                  {consequenceRoom}
                </span>
              )}
              {noteAction === undefined ? null : (
                <InlineButton
                  data-review-note-action=""
                  onClick={noteAction.onPress}
                  tone={consequence === "" ? "muted" : "default"}
                >
                  {noteAction.label}
                </InlineButton>
              )}
            </p>
          )}
        </footer>
      )}
    </>
  );
  if (frame !== "page") return content;
  // ⌘↵ anywhere on the page presses the one button while it is safe, as in the dialog.
  const pressFromKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (primary === undefined || primary.busy === true) return;
    if (
      !pressesPrimary(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          repeat: event.repeat,
          inField: isField(event.target),
        },
        { safe: primary.safe, enabled: primary.enabled },
      )
    ) {
      return;
    }
    event.preventDefault();
    primary.onPress();
  };
  return (
    <div className="flex min-w-0 flex-col" data-zerops-surface="review" onKeyDown={pressFromKeys}>
      {content}
    </div>
  );
}

/*
 * The review: one surface in two frames, a sheet over the page (`ZeropsReviewDialog`) and a
 * change's own page. Its type is the scale's, 20 · 14 · 12; its colour means one thing each. In
 * the sheet the head, body and foot stand 24 in (16 on a phone), the body scrolling between them;
 * on the page they are flush with the page's own edges, the foot's card standing 8 out from the
 * text and staying in view.
 */
/** Whose it is: where it acts, the Mate's face and its words, cut to the line. */
const KIND =
  "flex h-7 min-w-0 flex-1 items-center gap-2 text-body leading-4.5 text-muted-foreground *:[svg]:size-3.75 *:[svg]:flex-none";
/** The head: the title, its one line, and why where that is not all. */
const HEAD_SHEET = "grid flex-none gap-1 border-b border-rule px-6 pt-1.5 pb-4 max-sm:px-4";
const HEAD_PAGE = "grid flex-none gap-1 pb-4";
/**
 * A change's title is the Mate's own, often a paragraph: three lines at most in the sheet, the
 * rest on hover — what it does is said below, in its own words.
 */
const TITLE_SHEET = "line-clamp-3 text-title font-semibold text-balance wrap-anywhere";
const TITLE_PAGE = "text-emphasis font-semibold text-balance wrap-anywhere";
/**
 * Where it stands, in plain words: grey while all is well, amber or red for trouble, blue while it
 * moves. A phone's line wraps: a dot goes down with the words after it, never left hanging at a
 * line's end, and one that would start a line is cut with the line's own edge.
 */
const LINE =
  "flex flex-wrap items-center gap-x-1.5 text-body text-muted-foreground tabular-nums max-sm:-ms-3.5 max-sm:gap-x-0 max-sm:[clip-path:inset(0_0_0_14px)]";
const LINE_PART = "inline-flex items-center max-sm:relative max-sm:ps-3.5";
const LINE_PART_AFTER_DOT = `${LINE_PART} max-sm:before:absolute max-sm:before:start-0 max-sm:before:w-3.5 max-sm:before:text-center max-sm:before:text-muted-foreground max-sm:before:content-['·']`;
/** The verdict's words in the line, in their tone. */
const VERDICT_TONE: Record<ReviewVerdict["tone"], string> = {
  ok: "inline-flex items-center gap-1.5",
  done: "inline-flex items-center gap-1.5",
  quiet: "inline-flex items-center gap-1.5",
  attention: "inline-flex items-center gap-1.5 text-status-attention-text",
  failed: "inline-flex items-center gap-1.5 text-status-failed-text",
  busy: "inline-flex items-center gap-1.5 text-status-busy-text",
};
/**
 * Why, under the line, while all is well: a quiet line, its fix a link in it. Trouble is the kit's
 * tinted callout (Alert `tint`) instead.
 */
export const WHY =
  "mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body leading-4.5 text-pretty text-muted-foreground *:data-[slot=button]:-my-0.75 *:data-[slot=button]:-ms-2";
/** The body: the sections, 24 apart; one column no wider than the review, a long line wraps. */
const BODY_SHEET =
  "grid min-h-0 flex-auto grid-cols-1 content-start gap-6 overflow-x-hidden overflow-y-auto overscroll-contain px-6 pt-4.5 pb-5 *:min-w-0 empty:hidden max-sm:px-4";
const BODY_PAGE =
  "grid min-h-0 flex-auto grid-cols-1 content-start gap-6 pt-5 *:min-w-0 empty:hidden";
/**
 * The foot: the quiet words at its start, the ask and the one button together at its end, the one
 * button last, then one line of what happens next — or why the button is held, in its tone. A
 * sheet too narrow for one row keeps the pair on the first line and drops the quiet words under
 * it: the one button never stands alone, and nothing stands above it.
 */
const FOOT_SHEET =
  "mt-auto flex flex-none flex-col gap-2.5 border-t border-rule bg-card px-6 pt-4 pb-5 max-sm:px-4";
/** On the page it is a card that stays in view, clear of a phone's home bar. */
const FOOT_PAGE =
  "sticky bottom-[max(16px,env(safe-area-inset-bottom))] z-1 -mx-2 mt-7 flex flex-none flex-col gap-2.5 rounded-card bg-card px-4 pt-3 pb-3.5 shadow-(--zerops-shadow-drawer) ring-1 ring-foreground/10";
/**
 * Changes reviewed together: the next one's head and body come in from the side it was stepped
 * to, its foot fades in where it stood; a quicker step takes over from wherever this one is.
 * Reduced motion keeps only the fade.
 */
const QUEUE_IN_FADES =
  "data-queue-in:transition-[opacity,translate] data-queue-in:duration-200 data-queue-in:ease-out-strong data-queue-in:starting:opacity-0";
const QUEUE_IN_SLIDES = `${QUEUE_IN_FADES} motion-safe:data-[queue-in=next]:starting:translate-x-3 motion-safe:data-[queue-in=previous]:starting:-translate-x-3`;
const SETTLED =
  "inline-flex flex-none items-center gap-1.5 px-2 text-body font-medium leading-4.5 text-muted-foreground *:[svg]:size-3.75 *:[svg]:text-status-ok";
/**
 * What happens next, under the buttons, in its tone. A note still to come keeps the room of the one
 * that will stand, under the words that say it is loading: the buttons over it never move when it
 * arrives.
 */
const CONSEQ =
  "flex flex-wrap gap-x-2 text-body leading-4.5 text-pretty text-muted-foreground tabular-nums";
const CONSEQ_ROOM =
  "grid text-body leading-4.5 text-pretty text-muted-foreground tabular-nums *:col-start-1 *:row-start-1";
const CONSEQ_TONE: Record<"quiet" | "attention" | "failed", string> = {
  quiet: "",
  attention: "text-status-attention-text",
  failed: "text-status-failed-text",
};

/** The one button: what it does in words, its keys while they press it, its mark while it runs. */
function ReviewPrimary({
  primary,
  onPress,
}: {
  readonly primary: ReviewPrimaryButton;
  /** Told as it is pressed, before the press itself. */
  readonly onPress: () => void;
}) {
  return (
    <Button
      aria-describedby={primary.held?.by}
      data-review-primary=""
      data-safe={primary.safe && primary.enabled && primary.busy !== true ? "true" : "false"}
      data-zerops-primary-action={primary.label}
      disabled={!primary.enabled || primary.busy === true}
      onClick={() => {
        onPress();
        primary.onPress();
      }}
      variant={primary.plain === true ? "secondary" : "primary"}
    >
      {primary.icon === "tag" ? <TagIcon aria-hidden="true" /> : null}
      {primary.icon === "rollback" ? <RotateCcwIcon aria-hidden="true" /> : null}
      {primary.icon === "globe" ? <GlobeIcon aria-hidden="true" /> : null}
      {primary.busy === true ? `${primary.label}…` : (primary.text ?? primary.label)}
      {(primary.safe || primary.shortcut === true) && primary.busy !== true ? (
        <Kbd aria-hidden="true" tone="ink">
          {PRESS_KEYS}
        </Kbd>
      ) : null}
    </Button>
  );
}

/**
 * The buttons' place, held from the press: the one button records where the row stands as it is
 * pressed, and while the review is `held` its sheet takes whatever height keeps the row no higher
 * than that — or than anywhere it has stood since. A sheet already the window's height has no
 * more to take. A review opened on something already under way holds from where it first stood.
 */
function useHeldButtons(held: boolean, row: RefObject<HTMLDivElement | null>): () => void {
  const floor = useRef<number | undefined>(undefined);
  // Whether this review set the sheet's height: a review beside it in the sheet leaves it be.
  const holding = useRef(false);
  useLayoutEffect(() => {
    const node = row.current;
    const sheet = node?.closest<HTMLElement>("[data-review-sheet]");
    if (node === null || sheet === null || sheet === undefined) return;
    if (!held) {
      floor.current = undefined;
      if (holding.current) sheet.style.minHeight = "";
      holding.current = false;
      return;
    }
    const top = node.getBoundingClientRect().top;
    if (floor.current === undefined || top >= floor.current) {
      floor.current = top;
      return;
    }
    const room = window.innerHeight - 24;
    const taller = sheet.getBoundingClientRect().height + (floor.current - top);
    sheet.style.minHeight = `${String(Math.min(taller, room))}px`;
    holding.current = true;
  });
  return () => {
    floor.current = row.current?.getBoundingClientRect().top;
  };
}

/** The rare ways behind ⋯: a short menu at the top line's end. */
function ReviewMenu({ items }: { readonly items: ReadonlyArray<ReviewMenuItem> }) {
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="More" size="icon-sm" variant="ghost-muted" />}>
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        {items.map((item) =>
          "to" in item ? (
            <ReviewMenuLink item={item} key={item.label} />
          ) : (
            <MenuItem
              key={item.label}
              onClick={item.onPress}
              variant={item.destructive === true ? "destructive" : "default"}
            >
              {item.label}
            </MenuItem>
          ),
        )}
      </MenuPopup>
    </Menu>
  );
}

function ReviewMenuLink({ item }: { readonly item: Extract<ReviewMenuItem, { to: GitLink }> }) {
  const link = useGitLinkProps(item.to);
  // The link's own handler leaves for the Git browser on a plain press: no second navigation.
  return <MenuItem render={<a href={link.href} onClick={link.onClick} />}>{item.label}</MenuItem>;
}

/** A section folded to its one row: open or not, and the press that turns it. */
export interface ReviewFoldState {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/**
 * One section: its label (the kit's quiet `SectionHeader`) with what it counts beside it and its state or
 * press at the line's end, and what it holds. Folded, its label is the press that opens it —
 * "Files · 4 changed · +163 −12 ⌄" — and what it holds stays drawn, hidden, so nothing it read or
 * was typed into it is lost while it is shut.
 */
export function ReviewSection({
  title,
  count,
  action,
  fold,
  titleShown = true,
  children,
}: {
  readonly title: string;
  /** What it counts, said beside its title. */
  readonly count?: ReactNode;
  /** Its own state or press, at its label's end. */
  readonly action?: ReactNode;
  readonly fold?: ReviewFoldState | undefined;
  /** Whether its label is seen; one what it holds already says is kept for screen readers only. */
  readonly titleShown?: boolean | undefined;
  readonly children: ReactNode;
}) {
  if (fold !== undefined) {
    return (
      <Collapsible
        onOpenChange={fold.onToggle}
        open={fold.open}
        render={<section className={SECTION} />}
      >
        <SectionHeader action={action} count={count} folds level={3} size="panel" title={title} />
        <CollapsiblePanel className="mt-3" keepMounted>
          {children}
        </CollapsiblePanel>
      </Collapsible>
    );
  }
  return (
    <section className={SECTION}>
      {titleShown || action !== undefined ? (
        <SectionHeader
          action={action}
          count={titleShown ? count : undefined}
          level={3}
          size="panel"
          title={titleShown ? title : <span className="sr-only">{title}</span>}
        />
      ) : (
        <h3 className="sr-only">{title}</h3>
      )}
      {children}
    </section>
  );
}

/**
 * A section's label hugs what it names, sections 24 apart; one with nothing under its label says
 * nothing and is not drawn. A state at its label's end (`data-section-state`) takes the label's
 * next line where it is too long for its own.
 */
const SECTION =
  "has-[>[data-slot=section-header]:only-child]:hidden [&>[data-slot=section-header]]:mb-1.5 [&>[data-slot=section-header]:has([data-section-state])]:flex-wrap [&>[data-slot=section-header]:has([data-section-state])]:gap-y-0.5";

/** A fold of the review's own, shut until it is opened. */
export function useReviewFold(initiallyOpen = false): ReviewFoldState & {
  readonly show: () => void;
} {
  const [open, setOpen] = useState(initiallyOpen);
  return {
    open,
    onToggle: () => {
      setOpen((current) => !current);
    },
    show: () => {
      setOpen(true);
    },
  };
}

/** "Try it": the Mate's previews, each by its Mate and its part (`tryItWords`), opened in a tab. */
export function ReviewTry({
  mateName,
  previews,
  everything = false,
}: {
  readonly mateName: string;
  readonly previews: ReadonlyArray<{ readonly service: string; readonly url: string }>;
  /** Its Mate holds more than one open change: the preview shows all of its work. */
  readonly everything?: boolean | undefined;
}) {
  return (
    <ReviewSection title="Try it">
      <div className="flex flex-wrap gap-2">
        {previews.map((preview) => {
          const words = tryItWords(mateName, preview.service);
          return (
            <Button
              className="max-w-full"
              key={preview.service}
              render={<a href={preview.url} rel="noreferrer" target="_blank" />}
              size="sm"
              variant="secondary"
            >
              <GlobeIcon aria-hidden="true" />
              <span className="flex-none font-medium">{words.preview}</span>
              <span className="min-w-0 truncate text-muted-foreground">· {words.part}</span>
              <ArrowUpRightIcon aria-hidden="true" />
            </Button>
          );
        })}
      </div>
      {everything ? (
        <Text className="mt-1.5" render={<p />} variant="description">
          {tryItEverything(mateName)}
        </Text>
      ) : null}
    </ReviewSection>
  );
}

/**
 * What could not be read, said where it would have stood, with *Try again*: a failure never
 * blanks its section.
 */
export function ReviewFailed({
  what,
  reason,
  onRetry,
}: {
  /** What could not be read: "The files couldn't be read." */
  readonly what: string;
  /** Why, in HQ's words. */
  readonly reason: string;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <div>
      <Failure
        action={
          onRetry === undefined ? undefined : (
            <Button onClick={onRetry} size="sm" variant="secondary">
              Try again
            </Button>
          )
        }
        cause={what}
      >
        {reason}
      </Failure>
    </div>
  );
}

/** Lines standing in for words still being read. */
export function ReviewSkeleton({ lines }: { readonly lines: number }) {
  return (
    <div aria-hidden="true" className="grid gap-2.5 py-1.25">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          className={index === lines - 1 ? "h-3 w-[62%]" : "h-3"}
          key={index}
          shape="pill"
          surface="card"
        />
      ))}
    </div>
  );
}

interface ReviewFileRow {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly previousPath?: string | undefined;
}

/**
 * A file's diff: read, still reading, or why it could not be. `cut` where the file's diff was too
 * long to read here: no lines of it are held.
 */
export type ReviewDiffState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "read"; readonly file: ChangeDiffFile | undefined; readonly cut: boolean };

/**
 * The files it changes, 36 px each with a status letter, the folder dimmed and the +/−; a file
 * opens its diff in place (R4), and under it the whole file in the Git browser, where the change
 * still has it. A row holds the list's place while it is read.
 */
export function ReviewFiles({
  files,
  failed,
  diffOf,
  fileAt,
  notRecorded,
  onOpen,
  onRetry,
  initiallyOpen,
}: {
  readonly files: ReadonlyArray<ReviewFileRow> | undefined;
  /** Where a file is read whole in the Git browser; absent, a diff is all there is. */
  readonly fileAt?: ((path: string) => GitLink) | undefined;
  /** Why the files could not be read, where they could not. */
  readonly failed?: string | undefined;
  readonly diffOf: (path: string) => ReviewDiffState;
  /** HQ has not recorded the files yet: said as that, with a press that reads them where offered. */
  readonly notRecorded?: { readonly onShow: (() => void) | undefined } | undefined;
  /** A file was unfolded: where its diff is read on demand. */
  readonly onOpen?: ((path: string) => void) | undefined;
  /** Reads what could not be read again. */
  readonly onRetry?: (() => void) | undefined;
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen ?? []));
  if (failed !== undefined) {
    return (
      <div className={FILES}>
        <div className="py-1.75 ps-3 pe-3.5">
          <ReviewFailed onRetry={onRetry} reason={failed} what="The files couldn't be read." />
        </div>
      </div>
    );
  }
  if (notRecorded !== undefined) {
    return (
      <div className={FILES}>
        <p className={DIFF_NOTE}>The files are not known yet.</p>
        {notRecorded.onShow === undefined ? null : (
          <Button onClick={notRecorded.onShow} size="sm" variant="link">
            Show files
          </Button>
        )}
      </div>
    );
  }
  if (files === undefined) {
    return (
      <div className={FILES}>
        <Loading label="The files">
          <div className="flex h-9 items-center ps-9.5 pe-3">
            <Skeleton className="h-2.5 w-2/5" shape="pill" surface="card" />
          </div>
        </Loading>
      </div>
    );
  }
  return (
    <div className={FILES}>
      <List>
        {files.map((file) => {
          const expanded = open.has(file.path);
          const { dir, name } = changeFileParts(file.path);
          const letter = file.status === "unknown" ? undefined : changeFileLetter(file.status);
          return (
            <FileRow
              diff={expanded ? diffOf(file.path) : undefined}
              dir={dir}
              expanded={expanded}
              file={file}
              key={file.path}
              letter={letter}
              name={name}
              onRetry={onRetry}
              // A file the change deletes is in none of its commits any more.
              open={letter === "D" ? undefined : fileAt?.(file.path)}
              onToggle={() => {
                if (!expanded) onOpen?.(file.path);
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                });
              }}
            />
          );
        })}
      </List>
    </div>
  );
}

function FileRow({
  file,
  dir,
  name,
  letter,
  expanded,
  diff,
  open,
  onToggle,
  onRetry,
}: {
  readonly file: ReviewFileRow;
  readonly open: GitLink | undefined;
  readonly dir: string;
  readonly name: string;
  readonly letter: string | undefined;
  readonly expanded: boolean;
  readonly diff: ReviewDiffState | undefined;
  readonly onToggle: () => void;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    // A file's row opens its diff under it: the kit's disclosure, its row the review's own.
    <Collapsible onOpenChange={onToggle} open={expanded} render={<List />}>
      <CollapsibleTrigger className="grid h-9 w-full grid-cols-[16px_minmax(0,1fr)_auto_16px] items-center gap-x-2.5 px-3 text-start font-mono text-line leading-none outline-none transition-colors duration-150 hover:bg-item-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <span className={STATUS[letter ?? ""] ?? STATUS[""]}>{letter}</span>
        <span className="truncate">
          <span className="text-muted-foreground">{dir}</span>
          {name}
        </span>
        <span className="font-sans text-body/none">
          <DiffStat additions={file.additions} deletions={file.deletions} />
        </span>
        <span className="flex text-muted-foreground transition-[rotate] duration-200 ease-out-strong in-aria-expanded:rotate-180 motion-reduce:transition-none">
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </span>
      </CollapsibleTrigger>
      {diff === undefined ? null : (
        <ReviewDiff diff={diff} onRetry={onRetry} open={open} previousPath={file.previousPath} />
      )}
    </Collapsible>
  );
}

/**
 * One file's diff: hunk headers, numbers, + green and − red; a long line wraps under its code,
 * so nothing ever scrolls sideways. What is too long to show here says so. Under it, *Open file*
 * reads the whole file in the Git browser — one press away however little the diff can show.
 */
export function ReviewDiff({
  diff,
  previousPath,
  open,
  onRetry,
}: {
  readonly diff: ReviewDiffState;
  readonly previousPath?: string | undefined;
  readonly open?: GitLink | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  const [all, setAll] = useState(false);
  const opener =
    open === undefined ? null : (
      <p className={DIFF_NOTE}>
        <GitBrowserLink to={open}>Open file</GitBrowserLink>
      </p>
    );
  if (diff.kind === "reading") {
    return (
      <div className={DIFF}>
        <Loading label="The diff">
          <ReviewSkeleton lines={3} />
        </Loading>
        {opener}
      </div>
    );
  }
  if (diff.kind === "failed") {
    return (
      <div className={DIFF}>
        <div className="ps-15 pe-1.5">
          <ReviewFailed onRetry={onRetry} reason={diff.reason} what="The diff couldn't be read." />
        </div>
        {opener}
      </div>
    );
  }
  const file = diff.file;
  if (file === undefined && diff.cut) {
    return (
      <div className={DIFF}>
        <p className={DIFF_NOTE}>Too long to read here.</p>
        {opener}
      </div>
    );
  }
  if (file === undefined || file.binary || file.hunks.length === 0) {
    const note =
      file?.binary === true
        ? "A binary file: nothing here to read."
        : previousPath !== undefined
          ? `Renamed from ${previousPath}, nothing else changed.`
          : "Nothing to show for this file.";
    return (
      <div className={DIFF}>
        <p className={DIFF_NOTE}>{note}</p>
        {opener}
      </div>
    );
  }
  const rows: Array<{
    readonly key: string;
    readonly kind: "hunk" | "context" | "add" | "del";
    readonly n: number | null;
    readonly text: string;
  }> = [];
  file.hunks.forEach((hunk, hunkIndex) => {
    rows.push({ key: `h${String(hunkIndex)}`, kind: "hunk", n: null, text: hunk.header });
    hunk.lines.forEach((line, lineIndex) => {
      rows.push({
        key: `h${String(hunkIndex)}l${String(lineIndex)}`,
        kind: line.kind,
        n: line.kind === "del" ? line.oldLine : line.newLine,
        text: line.text,
      });
    });
  });
  const { shown, rest } = diffFold({ total: rows.length, all });
  return (
    <div className={DIFF}>
      <div className="grid grid-cols-1">
        {rows.slice(0, shown).map((row) => (
          <div className={DIFF_LINE[row.kind]} key={row.key}>
            <span className="pe-2 text-right text-muted-foreground tabular-nums opacity-70">
              {row.n ?? ""}
            </span>
            <span className={DIFF_SIGN[row.kind]}>
              {row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}
            </span>
            <span>{row.text}</span>
          </div>
        ))}
      </div>
      {rest?.kind === "show" ? (
        <Button
          className="mt-1 mb-0.5 ml-15 self-start"
          onClick={() => {
            setAll(true);
          }}
          size="sm"
          variant="link"
        >
          {rest.label}
        </Button>
      ) : null}
      {rest?.kind === "cut" ? <p className={DIFF_NOTE}>{rest.words}</p> : null}
      {opener}
    </div>
  );
}

/** The files, each a 36 px row; a file's diff opens in place under it, its long lines wrapped. */
const FILES = "overflow-hidden rounded-card inset-ring-1 inset-ring-foreground/12";
/** A file's status letter: added green, deleted red, the rest quiet. */
const STATUS: Record<string, string> = {
  "": "flex size-4 items-center justify-center rounded-mark font-sans text-caption font-medium text-muted-foreground inset-ring-1 inset-ring-foreground/12",
  A: "flex size-4 items-center justify-center rounded-mark font-sans text-caption font-medium text-diff-addition-foreground inset-ring-1 inset-ring-diff-addition-foreground/40",
  D: "flex size-4 items-center justify-center rounded-mark font-sans text-caption font-medium text-diff-deletion-foreground inset-ring-1 inset-ring-diff-deletion-foreground/40",
};
/** A file's diff, open under its row: numbered lines on the code ground, at the person's code size. */
const DIFF =
  "bg-code py-1.5 font-mono text-(length:--font-size-code,var(--text-line)) leading-5 text-code-foreground [tab-size:4]";
/**
 * A long line wraps inside its own column and hangs under its code: the number and the sign keep
 * theirs, so the gutter stays one straight edge.
 */
const DIFF_LINE: Record<"hunk" | "context" | "add" | "del", string> = {
  hunk: "grid grid-cols-[44px_16px_minmax(0,1fr)] pe-3 whitespace-pre-wrap wrap-anywhere text-muted-foreground",
  context: "grid grid-cols-[44px_16px_minmax(0,1fr)] pe-3 whitespace-pre-wrap wrap-anywhere",
  add: "grid grid-cols-[44px_16px_minmax(0,1fr)] pe-3 whitespace-pre-wrap wrap-anywhere bg-diff-addition/12",
  del: "grid grid-cols-[44px_16px_minmax(0,1fr)] pe-3 whitespace-pre-wrap wrap-anywhere bg-diff-deletion/11",
};
const DIFF_SIGN: Record<"hunk" | "context" | "add" | "del", string | undefined> = {
  hunk: undefined,
  context: undefined,
  add: "text-diff-addition-foreground",
  del: "text-diff-deletion-foreground",
};
/** A quiet sentence in the diff's column, under the code's edge. */
const DIFF_NOTE = "py-1 ps-15 pe-3 font-sans text-body text-muted-foreground";

const STAGE_WORDS: Record<ReleaseChangeRow["stage"], string | undefined> = {
  "on-stage": "on stage",
  "deploying-on-stage": "deploying on stage",
  "failed-on-stage": "failed on stage",
  none: undefined,
};

export type ReviewReleaseRow = ReleaseChangeRow & {
  readonly face?: ReviewFaceProps;
  /** Its Mate, by name, where it has one. */
  readonly mate?: string;
  readonly sub: string;
};

/**
 * What goes out: one row per change, its Mate's face, and whether stage ran it. A row that is a
 * change opens its review (`onOpen`), the whole row, with a › at its end; a commit nobody
 * reviewed has no review to open: it opens its own page in the Git browser, where the
 * application (`appId`) is known.
 */
export function ReviewReleaseRows({
  rows,
  onOpen,
  appId,
}: {
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  readonly onOpen?: ((row: ReviewReleaseRow) => void) | undefined;
  readonly appId?: string | undefined;
}) {
  return (
    // What goes out, one line per change, the rows' words on the column's edge.
    <div className="-mx-3 grid">
      {rows.map((row) => {
        // Every change on the stage is the line's to say; a row says only what stands out.
        const mark = row.stage === "on-stage" ? undefined : STAGE_WORDS[row.stage];
        const parts = {
          lead:
            row.face === undefined ? undefined : (
              <MateFace
                className="size-4.5"
                shape={row.face.shape}
                size={16}
                state={row.face.state ?? "idle"}
                tint={row.face.tint}
              />
            ),
          title: row.title,
          line:
            mark === undefined ? (
              row.sub === "" ? null : (
                row.sub
              )
            ) : (
              // Where a change stands on stage, where that stands out: busy blue, or failed red.
              <span
                className={
                  row.stage === "failed-on-stage"
                    ? "flex items-center gap-1 text-caption whitespace-nowrap text-status-failed-text"
                    : "flex items-center gap-1 text-caption whitespace-nowrap text-status-busy-text"
                }
              >
                {mark}
              </span>
            ),
          size: "sm",
        } as const;
        // A change row's way in: a › that comes forward under the pointer; where nothing hovers, it
        // says so at rest.
        const go = (
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 self-center text-muted-foreground opacity-0 transition-[opacity,color,translate] duration-200 ease-out-strong in-[[data-release-row]:hover]:translate-x-0.5 in-[[data-release-row]:hover]:text-foreground in-[[data-release-row]:hover]:opacity-100 [@media(hover:none)]:opacity-100"
          />
        );
        if (onOpen === undefined) return <Row key={row.key} {...parts} />;
        if (row.change === undefined) {
          return appId === undefined || row.commit === undefined ? (
            <Row key={row.key} {...parts} />
          ) : (
            <ReleaseCommitRow
              key={row.key}
              rowKey={row.key}
              row={{ ...parts, meta: go }}
              to={gitCommitLink({ appId, repo: row.commit.repository }, row.commit.sha)}
            />
          );
        }
        return (
          <Row
            key={row.key}
            {...parts}
            data-mate-face-row=""
            data-release-row={row.key}
            meta={go}
            pressable
            render={
              <button
                onClick={() => {
                  onOpen(row);
                }}
                type="button"
              />
            }
          />
        );
      })}
    </div>
  );
}

/** A commit nobody reviewed, the whole row a link to its page in the Git browser. */
function ReleaseCommitRow({
  rowKey,
  to,
  row,
}: {
  readonly rowKey: string;
  readonly to: GitLink;
  readonly row: Omit<ComponentProps<typeof Row>, "render">;
}) {
  return (
    <Row
      {...row}
      data-mate-face-row=""
      data-release-row={rowKey}
      pressable
      render={<a {...useGitLinkProps(to)} />}
    />
  );
}

/** Where it goes: the planned deploy, replaced by HQ's answer after the press. */
export function ReviewWhere({
  rows,
  answer,
}: {
  readonly rows?: ReadonlyArray<DeployWhereRow> | undefined;
  readonly answer?: HqDeployAnswer | undefined;
}) {
  return <ZeropsDeployAnswer answer={answer} rows={rows} />;
}

/**
 * The top line's "‹ 1 of 3 ›": the change before and after, each its own press — nothing merges
 * from here. A step lands the focus on the same step in the review it brings, so the arrows walk on.
 */
function ReviewQueueSteps({ queue }: { readonly queue: ReviewQueueLine }) {
  const previous = useRef<HTMLButtonElement | null>(null);
  const next = useRef<HTMLButtonElement | null>(null);
  const { arrived } = queue;
  useLayoutEffect(() => {
    if (arrived === undefined) return;
    // The step pressed went with the review it stood in; a merge's own move leaves the focus where
    // the person put it.
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const step = arrived === "next" ? next.current : previous.current;
    if (step !== null && !step.disabled) step.focus({ preventScroll: true });
    else step?.closest<HTMLElement>("[data-review-sheet]")?.focus({ preventScroll: true });
  }, [arrived]);
  return (
    // Loose in the top line, as its other presses are: the last of them alone hugs the edge.
    <>
      <Button
        aria-label="Previous change"
        disabled={queue.onPrevious === undefined}
        onClick={queue.onPrevious}
        ref={previous}
        size="icon-sm"
        variant="ghost-muted"
      >
        <ChevronLeftIcon aria-hidden="true" />
      </Button>
      <span aria-live="polite" className="px-1 text-line text-muted-foreground tabular-nums">
        {queue.words}
      </span>
      <Button
        aria-label="Next change"
        disabled={queue.onNext === undefined}
        onClick={queue.onNext}
        ref={next}
        size="icon-sm"
        variant="ghost-muted"
      >
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </>
  );
}
