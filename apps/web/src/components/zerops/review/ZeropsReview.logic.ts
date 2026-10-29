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
  deployedVersion,
  type GroupFlowAddress,
  type GroupFlowPreview,
  linksChange,
  type Moved,
  type ProductionRun,
  RELEASE_TAKES,
  type ReleaseReviewModel,
  type ReviewPrimary,
  type ReviewState,
  type ReviewVerdict,
  type ReleaseReplaces,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import { crewPossessive } from "@t3tools/client-runtime/zerops/crew/phrases";
import { mateParts } from "@t3tools/client-runtime/zerops/mateParts";
import { parseAttachmentUrl, type ChangeLink, type ChangeReceipt } from "@t3tools/shared/hqChanges";
import { environmentTitle } from "../place/place.logic";
import { siteOf, soleSite } from "../projects/projectCard.logic";

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
      return pullKind === "recipe" ? "Review · setup change" : "Review · change";
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
 * What a change's review says it does, first: the description its Mate wrote of it; while the
 * change's record is read, the room its words will take; and where it wrote none, nothing at all —
 * no heading over no words. A run's reply is never borrowed: it may be about other changes.
 */
export type ReviewDescription =
  | { readonly kind: "body"; readonly text: string }
  | { readonly kind: "reading" }
  | { readonly kind: "none" };

export function reviewDescription(input: {
  readonly description: string | undefined;
  /** The change's record, which may hold its description, is still read. */
  readonly reading: boolean;
}): ReviewDescription {
  if (input.description !== undefined) return { kind: "body", text: input.description };
  return input.reading ? { kind: "reading" } : { kind: "none" };
}

/**
 * Whether a description heads one of its own parts with the section's label — "## What it does"
 * under the label "What it does": the label then says nothing the description does not, and goes.
 * A heading counts at any level, in any case, with a colon after it; one inside code does not.
 */
export function descriptionHeads(text: string, label: string): boolean {
  const wanted = label.trim().toLocaleLowerCase();
  let fenced = false;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/u.exec(line);
    if (heading?.[1]?.replace(/:$/u, "").trim().toLocaleLowerCase() === wanted) return true;
  }
  return false;
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
 * it is too long to show here, what is missing, said.
 */
export function diffFold(input: { readonly total: number; readonly all: boolean }): {
  readonly shown: number;
  readonly rest: DiffRest | undefined;
} {
  const { total } = input;
  const tooMany = total > REVIEW_DIFF_LINES_MAX;
  const shown = input.all && !tooMany ? total : Math.min(total, REVIEW_DIFF_LINES_SHOWN);
  if (tooMany) {
    return {
      shown,
      rest: { kind: "cut", words: `${String(total - shown)} more lines, too many to show here.` },
    };
  }
  if (shown < total) {
    return { shown, rest: { kind: "show", label: `Show all ${String(total)} lines` } };
  }
  return { shown, rest: undefined };
}

/**
 * Where a change's code opens in the Git browser: an open change's files at its head; a merged
 * one's commit on `main`, the page that says what it added there, its files read at that commit.
 * None where HQ named neither.
 */
export function changeCode(pull: {
  readonly merged: boolean;
  readonly headSha?: string | undefined;
  readonly mergeCommitSha?: string | undefined;
}): { readonly sha: string; readonly view: "code" | "commit"; readonly words: string } | undefined {
  if (pull.merged && pull.mergeCommitSha !== undefined)
    return { sha: pull.mergeCommitSha, view: "commit", words: "Commit on main" };
  if (pull.headSha === undefined) return undefined;
  return { sha: pull.headSha, view: "code", words: "Browse files" };
}

/**
 * The branch a change's review names beside its number: the one its Mate named, so a Mate's
 * several changes in one repository read apart. None for HQ's own `mate/…` branch of a change that
 * named none, whose number already says which it is, nor where HQ named none.
 */
export function reviewBranch(pull: { readonly branch?: string | undefined }): string | undefined {
  const branch = pull.branch;
  return branch === undefined || branch === "" || branch.startsWith("mate/") ? undefined : branch;
}

