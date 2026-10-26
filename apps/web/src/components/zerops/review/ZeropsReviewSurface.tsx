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
 * One reading order, top to bottom: its title; one line of where it stands in plain words —
 * "#12 · Ready to merge · ✓ checks passed" — and, where that is not all, why; what it does,
 * how to try it, what it changes; what was said and its commits, folded. The buttons stand at the
 * foot, the one button first, and under them one line of what happens next.
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
  ChevronRightIcon,
  GlobeIcon,
  Maximize2Icon,
  RotateCcwIcon,
  TagIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { isMacPlatform } from "~/lib/utils";

import {
  GitBrowserLink,
  gitCommitLink,
  useGitLinkProps,
  type GitLink,
} from "../gitBrowser/GitBrowserLink";
import { MateFace } from "../primitives";
import { ZeropsDeployAnswer, type DeployWhereRow } from "../ZeropsDeployAnswer";
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
  readonly icon?: "tag" | "rollback" | "globe" | undefined;
  /** The words it shows where they say more than its label: "Merge to stage". */
  readonly text?: string | undefined;
}

export interface ZeropsReviewSurfaceProps {
  /** A sheet over the page (the default), or a page of its own. */
  readonly frame?: ReviewFrame | undefined;
  readonly kind: ReviewKind;
  /** The top line, beside ×: whose it is and where — "Sage · Tea Shop", or the project's name. */
  readonly kindLabel: string;
  /** The face beside the top line: the Mate whose change it is. */
  readonly face?: ReviewFaceProps | undefined;
  readonly title: string;
  readonly titleId?: string | undefined;
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
  /** "Ask Nova to resolve it": the fix, where there is a Mate of the person's to ask. */
  readonly fix?: ReviewButton | undefined;
  /** The sections, in reading order. */
  readonly children?: ReactNode;
  /** What happens next, under the buttons; empty when nothing more follows. */
  readonly consequence: string;
  /** "Cancel" before anything was pressed, "Close" after. */
  readonly dismiss?: string | undefined;
  /** "Ask Sage to change it…": the soft button beside the one button. */
  readonly ask?: ReviewButton | undefined;
  /** A quiet word beside the button: a change's "Close without merging…", then "Keep it open". */
  readonly secondary?: (ReviewButton & { readonly enabled: boolean }) | undefined;
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
  /** The sheet's way to the same review as a page, where it has one. */
  readonly onOpenPage?: (() => void) | undefined;
  readonly onClose: () => void;
}

