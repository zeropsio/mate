/**
 * The review, drawn: every read already done and handed in, so a harness and a test can show
 * every state of it without a forge or a crew behind it. The dialog around it is
 * `ZeropsReviewDialog`'s; the reads and the verbs are the per-kind reviews'.
 *
 * One reading order, top to bottom (R2–R5): what kind of thing this is and its title with one
 * line of provenance, the verdict, what it does in the Mate's words, what it changes, how it was
 * checked, where to try it — and a foot that says what the one button does, beside it.
 */
import type {
  ChangeDiffFile,
  GitCheckRow,
  ReviewTone,
  ReviewVerdict,
  ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { changeFileParts } from "@t3tools/client-runtime/zerops";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  GitPullRequestArrowIcon,
  GlobeIcon,
  RotateCcwIcon,
  TagIcon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode, type Ref } from "react";

import { Spinner } from "~/components/ui/spinner";
import { isMacPlatform } from "~/lib/utils";

import { MateFace } from "../primitives";
import {
  changeFileLetter,
  diffFold,
  type ReleaseChangeRow,
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
  readonly state?: MateMarkState;
}

export interface ReviewButton {
  readonly label: string;
  readonly onPress: () => void;
}

export interface ReviewPrimaryButton extends ReviewButton {
  readonly enabled: boolean;
  readonly safe: boolean;
  /** Pressed and running: the label says so, and it takes no second press. */
  readonly busy?: boolean;
  readonly icon?: "tag" | "rollback" | undefined;
}

export interface ZeropsReviewSurfaceProps {
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
  /** "Ask Nova for changes" — with the Mate's face. */
  readonly secondary?: (ReviewButton & { readonly face?: ReviewFaceProps | undefined }) | undefined;
  /** "Cancel" before anything was pressed, "Close" after. */
  readonly dismiss?: string | undefined;
  readonly primary?: ReviewPrimaryButton | undefined;
  readonly primaryRef?: Ref<HTMLButtonElement> | undefined;
  readonly onClose: () => void;
}

export function ZeropsReviewSurface({
  kind,
  kindLabel,
  title,
  titleId,
  meta,
  verdict,
  fix,
  children,
  consequence,
  secondary,
  dismiss,
  primary,
  primaryRef,
  onClose,
}: ZeropsReviewSurfaceProps) {
  return (
    <>
      <header className="rv-head">
        <span className="rv-kind">
          {KIND_ICON[kind]}
          {kindLabel}
        </span>
        <button aria-label="Close" className="rv-x" onClick={onClose} type="button">
          <XIcon aria-hidden="true" size={16} />
        </button>
        <h2 className="rv-title" id={titleId}>
          {title}
        </h2>
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
          <button className="rv-btn2" onClick={secondary.onPress} type="button">
            {secondary.face === undefined ? null : (
              <MateFace
                className="size-4"
                size="dot"
                state={secondary.face.state ?? "idle"}
                tint={secondary.face.tint}
              />
            )}
            {secondary.label}
          </button>
        )}
        {dismiss === undefined ? null : (
          <button className="rv-btn2" onClick={onClose} type="button">
            {dismiss}
          </button>
        )}
        {primary === undefined ? null : (
          <button
            className="rv-btn1"
            data-review-primary=""
            data-safe={primary.safe && primary.enabled && primary.busy !== true ? "true" : "false"}
            data-zerops-primary-action={primary.label}
            disabled={!primary.enabled || primary.busy === true}
            onClick={primary.onPress}
            ref={primaryRef}
            type="button"
          >
            {primary.icon === "tag" ? <TagIcon aria-hidden="true" /> : null}
            {primary.icon === "rollback" ? <RotateCcwIcon aria-hidden="true" /> : null}
            {primary.busy === true ? `${primary.label}…` : primary.label}
            {primary.safe && primary.busy !== true ? (
              <kbd aria-hidden="true">{PRESS_KEYS}</kbd>
            ) : null}
          </button>
        )}
      </footer>
    </>
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

/** What it does, in the Mate's words, and the way back to the run that said them (R3). */
export function ReviewWords({
  words,
  reading,
  onOpenRun,
}: {
  readonly words: string | undefined;
  readonly reading: boolean;
  readonly onOpenRun: (() => void) | undefined;
}) {
  if (words === undefined && !reading) return null;
  return (
    <ReviewSection title="What it does">
      {words === undefined ? (
        <ReviewSkeleton lines={2} />
      ) : (
        <p className="rv-words">
          {words}
          {onOpenRun === undefined ? null : (
            <>
              {" "}
              <button className="rv-link" onClick={onOpenRun} type="button">
                The run that made it
              </button>
            </>
          )}
        </p>
      )}
    </ReviewSection>
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
 * opens its diff in place (R4), and the diff is asked for only then (`onOpen`). `pending` rows
 * hold the list's height while it is read.
 */
export function ReviewFiles({
  files,
  pending,
  diffOf,
  giteaOf,
  onOpen,
  initiallyOpen,
}: {
  readonly files: ReadonlyArray<ReviewFileRow> | undefined;
  readonly pending: number;
  readonly diffOf: (path: string) => ReviewDiffState;
  /** Where the file's diff is on Gitea, for what is too long to show here. */
  readonly giteaOf?: ((path: string) => string | undefined) | undefined;
  readonly onOpen?: ((path: string) => void) | undefined;
  readonly initiallyOpen?: ReadonlyArray<string> | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen ?? []));
  if (files === undefined) {
    return (
      <div aria-busy="true" className="rv-files">
        {Array.from({ length: Math.max(1, pending) }, (_, index) => (
          <div className="rv-file-skeleton" key={index}>
            <span />
          </div>
        ))}
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
            gitea={expanded ? giteaOf?.(file.path) : undefined}
            key={file.path}
            letter={letter}
            name={name}
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
  gitea,
  onToggle,
}: {
  readonly file: ReviewFileRow;
  readonly dir: string;
  readonly name: string;
  readonly letter: string;
  readonly expanded: boolean;
  readonly diff: ReviewDiffState | undefined;
  readonly gitea: string | undefined;
  readonly onToggle: () => void;
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
        <ReviewDiff diff={diff} gitea={gitea} previousPath={file.previousPath} />
      )}
    </>
  );
}

