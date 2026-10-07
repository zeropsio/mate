/**
 * The review's own decisions that are about drawing it, not about the change:
 * its kind line, where it opens from, which key presses it, whose words say
 * what the change does, which of its description's pictures are read as the
 * person, and how much of a long diff, a long run of commits or a long
 * conversation stands before its fold. What the verdict says is
 * `reviewVerdict.ts`'s.
 *
 * Pure: no DOM, no clock.
 */
import {
  linksChange,
  type Moved,
  type ReviewPrimary,
  type ReviewVerdict,
} from "@t3tools/client-runtime/zerops";
import { parseAttachmentUrl, type ChangeLink } from "@t3tools/shared/hqChanges";
import { quoteWords } from "@t3tools/shared/messagePreview";

export type ReviewKind = "change" | "release" | "rollback" | "crew-task";

/**
 * Where a review stands: a dialog over the conversation, a quick look with its way to the page;
 * or the page itself, at its own address. The same sections in both, in the same words.
 */
export type ReviewFrame = "dialog" | "page";

/** The kind line over the title (500 13 muted), after its icon. */
export function reviewKindLine(kind: ReviewKind, pullKind?: "code" | "recipe"): string {
  switch (kind) {
    case "change":
      return pullKind === "recipe" ? "Review · recipe change" : "Review · change";
    case "release":
      return "Release";
    case "rollback":
      return "Roll back";
    case "crew-task":
      return "Crew task";
  }
}

/**
 * Where the review grows from: the point it was opened from, inside the review's own box —
 * the edge nearest the thing clicked when that is outside it, its centre when nothing was.
 * The review is laid out before it animates, so `popup` is its resting place.
 */
export function reviewOrigin(
  from: { readonly x: number; readonly y: number } | undefined,
  popup: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): { readonly x: number; readonly y: number } {
  if (from === undefined) return { x: popup.width / 2, y: popup.height / 2 };
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));
  return {
    x: clamp(from.x - popup.left, popup.width),
    y: clamp(from.y - popup.top, popup.height),
  };
}

/**
 * ⌘↵ (Ctrl+↵ off a Mac) presses the primary — only while it is safe to, and once: a key held
 * down repeats, and Merge would walk on into the release review it hands over to. Typed in a
 * field — the comment box — it is the field's, never the change's.
 */
export function pressesPrimary(
  event: {
    readonly key: string;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly repeat: boolean;
    /** Pressed while the focus is in a field somebody types into. */
    readonly inField: boolean;
  },
  primary: Pick<ReviewPrimary, "safe" | "enabled"> | undefined,
): boolean {
  return (
    !event.repeat &&
    !event.inField &&
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    primary !== undefined &&
    primary.safe &&
    primary.enabled
  );
}

/**
 * A key pressed in the review stays there: the conversation behind listens on the document — a
 * digit picks an answer, an arrow moves through them, a page key scrolls — and none of it is the
 * person's intent while the review has them. Escape alone goes on: it closes the review.
 */
export function keyStaysInReview(key: string): boolean {
  return key !== "Escape";
}

/**
 * What a change's review says it does, first: the description its author wrote; where it wrote
 * none, what the run that made it said of it; while that run's conversation is read, the room its
 * words will take; and where neither said anything, nothing at all — no heading over no words.
 */
export type ReviewDescription =
  | { readonly kind: "body"; readonly text: string }
  | { readonly kind: "run"; readonly words: string }
  | { readonly kind: "reading" }
  | { readonly kind: "none" };

export function reviewDescription(input: {
  readonly description: string | undefined;
  readonly run: { readonly words: string | undefined; readonly reading: boolean };
}): ReviewDescription {
  if (input.description !== undefined) return { kind: "body", text: input.description };
  if (input.run.words !== undefined) return { kind: "run", words: input.run.words };
  return input.run.reading ? { kind: "reading" } : { kind: "none" };
}

/**
 * Where one of a description's pictures is read from. A change's picture at the organization's
 * official HQ (`parseAttachmentUrl`) is read as the person and shown from its bytes: HQ answers
 * nobody without a session, and a page's own `<img>` carries none. A picture anywhere else — HQ's
 * other addresses among them — stays a plain link, never read with the person's session; one
 * inline or scripted is nothing.
 */
export type DescriptionPicture =
  | { readonly kind: "hq"; readonly url: string }
  | { readonly kind: "elsewhere"; readonly url: string }
  | { readonly kind: "none" };