/**
 * Its Mate's other open changes in the change's repository, by number: the review links each, so
 * the person steps between a Mate's parallel work there. Never another Mate's.
 */
export function otherOpenChanges<
  T extends {
    readonly repository: string;
    readonly number: number;
    readonly mateProjectId: string;
    readonly merged: boolean;
  },
>(
  pull: Pick<T, "repository" | "number" | "mateProjectId">,
  pullRequests: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return pullRequests
    .filter(
      (other) =>
        other.repository === pull.repository &&
        other.mateProjectId === pull.mateProjectId &&
        other.number !== pull.number &&
        !other.merged,
    )
    .toSorted((left, right) => left.number - right.number);
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
/** A folded row's count where HQ has not recorded what it counts: never a 0 that reads as none. */
export const NOT_RECORDED_ASIDE = "Not known yet";

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
  /** The change's title, or the commit's own words: never HQ's number for the change. */
  readonly title: string;
  /** The change it landed as, whose review the row opens; none for a commit nobody reviewed. */
  readonly change: { readonly repository: string; readonly number: number } | undefined;
  /** A commit nobody reviewed: its own page in the Git browser is what the row opens. */
  readonly commit?: { readonly repository: string; readonly sha: string } | undefined;
  readonly mateProjectId: string | undefined;
  readonly mergedAt: string | undefined;
  readonly stage: ReleaseStageMark;
}