/** What is missing from a file's diff here, said, with the way to it on Gitea. */
function DiffElsewhere({
  words,
  gitea,
}: {
  readonly words: string;
  readonly gitea: string | undefined;
}) {
  return (
    <p className="rv-diff-note">
      {words}
      {gitea === undefined ? null : (
        <>
          {" "}
          <a className="rv-link" href={gitea} rel="noopener noreferrer" target="_blank">
            Open it on Gitea
          </a>
        </>
      )}
    </p>
  );
}

/**
 * One file's diff: hunk headers, numbers, + green and − red; it scrolls sideways alone. What is
 * too long to show here says so, and links the file's diff on Gitea (`gitea`).
 */
export function ReviewDiff({
  diff,
  gitea,
  previousPath,
}: {
  readonly diff: ReviewDiffState;
  readonly gitea?: string | undefined;
  readonly previousPath?: string | undefined;
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
        <p className="rv-diff-note">{diff.reason}</p>
      </div>
    );
  }
  const file = diff.file;
  if (file === undefined && diff.cut) {
    return (
      <div className="rv-diff">
        <DiffElsewhere gitea={gitea} words="Too long to read here." />
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
      {rest?.kind === "gitea" ? <DiffElsewhere gitea={gitea} words={rest.words} /> : null}
    </div>
  );
}

const CHECK_ICON: Record<GitCheckRow["tone"], ReactNode> = {
  ok: <CircleCheckIcon aria-hidden="true" />,
  failed: <CircleXIcon aria-hidden="true" />,
  busy: <Spinner size="md" tone="muted" />,
  attention: <CircleIcon aria-hidden="true" />,
  off: <CircleIcon aria-hidden="true" />,
};

/** The checks by name, with what each said, and a way to its own page where it keeps one. */
export function ReviewChecks({ rows }: { readonly rows: ReadonlyArray<GitCheckRow> }) {
  return (
    <div className="rv-checks">
      {rows.map((row) => (
        <div className="rv-check" data-tone={row.tone} key={row.name}>
          <span className="rv-ci">{CHECK_ICON[row.tone]}</span>
          <span className="min-w-0">
            <span className="sr-only">{row.word}: </span>
            {row.name}
            {row.description === undefined ? null : (
              <span className="rv-check-d"> {row.description}</span>
            )}
          </span>
          {row.url === undefined ? (
            <span />
          ) : (
            <a
              className="rv-link rv-check-d"
              href={row.url}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/** Try it: where the change runs, one click away. */
export function ReviewTry({ route }: { readonly route: ZeropsPublicRoute }) {
  return (
    <div className="rv-try">
      <GlobeIcon aria-hidden="true" />
      <a className="rv-link" href={route.url} rel="noopener noreferrer" target="_blank">
        {route.host}
        <ArrowUpRightIcon aria-hidden="true" />
      </a>
    </div>
  );
}

const STAGE_WORDS: Record<ReleaseChangeRow["stage"], string | undefined> = {
  "on-stage": "on stage",
  "deploying-on-stage": "deploying on stage",
  "failed-on-stage": "failed on stage",
  none: undefined,
};

/** What goes out: one row per change, its Mate's face, and whether stage ran it. */
export function ReviewReleaseRows({
  rows,
}: {
  readonly rows: ReadonlyArray<
    ReleaseChangeRow & { readonly face?: ReviewFaceProps; readonly sub: string }
  >;
}) {
  return (
    <div className="rv-rel">
      {rows.map((row) => {
        const mark = STAGE_WORDS[row.stage];
        return (
          <div className="rv-relrow" key={row.key}>
            {row.face === undefined ? (
              <span />
            ) : (
              <MateFace size="sm" state={row.face.state ?? "idle"} tint={row.face.tint} />
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
          </div>
        );
      })}
    </div>
  );
}

/** Where it goes: each service and the commit it redeploys from. */
export function ReviewWhere({
  rows,
}: {
  readonly rows: ReadonlyArray<{ readonly service: string; readonly line: string }>;
}) {
  return (
    <div className="rv-where">
      {rows.map((row) => (
        <WhereRow key={row.service} line={row.line} service={row.service} />
      ))}
    </div>
  );
}

function WhereRow({ service, line }: { readonly service: string; readonly line: string }) {
  return (
    <>
      <b>{service}</b>
      <span>{line}</span>
    </>
  );
}