/** The tallest a description's picture stands (`.rv-pic img`'s `max-height`). */
export const REVIEW_PICTURE_MAX_HEIGHT = 560;

/** The widest or tallest a picture a description sizes can be; anything past it is no size. */
const PICTURE_SIZE_MAX = 16384;

/**
 * The box a description's picture holds before its bytes arrive, from the width and height its
 * description gives it (zcp writes `<img alt width height src>`): its shape, and its width drawn
 * the way the picture itself is — the column's at most, its own at most, and no wider than keeps
 * it within {@link REVIEW_PICTURE_MAX_HEIGHT}. So the picture lands in the room it was given and
 * nothing moves. `null` where no whole size is given: the picture takes its room when it arrives.
 */
export function reviewPictureBox(
  width: string | number | undefined,
  height: string | number | undefined,
): { readonly aspectRatio: string; readonly width: string } | null {
  const w = pictureSize(width);
  const h = pictureSize(height);
  if (w === null || h === null) return null;
  const widest = Math.min(w, Math.floor((REVIEW_PICTURE_MAX_HEIGHT * w) / h));
  return { aspectRatio: `${String(w)} / ${String(h)}`, width: `min(100%, ${String(widest)}px)` };
}

function pictureSize(value: string | number | undefined): number | null {
  const size = typeof value === "number" ? value : value === undefined ? Number.NaN : Number(value);
  return Number.isInteger(size) && size > 0 && size <= PICTURE_SIZE_MAX ? size : null;
}