/** A squash commit's subject ends with the number of the change it landed: `Title (#54)`. */
const LANDED_AS = /\s*\(#(\d+)\)\s*$/u;

/**
 * What HQ compared, one row per change: a commit is the change HQ says it is — in the repository
 * it was compared in, since numbers are per repository — whose Mate wrote it and when, as its
 * newest commit says; a merge on GitHub and the commits it brought in are all that change, one row.
 * A commit nobody reviewed is its own words. One commit several services take is one row.
 */
export function releaseChangeRows(input: {
  readonly moved: ReadonlyArray<Moved>;
  readonly marks: ReadonlyMap<string, ReleaseStageMark>;
}): ReadonlyArray<ReleaseChangeRow> {
  const rows = new Map<string, ReleaseChangeRow>();
  const seen = new Set<string>();
  for (const { repository, commits } of input.moved) {
    for (const commit of commits) {
      const key = commit.sha.toLowerCase();
      const { change } = commit;
      const entry = change === null ? key : `${repository}#${String(change.number)}`;
      if (seen.has(key) || rows.has(entry)) continue;
      seen.add(key);
      rows.set(entry, {
        key,
        title: change === null ? commit.subject : change.title.replace(LANDED_AS, ""),
        change: change === null ? undefined : { repository, number: change.number },
        ...(change === null ? { commit: { repository, sha: commit.sha } } : {}),
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
 * What a roll back's list says where it has no rows: HQ still comparing, why it could not, a
 * release HQ recorded no membership for, or — an answer as well — that nothing moves that way.
 */
export function rollbackListNote(
  side: RollbackSide,
  list:
    | { readonly state: "reading" }
    | { readonly state: "unrecorded" }
    | { readonly state: "failed"; readonly reason: string }
    | { readonly state: "known" },
): string {
  switch (list.state) {
    case "reading":
      return "Comparing in HQ…";
    case "unrecorded":
      return "Not known yet.";
    case "failed":
      return `Can't tell what ${side === "leaving" ? "leaves production" : "comes back"}: ${list.reason.replace(/\.$/u, "")}.`;
    case "known":
      return side === "leaving" ? "Nothing leaves production." : "Nothing comes back.";
  }
}

/** The commits a release carries that no change landed: counted from HQ's offer, listed on ask. */
export function outsideCommitsWords(count: number, atLeast: boolean): string {
  return `${String(count)}${atLeast ? "+" : ""} ${count === 1 && !atLeast ? "commit" : "commits"} outside changes`;
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

// ---------------------------------------------------------------------------
// The sheet: the line under the title and the footnote under the buttons
// ---------------------------------------------------------------------------

/** States where a change still waits on its press: its checks are the line's last word. */
const CHECKS_SAID: ReadonlySet<ReviewState> = new Set(["ready", "behind-clean"]);

/**
 * `✓ checks passed`, `checks running` or `checks failed` at the end of a change's line — only
 * while it waits on its press, and only from checks read for its head.
 */
export function changeChecks(input: {
  readonly state: ReviewState;
  readonly checks: ReadonlyArray<{ readonly state: string }>;
}): { readonly words: string; readonly mark: "passed" | "running" | "failed" } | undefined {
  if (!CHECKS_SAID.has(input.state) || input.checks.length === 0) return undefined;
  if (input.checks.some((check) => check.state === "failed")) {
    return { words: "checks failed", mark: "failed" };
  }
  if (input.checks.some((check) => check.state === "running")) {
    return { words: "checks running", mark: "running" };
  }
  if (input.checks.every((check) => check.state === "passed")) {
    return { words: "checks passed", mark: "passed" };
  }
  return undefined;
}

/**
 * Whether the verdict's why is said under the line: not for a change ready to merge nor a
 * release ready to go, whose line already says all of it.
 */
export function whySaid(verdict: ReviewVerdict, draft: boolean): boolean {
  if (verdict.state === "release-ready") return false;
  return verdict.state !== "ready" || draft;
}

/** "a", "a and b", "a, b and c". */
const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** An environment's name as a sentence names it: "Stage", a shared place, capitalised. */
const placeName = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/**
 * What merging does, said under the buttons: a merge lands on `main`, each stage that deploys
 * merges from it deploys it (`stageDeploysMerges`) — no other is promised one — and production
 * keeps its release — after the receipt's warning, while the change waits on its press. Where no
 * stage deploys it, and for a setup change, which deploys nothing, the review's own words say what
 * merging does: they also say where merging is not offered, or its files were never shown.
 */
export function mergeFoot(input: {
  readonly state: ReviewState;
  readonly consequence: string;
  /** The stages that deploy what merges into `main`, by name; none, one or several. */
  readonly stages: ReadonlyArray<string>;
  /** The release production runs. */
  readonly live: string | undefined;
  /** {@link changeReceipt}'s warning: parts not tried at the change. */
  readonly warning?: string | undefined;
  /** A recipe change: what its merge does is the review's to say. */
  readonly recipe?: boolean | undefined;
}): string {
  if (!CHECKS_SAID.has(input.state) || input.recipe === true) return input.consequence;
  const keeps =
    input.live === undefined ? "" : ` Production keeps ${input.live} until you release.`;
  // Each by its title, as its row reads it: "demo-app-stage" is Stage.
  const stages = input.stages.map((name) => environmentTitle("stage", name));
  const foot =
    stages.length === 0
      ? input.consequence
      : `Lands on main; ${listed(stages)} ${stages.length === 1 ? "deploys" : "deploy"} it.${keeps}`;
  return input.warning === undefined ? foot : `${input.warning} ${foot}`;
}

/**
 * Whether a stage deploys what merges into `main`, so the merge foot may say so: it follows
 * `main`, and it has deployed from it — it runs a commit, or HQ took a deploy of it live. A stage
 * that follows `main` and never deployed (Larkspur's, 2026-10-28: its stage tier waited in a
 * setup change) is promised nothing.
 */
export function stageDeploysMerges(row: {
  readonly tier: string;
  readonly source: string;
  readonly commit: string | undefined;
  readonly deploys: ReadonlyArray<{ readonly kind: string; readonly state: string }>;
}): boolean {
  if (row.tier !== "stage" || row.source !== "main") return false;
  return (
    row.commit !== undefined ||
    row.deploys.some((job) => job.kind === "deploy" && job.state === "live")
  );
}

/**
 * What a "Try it" pill says: whose preview it opens, then which part, by its service's real
 * hostname — "Wren's preview · shopstage".
 */
export function tryItWords(
  mateName: string,
  part: string,
): { readonly preview: string; readonly part: string } {
  return { preview: `${placeName(crewPossessive(mateName))} preview`, part };
}

/**
 * "Try it"'s previews: a Mate's parts (`mateParts`, the reader every surface shows them from), each
 * part with a public preview by its real hostname. A change of one repository offers that pair's
 * parts; where no part's dev is that repository — a pool-era Mate, whose parts' devs are pools — it
 * offers every part, as a recipe change does.
 */
export function tryItPreviews(input: {
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly hostnames: ReadonlyArray<string>;
  readonly pools: ReadonlyArray<string> | undefined;
  readonly controlPlane: string | undefined;
  /** The Mate tier on `main`. */
  readonly tier: string | undefined;
  /** The change's repository; `undefined` for every part's. */
  readonly repository: string | undefined;
}): ReadonlyArray<GroupFlowPreview> {
  const { parts } = mateParts({
    services: input.hostnames.map((hostname) => ({ hostname })),
    routes: input.routes,
    pools: input.pools,
    controlPlane: input.controlPlane,
    tier: input.tier,
  });
  const own = parts.filter((part) => part.devService === input.repository);
  return (own.length === 0 ? parts : own).flatMap((part) =>
    part.preview?.url === undefined
      ? []
      : [{ service: part.preview.service, url: part.preview.url }],
  );
}

/** One part's preview in a change's review, as its receipt left it. */
export interface ReceiptRow {
  readonly setup: string;
  readonly preview: string;
  /** "from a1b2c3d · verified", "from an uncommitted tree", "deploy failed", "not deployed". */
  readonly words: string;
}

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * A change's receipt (`HqChange.receipt`) as its review shows it: a row per part, and the warning
 * Merge carries for each part not tried at the change — its preview failed, deployed from an
 * uncommitted tree or an older commit, or not verified. A part never deployed may be one the change
 * does not touch, so it warns of nothing. Nothing for a single-part application. The warning never
 * blocks a merge.
 */
export function changeReceipt(input: {
  readonly receipt: ChangeReceipt | undefined;
  /** The change's head, which a preview's commit is compared with. */
  readonly head: string | undefined;
}):
  | { readonly parts: ReadonlyArray<ReceiptRow>; readonly warning: string | undefined }
  | undefined {
  const { receipt, head } = input;
  if (receipt === undefined || receipt.parts.length < 2) return undefined;
  const gaps: Array<string> = [];
  const parts = receipt.parts.map((part): ReceiptRow => {
    const row = (words: string, gap?: string) => {
      if (gap !== undefined) gaps.push(`${part.setup} (${gap})`);
      return { setup: part.setup, preview: part.previewHostname, words };
    };
    if (part.deploy === "none") return row("not deployed");
    if (part.deploy === "failed") return row("deploy failed", "failed");
    const verified = part.verified ? " · verified" : " · not verified";
    const unverified = part.verified ? undefined : "not verified";
    const commit = part.workspaceClean ? part.deployedCommit : undefined;
    if (commit === undefined) {
      return row(`from an uncommitted tree${verified}`, "uncommitted");
    }
    if (head !== undefined && commit !== head) {
      return row(
        `from ${shortSha(commit)}, the change is at ${shortSha(head)}${verified}`,
        "older commit",
      );
    }
    return row(`from ${shortSha(commit)}${verified}`, unverified);
  });
  return {
    parts,
    warning: gaps.length === 0 ? undefined : `Not tried at this change: ${gaps.join(", ")}.`,
  };
}

/** What releasing does, said under its button: how long, and the way back. */
export function releaseFoot(input: {
  readonly state: ReviewState;
  readonly consequence: string;
  readonly live: string | undefined;
}): string {
  if (input.state !== "release-ready") return input.consequence;
  const back =
    input.live === undefined ? "" : ` You can roll back to ${input.live} from production's panel.`;
  return `${RELEASE_TAKES}${back}`;
}

/** A release's head: its title, the line under it, the quiet line under that, and its foot. */
export interface ReleaseHeading {
  readonly title: string;
  /** Before the press, what goes out (`releaseLine`); once pressed, the state says it all. */
  readonly meta: string | undefined;
  /** Where it stands, said once on the line: a running release's step and clock. */
  readonly state: string | undefined;
  /** Quiet, under the line: why it cannot go, the way back once live, what stopped it. */
  readonly note: string | undefined;
  /** Under the buttons: what pressing does; nothing once it is pressed. */
  readonly foot: string;
}

/**
 * What a release's head says. Offered, it is the release to make, what goes out and what
 * pressing does; pressed, its title is where it stands — releasing, live, or stopped — and the
 * line says its step and clock once, never the offer's facts again beside it.
 */
export function releaseHeading(input: {
  readonly tag: string;
  readonly model: ReleaseReviewModel;
  /** What goes out (`releaseLine`). */
  readonly line: string;
  /** What production ran as it was offered. */
  readonly live: string | undefined;
}): ReleaseHeading {
  const { tag, model } = input;
  const { verdict } = model;
  switch (verdict.state) {
    case "releasing":
      return {
        title: `Releasing ${tag} to production`,
        meta: undefined,
        state: verdict.why,
        note: model.consequence,
        foot: "",
      };
    case "released":
      return {
        title: `${tag} is live`,
        meta: undefined,
        state: verdict.why,
        note: model.ifWrong,
        foot: "",
      };
    // Failed, "Production now" says what it still runs: its cause alone, its fix beside it.
    case "release-failed":
      return {
        title: verdict.title,
        meta: undefined,
        state: undefined,
        note: `${verdict.why.replace(/\.$/u, "")}.`,
        foot: "",
      };
    case "release-stalled":
    case "release-superseded":
      return {
        title: verdict.title,
        meta: undefined,
        state: undefined,
        note: `${verdict.why.replace(/\.$/u, "")}. ${model.consequence}`,
        foot: "",
      };
  }
  const ready = verdict.state === "release-ready";
  return {
    title: `Release ${tag} to production`,
    meta: ready ? input.line : input.line.replace(/\.$/u, ""),
    state: ready ? undefined : verdict.title,
    note: whySaid(verdict, false) ? verdict.why : undefined,
    foot: releaseFoot({ state: verdict.state, consequence: model.consequence, live: input.live }),
  };
}

function changesWords(n: number): string {
  return `${String(n)} ${n === 1 ? "change" : "changes"}`;
}

/**
 * Under a release's title: how many changes, and whether the stage runs them — never that they
 * were tested there: running on a stage is no test anybody ran (the onboarding run's owner read
 * "tested on stage" of a stage nobody had opened).
 */
export function releaseLine(input: {
  /** How many go out; `undefined` while that is still compared, which is then not said. */
  readonly changes: number | undefined;
  /** The stage that follows `main`, by name. */
  readonly stage: string | undefined;
  /** When the stage last took what it runs (`sinceWords`). */
  readonly since: string | undefined;
  readonly onStage: { readonly total: number; readonly running: number } | undefined;
  readonly live: string | undefined;
}): string {
  if (input.changes === undefined)
    return input.live === undefined ? "The first release." : `Since ${input.live}.`;
  const changes = changesWords(input.changes);
  const onStage = input.onStage;
  if (input.stage !== undefined && onStage !== undefined && onStage.total > 0) {
    if (onStage.running >= onStage.total) {
      return `${changes}, on ${input.stage}${input.since === undefined ? "" : ` since ${input.since}`}.`;
    }
    return `${changes}, ${String(onStage.running)} of them on ${input.stage} so far.`;
  }
  return input.live === undefined
    ? `${changes}, the first release.`
    : `${changes} since ${input.live}.`;
}

/** "Production now": what it runs, since when, and where. */
export function productionNowLine(input: {
  readonly live: string | undefined;
  readonly since: string | undefined;
  readonly host: string | undefined;
}): string {
  if (input.live === undefined) return "Nothing released yet.";
  const since = input.since === undefined ? "" : ` since ${input.since}`;
  const at = input.host === undefined ? "" : ` at ${input.host}`;
  return `Runs ${input.live}${since}${at}.`;
}

/**
 * The code production runs, per service, where it runs one whole commit of a repository it builds
 * from: what a person can read before a release replaces it. A service running nothing, or what no
 * commit names, has none; so has every service while what production runs is not known — as for a
 * production the grant withholds, which is never compared (`useProjectFlows`).
 */
export function productionCode(input: {
  readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
  /** The repository each production service builds from, by hostname. */
  readonly repositories: ReadonlyMap<string, string> | undefined;
}): ReadonlyArray<{ readonly service: string; readonly repository: string; readonly sha: string }> {
  const { runs, repositories } = input;
  if (runs === undefined || repositories === undefined) return [];
  return [...runs]
    .flatMap(([service, run]) => {
      const repository = repositories.get(service);
      return run.kind === "commit" && repository !== undefined
        ? [{ service, repository, sha: run.sha }]
        : [];
    })
    .toSorted((left, right) => left.service.localeCompare(right.service));
}

/**
 * "Production now" for a release review: the line, and one row per part — what it runs and the
 * address it answers at — where production runs more than one (MODEL §9/5). One part keeps the
 * line, with its address when it is the only one.
 */
export function productionNow(input: {
  readonly live: string | undefined;
  readonly since: string | undefined;
  /** Production's parts by hostname, each with the version it runs as a person names it. */
  readonly parts: ReadonlyArray<{
    readonly hostname: string;
    readonly version: string | undefined;
  }>;
  /** Each service's address (`placeAddresses`). */
  readonly addresses: ReadonlyArray<GroupFlowAddress>;
}): { readonly line: string; readonly rows: ReadonlyArray<string> } {
  if (input.parts.length <= 1)
    return { line: productionNowLine({ ...input, host: soleSite(input.addresses) }), rows: [] };
  return {
    line: productionNowLine({ ...input, host: undefined }),
    rows: [...input.parts]
      .sort((left, right) => left.hostname.localeCompare(right.hostname))
      .map((part) => {
        const host = siteOf(input.addresses.find((entry) => entry.service === part.hostname)?.url);
        return [
          part.hostname,
          part.version ?? "runs nothing",
          ...(host === undefined ? [] : [host]),
        ].join(" · ");
      }),
  };
}

/**
 * What "Production now" says production ran as the release was offered: since when the release it
 * replaces runs — that release's own time, never a newer one's — and the parts a release puts
 * something on. A database runs no release, so it is no part here. While the release goes out, a
 * part it redeploys names the build on its way, not what it serves: it still serves the release it
 * replaces.
 */
export function productionBefore(input: {
  readonly replaces: ReleaseReplaces;
  readonly releases: ReadonlyArray<{
    readonly tag: string;
    readonly taggedAt: string;
    readonly entries: ReadonlyArray<{ readonly service: string }>;
  }>;
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly appVersionName?: string | undefined;
  }>;
  readonly releasing: boolean;
}): {
  readonly at: string | undefined;
  readonly parts: ReadonlyArray<{
    readonly hostname: string;
    readonly version: string | undefined;
  }>;
} {
  const replaced = input.replaces.kind === "release" ? input.replaces.tag : undefined;
  const released = new Set(
    input.releases.flatMap((release) => release.entries.map((entry) => entry.service)),
  );
  return {
    at: input.releases.find((release) => release.tag === replaced)?.taggedAt,
    parts: input.services
      .filter((service) => released.has(service.hostname))
      .map((service) => ({
        hostname: service.hostname,
        version:
          deployedVersion(service.appVersionName).label ?? (input.releasing ? replaced : undefined),
      })),
  };
}

const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

/** `14:10` today, `Tue` this week, `Sep 18` before: when, as short as a line wants it. */
export function sinceWords(at: string | undefined, now: number): string | undefined {
  if (at === undefined) return undefined;
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return undefined;
  const today = new Date(now);
  if (then.toDateString() === today.toDateString()) {
    return `${String(then.getHours()).padStart(2, "0")}:${String(then.getMinutes()).padStart(2, "0")}`;
  }
  if (now - then.getTime() < WEEK_MS) {
    return then.toLocaleDateString("en-US", { weekday: "short" });
  }
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
