/**
 * The review's own decisions that are about drawing it, not about the change:
 * its kind line, where it opens from, which key presses it, where Try it goes,
 * which of the Mate's words say what the change does, and how much of a long
 * diff stands before its fold. What the verdict says is `reviewVerdict.ts`'s.
 *
 * Pure: no DOM, no clock.
 */
import type { ReviewPrimary, ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";

export type ReviewKind = "change" | "release" | "rollback" | "crew-task";

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

/** ⌘↵ (Ctrl+↵ off a Mac) presses the primary — only while it is safe to. */
export function pressesPrimary(
  event: { readonly key: string; readonly metaKey: boolean; readonly ctrlKey: boolean },
  primary: Pick<ReviewPrimary, "safe" | "enabled"> | undefined,
): boolean {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    primary !== undefined &&
    primary.safe &&
    primary.enabled
  );
}

const DEV_SUFFIX = "dev";
const STAGE_SUFFIX = "stage";

/**
 * Where a change runs: the preview — the stage half of its repository's dev/stage pair
 * (`appstage` beside `appdev`, or beside `app`), which runs the change as it was deployed
 * before its pull request opened — and failing that the dev service itself, where the Mate
 * works on it. Nothing where neither serves on a public route.
 */
export function previewRoute(
  repository: string,
  routes: ReadonlyArray<ZeropsPublicRoute>,
): ZeropsPublicRoute | undefined {
  const name =
    repository.endsWith(DEV_SUFFIX) && repository.length > DEV_SUFFIX.length
      ? repository.slice(0, -DEV_SUFFIX.length)
      : repository;
  return (
    routes.find((route) => route.service === `${name}${STAGE_SUFFIX}`) ??
    routes.find((route) => route.service === repository)
  );
}

/** How much of what the Mate said stands in the review: four lines of it, about. */
const RUN_WORDS_MAX = 400;

/** A message's markdown read as plain sentences: no code blocks, marks, links or bullets. */
function plainText(text: string): string {
  return text
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
 * message that links it, the link's own sentence left out, up to about four lines. The rest
 * is the run's, one click away.
 */
export function runWords(text: string, changePath: string): string | undefined {
  const sentences = plainText(text)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence.length > 0 && !sentence.includes(changePath) && !/https?:\/\//u.test(sentence),
    );
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

export function diffLinesShown(total: number, all: boolean): number {
  return all ? total : Math.min(total, REVIEW_DIFF_LINES_SHOWN);
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
  readonly mateProjectId: string | undefined;
  readonly mergedAt: string | undefined;
  readonly stage: ReleaseStageMark;
}

/** A squash commit on `main` names the pull request it landed: `Title (#54)`. */
const LANDED_AS = /\s*\(#(\d+)\)\s*$/u;

/**
 * What a release carries, one row per change: a squash-merged commit is the change it
 * landed, whose Mate wrote it and when; a commit nobody reviewed is its own words.
 */
export function releaseChangeRows(input: {
  readonly commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
  readonly merged: ReadonlyArray<{
    readonly number: number;
    readonly title: string;
    readonly mateProjectId: string | undefined;
    readonly mergedAt: string | undefined;
  }>;
  readonly marks: ReadonlyMap<string, ReleaseStageMark>;
}): ReadonlyArray<ReleaseChangeRow> {
  return input.commits.map((commit) => {
    const key = commit.sha.toLowerCase();
    const number = LANDED_AS.exec(commit.subject)?.[1];
    const change =
      number === undefined
        ? undefined
        : input.merged.find((entry) => entry.number === Number(number));
    return {
      key,
      title:
        change === undefined
          ? commit.subject
          : `#${String(change.number)} ${change.title.replace(LANDED_AS, "")}`,
      mateProjectId: change?.mateProjectId,
      mergedAt: change?.mergedAt,
      stage: input.marks.get(key) ?? "none",
    };
  });
}

/**
 * What "Ask Nova for changes" writes into the Mate's composer: the change named the way its
 * tools address it, then room for the person's words. Written, not sent.
 */
export function changeRequestPrefill(pull: {
  readonly number: number;
  readonly title: string;
  readonly repository: string;
}): string {
  return `On #${String(pull.number)} "${pull.title}" on ${pull.repository}: `;
}

/**
 * Which of a change's files `main` moved under it, and the newest commit that did — for a change
 * that no longer merges; `undefined` for one that does, or while either read is out.
 */
export function changeConflict(input: {
  readonly mergeability: string;
  readonly files: ReadonlyArray<{ readonly filename: string }> | undefined;
  readonly mainSince:
    | ReadonlyArray<{
        readonly subject: string;
        readonly at?: string | undefined;
        readonly files?: ReadonlyArray<string> | undefined;
      }>
    | undefined;
}):
  | {
      readonly files: ReadonlyArray<string>;
      readonly by: { readonly subject: string; readonly at: string | undefined } | undefined;
    }
  | undefined {
  if (input.mergeability !== "conflicting" || input.files === undefined) return undefined;
  if (input.mainSince === undefined) return undefined;
  const touched = new Set(input.mainSince.flatMap((commit) => commit.files ?? []));
  const overlap = input.files.map((file) => file.filename).filter((path) => touched.has(path));
  // A comparison lists the oldest first: the newest to touch one of them is the last that did.
  const by = input.mainSince.findLast((commit) =>
    (commit.files ?? []).some((path) => overlap.includes(path)),
  );
  return { files: overlap, by: by === undefined ? undefined : { subject: by.subject, at: by.at } };
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