export function descriptionPicture(src: string, hqAddress: string | undefined): DescriptionPicture {
  let url: URL;
  try {
    // Written without its host, it is read against the HQ — and with no HQ known it is no
    // address at all.
    url = new URL(src, originOf(hqAddress) ?? undefined);
  } catch {
    return { kind: "none" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "none" };
  return hqAddress !== undefined && parseAttachmentUrl(url.href, hqAddress) !== null
    ? { kind: "hq", url: url.href }
    : { kind: "elsewhere", url: url.href };
}

function originOf(address: string | undefined): string | null {
  if (address === undefined) return null;
  try {
    return new URL(address).origin;
  } catch {
    return null;
  }
}

/** `](/…)` in Markdown, and `src="/…"` or `href="/…"` in its HTML: an address with no host. */
const HOSTLESS_ADDRESS = /(\]\(\s*<?|\b(?:src|href)\s*=\s*["']?)\/(?!\/)/gu;
/** A line that opens or closes a fenced block of code. */
const FENCE = /^\s{0,3}(?:```|~~~)/u;

/**
 * A description with every address written without its host pointing at the organization's
 * official HQ, so its pictures are read there and its links open the change they name. Code is
 * left as it was written.
 */
export function absoluteDescription(text: string, hqAddress: string | undefined): string {
  const hq = originOf(hqAddress);
  if (hq === null) return text;
  let inCode = false;
  return text
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        inCode = !inCode;
        return line;
      }
      return inCode ? line : line.replace(HOSTLESS_ADDRESS, `$1${hq}/`);
    })
    .join("\n");
}

/** How many of a change's commits stand before "Show all N". */
export const REVIEW_COMMITS_SHOWN = 5;

/**
 * How many commits stand (D4): all of a short run — folding one or two away saves nothing — and
 * the newest few of a long one, with "Show all N" (`rest`, the total) opening the rest in place.
 */
export function commitFold(input: { readonly total: number; readonly all: boolean }): {
  readonly shown: number;
  readonly rest: number | undefined;
} {
  const folds = !input.all && input.total > REVIEW_COMMITS_SHOWN + 2;
  return folds
    ? { shown: REVIEW_COMMITS_SHOWN, rest: input.total }
    : { shown: input.total, rest: undefined };
}

/** How many of a long conversation's newest comments the dialog shows. */
const DIALOG_REMARKS_SHOWN = 3;

/**
 * How many of a change's comments are folded away (D4): none on its page; in the dialog, a quick
 * look, a long conversation shows its newest three and "Show N earlier" opens the rest.
 */
export function remarkFold(input: {
  readonly frame: ReviewFrame;
  readonly total: number;
  readonly all: boolean;
}): { readonly hidden: number } {
  const folds = input.frame === "dialog" && !input.all && input.total > DIALOG_REMARKS_SHOWN + 1;
  return { hidden: folds ? input.total - DIALOG_REMARKS_SHOWN : 0 };
}

/** The newest of a Mate's answers that links the change at the official HQ: the run that made it. */
export function changeRunMessage<M extends { readonly role: string; readonly text: string }>(
  messages: ReadonlyArray<M>,
  change: ChangeLink,
  hqAddress: string,
): M | undefined {
  return messages.findLast(
    (message) => message.role === "assistant" && linksChange(message.text, change, hqAddress),
  );
}

/** How much of what the Mate said stands in the review: four lines of it, about. */
const RUN_WORDS_MAX = 400;

/**
 * A message's markdown read as plain sentences: no code blocks, marks, links, bullets or quote
 * markers. A GitHub callout keeps its word, run into its first line as the chat draws it
 * (`quoteWords`).
 */
function plainText(text: string): string {
  return quoteWords(text)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/(\*\*|__|`)/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * What a change does, in the words of the run that made it: the sentences of the Mate's
 * message that links it, every sentence with an address left out — the link's own among them —
 * up to about four lines. The rest is the run's, one click away.
 */
export function runWords(text: string): string | undefined {
  const sentences = plainText(text)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !/https?:\/\//u.test(sentence));
  const kept: Array<string> = [];
  let length = 0;
  for (const sentence of sentences) {
    const next = length + (kept.length === 0 ? 0 : 1) + sentence.length;
    if (next > RUN_WORDS_MAX && kept.length > 0) break;
    kept.push(sentence);
    length = next;
  }
  const words = kept.join(" ");
  return words.length === 0 ? undefined : words.slice(0, RUN_WORDS_MAX);
}

/** How many lines of one file's diff stand before "Show all N lines" opens the rest. */
export const REVIEW_DIFF_LINES_SHOWN = 400;
/** A file's diff longer than this is never drawn whole here. */
export const REVIEW_DIFF_LINES_MAX = 2_000;

/** What follows the lines a file's diff shows: the way to the rest, or that it is not here. */
export type DiffRest =
  | { readonly kind: "show"; readonly label: string }
  | { readonly kind: "cut"; readonly words: string };

/**
 * How much of one file's diff stands (D4): its first lines, all of them once opened — and where
 * it is too long to show here, or the read stopped inside it (`cut`), what is missing, said.
 */
export function diffFold(input: {
  readonly total: number;
  readonly all: boolean;
  readonly cut: boolean;
}): { readonly shown: number; readonly rest: DiffRest | undefined } {
  const { total, cut } = input;
  const tooMany = total > REVIEW_DIFF_LINES_MAX;
  const shown = input.all && !tooMany ? total : Math.min(total, REVIEW_DIFF_LINES_SHOWN);
  if (tooMany) {
    const more = `${String(total - shown)}${cut ? "+" : ""}`;
    return { shown, rest: { kind: "cut", words: `${more} more lines, too many to show here.` } };
  }
  if (shown < total) {
    return { shown, rest: { kind: "show", label: `Show all ${String(total)} lines` } };
  }
  return {
    shown,
    rest: cut ? { kind: "cut", words: "The rest is too long to read here." } : undefined,
  };
}

/** The status letter in a file row's 16 px box. */
export function changeFileLetter(status: string): "A" | "M" | "D" | "R" | "C" {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
    case "removed":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "M";
  }
}

/** `2400` → `2.4k`: a count a row has room for. */
function short(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands >= 10 ? String(Math.round(thousands)) : thousands.toFixed(1).replace(/\.0$/u, "")}k`;
}

/** `3 files`, `+42`, `−3` — or nothing while the size is unknown. */
export function sizeWords(size: {
  readonly files: number | undefined;
  readonly additions: number | undefined;
  readonly deletions: number | undefined;
}): { readonly files: string; readonly additions: string; readonly deletions: string } | undefined {
  if (size.files === undefined || size.additions === undefined || size.deletions === undefined) {
    return undefined;
  }
  return {
    files: `${String(size.files)} ${size.files === 1 ? "file" : "files"}`,
    additions: `+${short(size.additions)}`,
    deletions: `−${short(size.deletions)}`,
  };
}

/** Where a change a release carries stands on the stage that follows `main` (`stageMarks`). */
export type ReleaseStageMark = "on-stage" | "deploying-on-stage" | "failed-on-stage" | "none";

export interface ReleaseChangeRow {
  readonly key: string;
  /** `#54 Performance tuning…` — the change it landed as, or the commit's own words. */
  readonly title: string;
  /** The change it landed as, whose review the row opens; none for a commit nobody reviewed. */
  readonly change: { readonly repository: string; readonly number: number } | undefined;
  readonly mateProjectId: string | undefined;
  readonly mergedAt: string | undefined;
  readonly stage: ReleaseStageMark;
}

/** A squash commit's subject ends with the number of the change it landed: `Title (#54)`. */
const LANDED_AS = /\s*\(#(\d+)\)\s*$/u;

/**
 * What HQ compared, one row per change: a commit is the change HQ says it landed — in the
 * repository it was compared in, since numbers are per repository — whose Mate wrote it and when;
 * a commit nobody reviewed is its own words. One commit several services take is one row.
 */
export function releaseChangeRows(input: {
  readonly moved: ReadonlyArray<Moved>;
  readonly marks: ReadonlyMap<string, ReleaseStageMark>;
}): ReadonlyArray<ReleaseChangeRow> {
  const rows = new Map<string, ReleaseChangeRow>();
  for (const { repository, commits } of input.moved) {
    for (const commit of commits) {
      const key = commit.sha.toLowerCase();
      if (rows.has(key)) continue;
      const { change } = commit;
      rows.set(key, {
        key,
        title:
          change === null
            ? commit.subject
            : `#${String(change.number)} ${change.title.replace(LANDED_AS, "")}`,
        change: change === null ? undefined : { repository, number: change.number },
        mateProjectId: change?.mateProjectId,
        mergedAt: change === null ? undefined : commit.at,
        stage: input.marks.get(key) ?? "none",
      });
    }
  }
  return [...rows.values()];
}

/** A roll back's two lists: what production runs that it takes off, and what it brings back. */
export type RollbackSide = "leaving" | "coming-back";

/**
 * What a roll back's list says where it has no rows: HQ still comparing, why it could not, or —
 * an answer as well — that nothing moves that way.
 */
export function rollbackListNote(
  side: RollbackSide,
  list:
    | { readonly state: "reading" }
    | { readonly state: "failed"; readonly reason: string }
    | { readonly state: "known" },
): string {
  switch (list.state) {
    case "reading":
      return "Comparing in HQ…";
    case "failed":
      return `Can't tell what ${side === "leaving" ? "leaves production" : "comes back"}: ${list.reason.replace(/\.$/u, "")}.`;
    case "known":
      return side === "leaving" ? "Nothing leaves production." : "Nothing comes back.";
  }
}

/**
 * The command a crew task's Land sends. *Land now* takes only work its crewmate never reported or
 * that was sent back (the engine refuses it on anything else); *Land* takes the rest — a ready
 * task, a reported one it accepts first, one that waited on the person's edits.
 */
export function crewLandCommand(task: { readonly id: string; readonly state: string }): {
  readonly _tag: "land" | "landNow";
  readonly taskId: string;
} {
  return {
    _tag: task.state === "working" || task.state === "rework" ? "landNow" : "land",
    taskId: task.id,
  };
}

/**
 * What a change's review says before the change is read, when the project's flow does not hold
 * it: it spins only while a read of it is in flight. A read never sent says why — no account to
 * read it through, or the organization's HQ not known yet — never a spinner that does not end.
 */
export function changeReadVerdict(input: {
  readonly repository: string;
  readonly number: number;
  /** The read of the change on its own; `idle` until the organization's official HQ is known. */
  readonly read:
    | { readonly kind: "idle" | "reading" | "gone" }
    | { readonly kind: "refused" | "unavailable"; readonly reason: string };
  readonly failure?: string | undefined;
  readonly projectKnown?: boolean | undefined;
}): ReviewVerdict {
  const which = `${input.repository} #${String(input.number)}`;
  const verdict = (
    tone: ReviewVerdict["tone"],
    title: string,
    why: string = which,
  ): ReviewVerdict => ({ state: "checking", tone, title, why, fix: undefined });
  const { read } = input;
  if (read.kind === "reading") return verdict("busy", "Reading this change");
  if (read.kind === "gone") {
    return verdict("attention", `${input.repository} has no change #${String(input.number)}`);
  }
  if (read.kind === "refused" || read.kind === "unavailable")
    return verdict("attention", "This change could not be read", read.reason);
  if (input.failure !== undefined)
    return verdict("attention", "This change could not be read", input.failure);
  if (input.projectKnown === false)
    return verdict("attention", "This change's project isn't known here");
  return verdict("quiet", "Waiting for the organization's HQ");
}

/** A field somebody types into: its keys are its own, ⌘↵ included. */
export function isField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  );
}
