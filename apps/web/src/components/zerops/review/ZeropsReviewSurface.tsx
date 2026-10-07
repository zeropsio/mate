import { isField } from "./ZeropsReview.logic";
/**
 * The review, drawn: every read already done and handed in, so a harness and a test can show
 * every state of it without a forge or a crew behind it. The reads and the verbs are the per-kind
 * reviews'.
 *
 * One surface in two frames (`ReviewFrame`), the same sections in the same words in each. In a
 * dialog over the conversation — `ZeropsReviewDialog`'s, a quick look — a row above the title says
 * what kind of thing it is and offers its own page where it has one, and × closes it. As a page,
 * at its own address, the page's bar says where it sits, and the review is the page: its one
 * button pinned in view, and ⌘↵ pressing it while it is safe, as the dialog's does.
 *
 * One reading order, top to bottom (R2–R5): its title with one line of provenance, the verdict,
 * what it does, what it changes, what was said and its commits — and a foot
 * that says what the one button does, beside it.
 */
import type { ChangeDiffFile, ReviewTone, ReviewVerdict } from "@t3tools/client-runtime/zerops";
import { changeFileParts } from "@t3tools/client-runtime/zerops";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  GitPullRequestArrowIcon,
  Maximize2Icon,
  RotateCcwIcon,
  TagIcon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";

import { Spinner } from "~/components/ui/spinner";
import { isMacPlatform } from "~/lib/utils";

import { MateFace } from "../primitives";
import { ZeropsDeployAnswer } from "../ZeropsDeployAnswer";
import {
  changeFileLetter,
  diffFold,
  pressesPrimary,
  type ReleaseChangeRow,
  type ReviewFrame,
  type ReviewKind,
} from "./ZeropsReview.logic";

/** The keys that press the primary, as this platform writes them. */
const PRESS_KEYS =
  typeof navigator !== "undefined" && !isMacPlatform(navigator.platform) ? "Ctrl ↵" : "⌘↵";

const KIND_ICON: Record<ReviewKind, ReactNode> = {
  change: <GitPullRequestArrowIcon aria-hidden="true" />,
  release: <TagIcon aria-hidden="true" />,
  rollback: <RotateCcwIcon aria-hidden="true" />,
  "crew-task": <UsersIcon aria-hidden="true" />,
};

function verdictIcon(verdict: ReviewVerdict): ReactNode {
  if (verdict.state === "rollback-ready") return <RotateCcwIcon aria-hidden="true" />;
  if (verdict.state === "land-now") return <CircleDashedIcon aria-hidden="true" />;
  const byTone: Record<ReviewTone, ReactNode> = {
    ok: <CircleCheckIcon aria-hidden="true" />,
    done: <CircleCheckIcon aria-hidden="true" />,
    quiet: <CircleCheckIcon aria-hidden="true" />,
    attention: <TriangleAlertIcon aria-hidden="true" />,
    failed: <CircleXIcon aria-hidden="true" />,
    busy: <Spinner size="md" tone="muted" />,
  };
  return byTone[verdict.tone];
}

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

export interface ReviewPrimaryButton extends ReviewButton {
  readonly enabled: boolean;
  readonly safe: boolean;
  /** Its keys shown before it takes them (`ReviewPrimary.shortcut`). */
  readonly shortcut?: true | undefined;
  /** Pressed and running: the label says so, and it takes no second press. */
  readonly busy?: boolean;
  readonly icon?: "tag" | "rollback" | undefined;
}

export interface ZeropsReviewSurfaceProps {
  /** A dialog over the conversation (the default), or a page of its own. */
  readonly frame?: ReviewFrame | undefined;
  readonly kind: ReviewKind;
  readonly kindLabel: string;
  readonly title: string;
  readonly titleId?: string | undefined;
  /** The one line of provenance under the title. */
  readonly meta?: ReactNode;
  readonly verdict: ReviewVerdict;
  /** "Ask Nova to resolve it": the fix, where there is a Mate of the person's to ask. */
  readonly fix?: ReviewButton | undefined;
  /** The sections, in reading order. */
  readonly children?: ReactNode;
  readonly consequence: string;
  /** "Cancel" before anything was pressed, "Close" after. */
  readonly dismiss?: string | undefined;
  /** A quiet word beside the button: a change's "Close without merging…", then "Keep it open". */
  readonly secondary?: (ReviewButton & { readonly enabled: boolean }) | undefined;
  readonly primary?: ReviewPrimaryButton | undefined;
  /** What was already done, said where the button would stand: "Merged". */
  readonly settled?: string | undefined;
  /**
   * The dialog's way back to the review this one was stepped into from — "← Release" — in the
   * place of what kind of thing it is.
   */
  readonly back?: ReviewButton | undefined;
  /** The dialog's way to the same review as a page, where it has one. */
  readonly onOpenPage?: (() => void) | undefined;
  readonly onClose: () => void;
}

