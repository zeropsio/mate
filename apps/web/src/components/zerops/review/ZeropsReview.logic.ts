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
import type { MessageAbout } from "@t3tools/contracts";
import {
  deployedVersion,
  type Moved,
  type ProductionRun,
  type ReviewPrimary,
  type ReviewState,
  type ReviewVerdict,
  type ReleaseReplaces,
} from "@t3tools/client-runtime/zerops";
import { keyRenewedBy, stopKeyGap } from "@t3tools/client-runtime/zerops/flow";
import type { HqEnvironmentTarget } from "@t3tools/shared/hqEnvironment";
import type { KeyRenewal } from "~/zerops/renewDeployKey.logic";
import { parseAttachmentUrl } from "@t3tools/shared/hqChanges";
import { NO_ACCESS } from "~/zerops/hqRead.logic";
import { environmentTitle } from "../place/place.logic";

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
type ReviewDescription =
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
type DescriptionPicture =
  | { readonly kind: "hq"; readonly url: string }
  | { readonly kind: "elsewhere"; readonly url: string }
  | { readonly kind: "none" };

/** The tallest a description's picture stands (its `max-h` in `ReviewDescription`). */
const REVIEW_PICTURE_MAX_HEIGHT = 560;

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

/** How many lines of one file's diff stand before "Show all N lines" opens the rest. */
export const REVIEW_DIFF_LINES_SHOWN = 400;
/** A file's diff longer than this is never drawn whole here. */
export const REVIEW_DIFF_LINES_MAX = 2_000;

/** What follows the lines a file's diff shows: the way to the rest, or that it is not here. */
type DiffRest =
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
 * Where a change's code opens in the Git browser: an open change's files at its head; an added
 * one's commit on `main`, the page that says what it added there, its files read at that commit.
 * Both are its files to the person, never a commit on main. None where HQ named neither.
 */
export function changeCode(pull: {
  readonly merged: boolean;
  readonly headSha?: string | undefined;
  readonly mergeCommitSha?: string | undefined;
}): { readonly sha: string; readonly view: "code" | "commit"; readonly words: string } | undefined {
  if (pull.merged && pull.mergeCommitSha !== undefined)
    return { sha: pull.mergeCommitSha, view: "commit", words: "Browse files" };
  if (pull.headSha === undefined) return undefined;
  return { sha: pull.headSha, view: "code", words: "Browse files" };
}

/**
 * Whom a change's Fix asks and about what: the conversation of the change's own branch in its
 * repository, never the one the review was opened from, about the change at its head.
 */