export function ZeropsReviewSurface({
  frame = "dialog",
  kind,
  kindLabel,
  face,
  title,
  titleId,
  meta,
  elsewhere,
  code,
  status,
  verdict,
  verdictInLine = true,
  whySaid = true,
  fix,
  children,
  consequence,
  dismiss,
  ask,
  secondary,
  primary,
  answers,
  settled,
  back,
  onOpenPage,
  onClose,
}: ZeropsReviewSurfaceProps) {
  const Title = frame === "page" ? "h1" : "h2";
  const line: Array<{ readonly key: string; readonly node: ReactNode }> = [];
  if (meta !== undefined && meta !== null) line.push({ key: "meta", node: meta });
  if (elsewhere !== undefined && elsewhere !== null)
    line.push({ key: "elsewhere", node: elsewhere });
  if (code !== undefined && code !== null) line.push({ key: "code", node: code });
  if (verdictInLine) {
    line.push({
      key: "verdict",
      node: (
        <span className="rv-vt">
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
        <div className="rv-chrome">
          {back === undefined ? (
            <span className="rv-kind">
              {face === undefined ? null : (
                <MateFace
                  className="size-5.5"
                  shape={face.shape}
                  size={20}
                  state={face.state ?? "idle"}
                  tint={face.tint}
                />
              )}
              <span className="rv-kind-words">{kindLabel}</span>
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
            <button aria-label="Open as page" className="rv-x" onClick={onOpenPage} type="button">
              <Maximize2Icon aria-hidden="true" size={14} />
            </button>
          )}
          <button aria-label="Close" className="rv-x" onClick={onClose} type="button">
            <XIcon aria-hidden="true" size={16} />
          </button>
        </div>
      )}
      <header className="rv-head" data-review-kind={kind}>
        <Title className="rv-title" id={titleId} title={title}>
          {title}
        </Title>
        <p
          aria-live="polite"
          className="rv-line"
          data-review-state={verdict.state}
          data-tone={verdict.tone}
        >
          {line.map((part, index) => (
            <Fragment key={part.key}>
              {index === 0 ? null : (
                <span aria-hidden="true" className="rv-dot">
                  ·
                </span>
              )}
              {part.node}
            </Fragment>
          ))}
        </p>
        {whySaid || fix !== undefined ? (
          <div className="rv-why" data-tone={verdict.tone}>
            {whySaid ? <span>{verdict.why}</span> : null}
            {fix === undefined ? null : (
              <Button onClick={fix.onPress} size="sm" variant="link">
                {fix.label}
              </Button>
            )}
          </div>
        ) : null}
      </header>
      <div className="rv-body">{children}</div>
      {/* Nothing left to press or say (a merged change on its page): no empty bar. */}
      {answers === undefined &&
      primary === undefined &&
      settled === undefined &&
      ask === undefined &&
      secondary === undefined &&
      (dismiss === undefined || frame === "page") &&
      consequence === "" ? null : (
        <footer className="rv-foot">
          <div className="rv-btns">
            {answers !== undefined ? (
              answers
            ) : (
              <>
                {(dismiss === undefined || frame === "page") && secondary === undefined ? null : (
                  <div className="rv-btns-quiet">
                    {dismiss === undefined || frame === "page" ? null : (
                      <Button onClick={onClose} variant="ghost">
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
                  </div>
                )}
                {ask === undefined && settled === undefined && primary === undefined ? null : (
                  <div className="rv-btns-main">
                    {ask === undefined ? null : (
                      <Button data-review-ask="" onClick={ask.onPress} variant="secondary">
                        {ask.label}
                      </Button>
                    )}
                    {settled === undefined ? null : (
                      <span className="rv-settled">
                        <CheckIcon aria-hidden="true" />
                        {settled}
                      </span>
                    )}
                    {primary === undefined ? null : (
                      <Button
                        data-review-primary=""
                        data-safe={
                          primary.safe && primary.enabled && primary.busy !== true
                            ? "true"
                            : "false"
                        }
                        data-zerops-primary-action={primary.label}
                        disabled={!primary.enabled || primary.busy === true}
                        onClick={primary.onPress}
                      >
                        {primary.icon === "tag" ? <TagIcon aria-hidden="true" /> : null}
                        {primary.icon === "rollback" ? <RotateCcwIcon aria-hidden="true" /> : null}
                        {primary.icon === "globe" ? <GlobeIcon aria-hidden="true" /> : null}
                        {primary.busy === true
                          ? `${primary.label}…`
                          : (primary.text ?? primary.label)}
                        {(primary.safe || primary.shortcut === true) && primary.busy !== true ? (
                          <kbd aria-hidden="true" className="rv-keys">
                            {PRESS_KEYS}
                          </kbd>
                        ) : null}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {consequence === "" ? null : <p className="rv-conseq">{consequence}</p>}
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
    <div className="rv-page" data-zerops-surface="review" onKeyDown={pressFromKeys}>
      {content}
    </div>
  );
}

/** A section folded to its one row: open or not, and the press that turns it. */
export interface ReviewFoldState {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/**
 * One section: its small label, what it counts on the right, and what it holds. Folded, its
 * label is a row that opens it — "Files 4 changed · +163 −12 ⌄" — and what it holds stays drawn,
 * hidden, so nothing it read or was typed into it is lost while it is shut.
 */
export function ReviewSection({
  title,
  aside,
  fold,
  titleShown = true,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly fold?: ReviewFoldState | undefined;
  /** Whether its label is seen; one what it holds already says is kept for screen readers only. */
  readonly titleShown?: boolean | undefined;
  readonly children: ReactNode;
}) {
  if (fold !== undefined) {
    return (
      <section>
        <h3 className="rv-sec-h">
          <button
            aria-expanded={fold.open}
            className="rv-fold-row"
            onClick={fold.onToggle}
            type="button"
          >
            <span>{title}</span>
            {aside === undefined ? null : <span className="rv-fold-aside">{aside}</span>}
            <ChevronDownIcon aria-hidden="true" className="rv-fold-chev" />
          </button>
        </h3>
        <div className="rv-fold-body" hidden={!fold.open}>
          {children}
        </div>
      </section>
    );
  }
  return (
    <section>
      {titleShown || aside !== undefined ? (
        <h3 className={titleShown ? "rv-sec-h" : "rv-sec-h justify-end"}>
          {titleShown ? title : <span className="sr-only">{title}</span>}
          {aside === undefined ? null : <span>{aside}</span>}
        </h3>
      ) : (
        <h3 className="sr-only">{title}</h3>
      )}
      {children}
    </section>
  );
}

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

/** "Try it": the Mate's previews, each by its service and its address, opened in a tab. */
export function ReviewTry({
  previews,
}: {
  readonly previews: ReadonlyArray<{
    readonly service: string;
    readonly url: string;
    readonly host: string;
  }>;
}) {
  return (
    <ReviewSection title="Try it">
      <div className="rv-tries">
        {previews.map((preview) => (
          <a
            className="rv-try"
            href={preview.url}
            key={preview.service}
            rel="noreferrer"
            target="_blank"
          >
            <GlobeIcon aria-hidden="true" />
            <span className="rv-try-service">{preview.service}</span>
            <span className="rv-try-host">{preview.host}</span>
            <ArrowUpRightIcon aria-hidden="true" />
          </a>
        ))}
      </div>
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
    <div className="rv-failed" role="status">
      <TriangleAlertIcon aria-hidden="true" />
      <span className="min-w-0">
        {what} <span className="rv-failed-why">{reason}</span>
      </span>
      {onRetry === undefined ? null : (
        <Button onClick={onRetry} size="sm" variant="link">
          Try again
        </Button>
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
      <div className="rv-files">
        <ReviewFailed onRetry={onRetry} reason={failed} what="The files couldn't be read." />
      </div>
    );
  }
  if (notRecorded !== undefined) {
    return (
      <div className="rv-files">
        <p className="rv-diff-note">The files are not known yet.</p>
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
        <ReviewDiff diff={diff} onRetry={onRetry} open={open} previousPath={file.previousPath} />
      )}
    </>
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
      <p className="rv-diff-note">
        <GitBrowserLink to={open}>Open file</GitBrowserLink>
      </p>
    );
  if (diff.kind === "reading") {
    return (
      <div className="rv-diff">
        <p className="rv-diff-note">Reading the diff…</p>
        {opener}
      </div>
    );
  }
  if (diff.kind === "failed") {
    return (
      <div className="rv-diff">
        <ReviewFailed onRetry={onRetry} reason={diff.reason} what="The diff couldn't be read." />
        {opener}
      </div>
    );
  }
  const file = diff.file;
  if (file === undefined && diff.cut) {
    return (
      <div className="rv-diff">
        <p className="rv-diff-note">Too long to read here.</p>
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
      <div className="rv-diff">
        <p className="rv-diff-note">{note}</p>
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
      {rest?.kind === "cut" ? <p className="rv-diff-note">{rest.words}</p> : null}
      {opener}
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
    <div className="rv-rel" data-opens={onOpen === undefined ? undefined : ""}>
      {rows.map((row) => {
        // Every change on the stage is the line's to say; a row says only what stands out.
        const mark = row.stage === "on-stage" ? undefined : STAGE_WORDS[row.stage];
        const cells = (
          <>
            {row.face === undefined ? (
              <span />
            ) : (
              <MateFace
                className="size-5.5"
                shape={row.face.shape}
                size={20}
                state={row.face.state ?? "idle"}
                tint={row.face.tint}
              />
            )}
            <span className="rv-relrow-t">{row.title}</span>
            {mark === undefined ? (
              <span className="rv-relrow-sub">{row.sub}</span>
            ) : (
              <span className="rv-on" data-mark={row.stage}>
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
          return appId === undefined || row.commit === undefined ? (
            <div className="rv-relrow" key={row.key}>
              {cells}
            </div>
          ) : (
            <ReleaseCommitRow
              key={row.key}
              rowKey={row.key}
              to={gitCommitLink({ appId, repo: row.commit.repository }, row.commit.sha)}
            >
              {cells}
            </ReleaseCommitRow>
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

/** A commit nobody reviewed, the whole row a link to its page in the Git browser. */
function ReleaseCommitRow({
  rowKey,
  to,
  children,
}: {
  readonly rowKey: string;
  readonly to: GitLink;
  readonly children: ReactNode;
}) {
  return (
    <a className="rv-relrow" data-release-row={rowKey} {...useGitLinkProps(to)}>
      {children}
      <ChevronRightIcon aria-hidden="true" className="rv-relrow-go" />
    </a>
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