export function ZeropsReviewSurface({
  frame = "dialog",
  kind,
  kindLabel,
  title,
  titleId,
  meta,
  verdict,
  fix,
  children,
  consequence,
  dismiss,
  secondary,
  primary,
  settled,
  back,
  onOpenPage,
  onClose,
}: ZeropsReviewSurfaceProps) {
  const Title = frame === "page" ? "h1" : "h2";
  const content = (
    <>
      {frame === "page" ? null : (
        <div className="rv-chrome">
          {back === undefined ? (
            <span className="rv-kind">
              {KIND_ICON[kind]}
              {kindLabel}
            </span>
          ) : (
            <span className="rv-kind">
              <button className="rv-back" data-review-back="" onClick={back.onPress} type="button">
                <ArrowLeftIcon aria-hidden="true" />
                {back.label}
              </button>
            </span>
          )}
          {onOpenPage === undefined ? null : (
            <button className="rv-open" onClick={onOpenPage} type="button">
              <Maximize2Icon aria-hidden="true" />
              Open as page
            </button>
          )}
          <button aria-label="Close" className="rv-x" onClick={onClose} type="button">
            <XIcon aria-hidden="true" size={16} />
          </button>
        </div>
      )}
      <header className="rv-head">
        <Title className="rv-title" id={titleId}>
          {title}
        </Title>
        {meta === undefined ? null : <div className="rv-meta">{meta}</div>}
      </header>
      <div
        aria-live="polite"
        className="rv-verdict"
        data-review-state={verdict.state}
        data-tone={verdict.tone}
      >
        <span className="rv-vi">{verdictIcon(verdict)}</span>
        <span>
          <b>{verdict.title}</b>
          <span className="rv-why">{verdict.why}</span>
        </span>
        {fix === undefined ? (
          <span />
        ) : (
          <button className="rv-textbtn" onClick={fix.onPress} type="button">
            {fix.label}
          </button>
        )}
      </div>
      <div className="rv-body">{children}</div>
      <footer className="rv-foot">
        <span className="rv-conseq">{consequence}</span>
        {secondary === undefined ? null : (
          <button
            className="rv-btn2"
            data-review-secondary=""
            disabled={!secondary.enabled}
            onClick={secondary.onPress}
            type="button"
          >
            {secondary.label}
          </button>
        )}
        {dismiss === undefined || frame === "page" ? null : (
          <button className="rv-btn2" onClick={onClose} type="button">
            {dismiss}
          </button>
        )}
        {settled === undefined ? null : (
          <span className="rv-settled">
            <CheckIcon aria-hidden="true" />
            {settled}
          </span>
        )}
        {primary === undefined ? null : (
          <button
            className="rv-btn1"
            data-review-primary=""
            data-safe={primary.safe && primary.enabled && primary.busy !== true ? "true" : "false"}
            data-zerops-primary-action={primary.label}
            disabled={!primary.enabled || primary.busy === true}
            onClick={primary.onPress}
            type="button"
          >
            {primary.icon === "tag" ? <TagIcon aria-hidden="true" /> : null}
            {primary.icon === "rollback" ? <RotateCcwIcon aria-hidden="true" /> : null}
            {primary.busy === true ? `${primary.label}…` : primary.label}
            {(primary.safe || primary.shortcut === true) && primary.busy !== true ? (
              <kbd aria-hidden="true">{PRESS_KEYS}</kbd>
            ) : null}
          </button>
        )}
      </footer>
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
    <div className="rv-page" data-zerops-surface="review" onKeyDown={pressFromKeys}>
      {content}
    </div>
  );
}