export function changeFixOptions(pull: {
  readonly branch?: string | undefined;
  readonly repositoryUrl?: string | undefined;
  readonly repository: string;
  readonly number: number;
  readonly headSha?: string | undefined;
}): {
  readonly branch: string | undefined;
  readonly repositoryUrl: string | undefined;
  readonly about: MessageAbout;
} {
  return {
    branch: pull.branch,
    repositoryUrl: pull.repositoryUrl,
    // Once sent, its Mate's row names this change at this head until its run ends.
    about: {
      kind: "change",
      repo: pull.repository,
      number: pull.number,
      ...(pull.headSha === undefined ? {} : { head: pull.headSha }),
    },
  };
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

/** A folded row's count where HQ has not recorded what it counts: never a 0 that reads as none. */
export const NOT_RECORDED_ASIDE = "Not known yet";

/** Where a change a release carries stands on the stage (`stageMarks`). */
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
  if (input.projectKnown === false) return verdict("attention", NO_ACCESS.title, NO_ACCESS.why);
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

/** States where a change still waits on its press. */
const WAITING_ON_PRESS: ReadonlySet<ReviewState> = new Set(["ready", "github-checks-failed"]);

/**
 * The foot explains the wait for GitHub, so that verdict leaves its why empty. A ready
 * release's title and a failed GitHub check's own line already explain those verdicts.
 * A ready change also says its why for a draft, when `main` moved on, or when its verdict asks.
 */
export function whySaid(verdict: ReviewVerdict, more: boolean): boolean {
  if (
    verdict.why === "" ||
    verdict.state === "release-ready" ||
    (verdict.state === "github-checks-failed" && verdict.showWhy !== true)
  ) {
    return false;
  }
  return verdict.state !== "ready" || more || verdict.showWhy === true;
}

/** The main-following stages with the deploy-key gap HQ's facts reveal. */
export interface MergeStage {
  readonly name: string;
  readonly environment?: string | undefined;
  readonly projectId?: string | undefined;
  readonly gap: ReturnType<typeof stopKeyGap>;
}

/** Shape the flow's stages for the review without adding another key-state decision. */
export function mergeStageInputs(
  entries: ReadonlyArray<{
    readonly name: string;
    readonly environment: string;
    readonly target: HqEnvironmentTarget;
    readonly keyHeld: boolean;
    readonly keyInvalid: boolean;
  }>,
  mayKeep: (projectId: string) => boolean | undefined,
): ReadonlyArray<MergeStage> {
  return entries.map((entry) => {
    if (entry.target.kind !== "zerops") return { name: entry.name, gap: undefined };
    const projectId = entry.target.projectId;
    return {
      name: entry.name,
      environment: entry.environment,
      projectId,
      gap: stopKeyGap({ ...entry, mayKeep: mayKeep(projectId), project: entry.name }),
    };
  });
}

/** Which stages run a merge, and the first one whose key holds it. */
export function mergeStages(input: {
  readonly state: ReviewState;
  readonly recipe: boolean;
  readonly stages: ReadonlyArray<MergeStage>;
  readonly mayRenew: boolean;
}): {
  readonly runs: ReadonlyArray<string>;
  readonly held: { readonly stage: MergeStage; readonly offer: "renew" | "told" } | undefined;
} {
  if (!WAITING_ON_PRESS.has(input.state) || input.recipe)
    return { runs: input.stages.map((stage) => stage.name), held: undefined };
  const held = input.stages.find((stage) => stage.gap !== undefined);
  return {
    runs: input.stages.filter((stage) => stage.gap === undefined).map((stage) => stage.name),
    held:
      held === undefined ? undefined : { stage: held, offer: input.mayRenew ? "renew" : "told" },
  };
}

/**
 * What adding does, said under the buttons: the review's own words (`consequence`: Your app gets
 * it, and production isn't touched until a release), and, where a stage that deploys merges from
 * `main` (`stageDeploysMerges`) cannot, why and who renews its key. Nothing else of Stage or
 * Production (the chat script). A setup change, and a change no longer waiting on its press, say
 * only the review's words.
 */
export function mergeFoot(input: {
  readonly state: ReviewState;
  readonly consequence: string;
  /** The stages that deploy what merges into `main`, with their key gaps. */
  readonly stages: ReadonlyArray<MergeStage>;
  readonly mayRenew: boolean;
  readonly renewal?: KeyRenewal | undefined;
  /** {@link changeReceipt}'s warning: parts not tried at the change. */
  readonly warning?: string | undefined;
  /** A recipe change: what its merge does is the review's to say. */
  readonly recipe?: boolean | undefined;
}): string {
  if (!WAITING_ON_PRESS.has(input.state) || input.recipe === true) return input.consequence;
  const held = mergeStages({
    state: input.state,
    recipe: false,
    stages: input.stages,
    mayRenew: input.mayRenew,
  }).held;
  const gap = held?.stage.gap;
  const stopped =
    held === undefined || gap === undefined
      ? ""
      : ` ${environmentTitle("stage", held.stage.name)} does not run it: ${gap.kind === "missing" ? "it has no deploy key yet" : "its deploy key no longer works"}.`;
  const repair =
    gap === undefined
      ? ""
      : input.renewal?.kind === "failed"
        ? ` ${input.renewal.words}`
        : held?.offer === "told"
          ? ` ${keyRenewedBy(`the ${gap.project} project`, gap.kind)}`
          : "";
  const foot = `${input.consequence}${stopped}${repair}`;
  return input.warning === undefined ? foot : `${input.warning} ${foot}`;
}

/**
 * Whether a stage deploys what merges into `main`, so the merge foot may say so: it follows
 * `main`, and it has deployed from it — it runs a commit, or HQ took a deploy of it live. A stage
 * and never deployed (Larkspur's, 2026-10-28: its stage tier waited in a
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
 * What production ran as the release was offered: since when the release it replaces runs — that
 * release's own time, never a newer one's — and the parts a release puts something on. A database runs no release, so it is no part here. While the release goes out, a
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

/** What "Try it" says of the app while it answers at no address: in the slot its press would hold. */
export const APP_ADDRESS_MISSING = "Your app has no address yet.";

/** One place in "Try it"'s row. */
export type ReviewTryItem =
  | { readonly kind: "app"; readonly service: string; readonly url: string }
  | { readonly kind: "app-missing" }
  | { readonly kind: "draft" };

/**
 * "Try it"'s row: a *Your app* press for each address the app answers at or, while it answers at
 * none, the line naming it (`APP_ADDRESS_MISSING`) in that press's slot, so it never reads as about
 * *Open draft*; then *Open draft* while the change's draft can open. Every press it holds acts.
 */
export function reviewTryRow(
  builds: ReadonlyArray<{ readonly service: string; readonly url: string }>,
  draftOpenable: boolean,
): ReadonlyArray<ReviewTryItem> {
  const app: ReadonlyArray<ReviewTryItem> =
    builds.length === 0
      ? [{ kind: "app-missing" }]
      : builds.map((build) => ({ kind: "app", service: build.service, url: build.url }));
  return draftOpenable ? [...app, { kind: "draft" }] : app;
}