/** One section: its small label, what it counts on the right, and what it holds. */
export function ReviewSection({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h3 className="rv-sec-h">
        {title}
        {aside === undefined ? null : <span>{aside}</span>}
      </h3>
      {children}
    </section>
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
    <div className="rv-failed" role="status">
      <TriangleAlertIcon aria-hidden="true" />
      <span className="min-w-0">
        {what} <span className="rv-failed-why">{reason}</span>
      </span>
      {onRetry === undefined ? null : (
        <button className="rv-textbtn" onClick={onRetry} type="button">
          Try again
        </button>
      )}
    </div>
  );
}

/** Lines standing in for words still being read. */
export function ReviewSkeleton({ lines }: { readonly lines: number }) {
  return (
    <div aria-hidden="true" className="rv-skeleton">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

/** `+42 −3`, each in its colour. */
export function ReviewSize({
  additions,
  deletions,
}: {
  readonly additions: string;
  readonly deletions: string;
}) {
  return (
    <>
      <span className="rv-add">{additions}</span> <span className="rv-del">{deletions}</span>
    </>
  );
}

export interface ReviewFileRow {
  readonly path: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly previousPath?: string | undefined;
}

/**
 * A file's diff: read, still reading, or why it could not be. `cut` where the diff was too long
 * to read whole — a file missing from it lies past where the read stopped.
 */
export type ReviewDiffState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "read"; readonly file: ChangeDiffFile | undefined; readonly cut: boolean };

/**
 * The files it changes, 36 px each with a status letter, the folder dimmed and the +/−; a file
 * opens its diff in place (R4). A row holds the list's place while it is read.
 */
export function ReviewFiles({
  files,
  failed,
  diffOf,
  onRetry,
  initiallyOpen,
}: {
  readonly files: ReadonlyArray<ReviewFileRow> | undefined;
  /** Why the files could not be read, where they could not. */
  readonly failed?: string | undefined;
  readonly diffOf: (path: string) => ReviewDiffState;
  /** Reads what could not be read again. */
  readonly onRetry?: (() => void) | undefined;
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen ?? []));
  if (failed !== undefined) {
    return (
      <div className="rv-files">
        <ReviewFailed onRetry={onRetry} reason={failed} what="The files couldn't be read." />
      </div>
    );
  }
  if (files === undefined) {
    return (
      <div aria-busy="true" className="rv-files">
        <div className="rv-file-skeleton">
          <span />
        </div>
      </div>
    );
  }
  return (
    <div className="rv-files">
      {files.map((file) => {
        const expanded = open.has(file.path);
        const { dir, name } = changeFileParts(file.path);
        const letter = changeFileLetter(file.status);
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
            onToggle={() => {
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
  onToggle,
  onRetry,
}: {
  readonly file: ReviewFileRow;
  readonly dir: string;
  readonly name: string;
  readonly letter: string;
  readonly expanded: boolean;
  readonly diff: ReviewDiffState | undefined;
  readonly onToggle: () => void;
  readonly onRetry: (() => void) | undefined;
}) {
  return (
    <>
      <button aria-expanded={expanded} className="rv-file" onClick={onToggle} type="button">
        <span className="rv-st" data-status={letter}>
          {letter}
        </span>
        <span className="rv-file-name">
          <span className="rv-file-dir">{dir}</span>
          {name}
        </span>
        <span className="rv-file-n">
          {file.additions > 0 ? <span className="rv-add">+{file.additions}</span> : null}
          {file.additions > 0 && file.deletions > 0 ? " " : null}
          {file.deletions > 0 ? <span className="rv-del">−{file.deletions}</span> : null}
        </span>
        <span className="rv-chev">
          <ChevronDownIcon aria-hidden="true" />
        </span>
      </button>
      {diff === undefined ? null : (
        <ReviewDiff diff={diff} onRetry={onRetry} previousPath={file.previousPath} />
      )}
    </>
  );
}

/**
 * One file's diff: hunk headers, numbers, + green and − red; a long line wraps under its code,
 * so nothing ever scrolls sideways. What is too long to show here says so.
 */
export function ReviewDiff({
  diff,
  previousPath,
  onRetry,
}: {
  readonly diff: ReviewDiffState;
  readonly previousPath?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  const [all, setAll] = useState(false);
  if (diff.kind === "reading") {
    return (
      <div className="rv-diff">
        <p className="rv-diff-note">Reading the diff…</p>
      </div>
    );
  }
  if (diff.kind === "failed") {
    return (
      <div className="rv-diff">
        <ReviewFailed onRetry={onRetry} reason={diff.reason} what="The diff couldn't be read." />
      </div>
    );
  }
  const file = diff.file;
  if (file === undefined && diff.cut) {
    return (
      <div className="rv-diff">
        <p className="rv-diff-note">Too long to read here.</p>
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
      <div className="rv-diff">
        <p className="rv-diff-note">{note}</p>
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
  const { shown, rest } = diffFold({ total: rows.length, all, cut: file.cut });
  return (
    <div className="rv-diff">
      <div className="rv-diff-lines">
        {rows.slice(0, shown).map((row) => (
          <div className="rv-dl" data-kind={row.kind} key={row.key}>
            <span className="ln">{row.n ?? ""}</span>
            <span className="sg">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
            <span>{row.text}</span>
          </div>
        ))}
      </div>
      {rest?.kind === "show" ? (
        <button
          className="rv-textbtn rv-diff-more"
          onClick={() => {
            setAll(true);
          }}
          type="button"
        >
          {rest.label}
        </button>
      ) : null}
      {rest?.kind === "cut" ? <p className="rv-diff-note">{rest.words}</p> : null}
    </div>
  );
}

const STAGE_WORDS: Record<ReleaseChangeRow["stage"], string | undefined> = {
  "on-stage": "on stage",
  "deploying-on-stage": "deploying on stage",
  "failed-on-stage": "failed on stage",
  none: undefined,
};

export type ReviewReleaseRow = ReleaseChangeRow & {
  readonly face?: ReviewFaceProps;
  readonly sub: string;
};

/**
 * What goes out: one row per change, its Mate's face, and whether stage ran it. A row that is a
 * change opens its review (`onOpen`), the whole row, with a › at its end; a commit nobody
 * reviewed has no review to open.
 */
export function ReviewReleaseRows({
  rows,
  onOpen,
}: {
  readonly rows: ReadonlyArray<ReviewReleaseRow>;
  readonly onOpen?: ((row: ReviewReleaseRow) => void) | undefined;
}) {
  return (
    <div className="rv-rel" data-opens={onOpen === undefined ? undefined : ""}>
      {rows.map((row) => {
        const mark = STAGE_WORDS[row.stage];
        const cells = (
          <>
            {row.face === undefined ? (
              <span />
            ) : (
              <MateFace
                shape={row.face.shape}
                size="sm"
                state={row.face.state ?? "idle"}
                tint={row.face.tint}
              />
            )}
            <span className="min-w-0">
              <span className="rv-relrow-t">{row.title}</span>
              <span className="rv-relrow-sub">{row.sub}</span>
            </span>
            {mark === undefined ? (
              <span />
            ) : (
              <span className="rv-on" data-mark={row.stage}>
                {row.stage === "on-stage" ? <CheckIcon aria-hidden="true" /> : null}
                {mark}
              </span>
            )}
          </>
        );
        if (onOpen === undefined) {
          return (
            <div className="rv-relrow" key={row.key}>
              {cells}
            </div>
          );
        }
        if (row.change === undefined) {
          return (
            <div className="rv-relrow" key={row.key}>
              {cells}
              <span />
            </div>
          );
        }
        return (
          <button
            className="rv-relrow"
            data-release-row={row.key}
            key={row.key}
            onClick={() => {
              onOpen(row);
            }}
            type="button"
          >
            {cells}
            <ChevronRightIcon aria-hidden="true" className="rv-relrow-go" />
          </button>
        );
      })}
    </div>
  );
}

/** Where it goes: the planned deploy, replaced by HQ's answer after the press. */
export function ReviewWhere({
  rows,
  answer,
}: {
  readonly rows?: ReadonlyArray<{ readonly service: string; readonly line: string }> | undefined;
  readonly answer?: HqDeployAnswer | undefined;
}) {
  return <ZeropsDeployAnswer answer={answer} rows={rows} />;
}
