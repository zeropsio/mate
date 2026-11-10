/**
 * Quick calls in a row, folded into one row of the run's log (the owner's
 * board, 2026-11-10: "sometimes it pumps out 10 rows in two seconds" — each of
 * ten reads landed as its own row, and the card's edge moved ten times). A
 * call that came and went inside a second says little by itself; two or more
 * of them one right after another are one row that counts them — "Ran 10
 * commands", "Read 10 files" — and opens in place to list them.
 *
 * Read from the record alone, so a run reads the same while it goes on, once
 * it is over and after a reload: no row folds or unfolds by how it was
 * watched. Provider-neutral: a call is told by its step's kind and its times,
 * never by an adapter's tool names.
 */
import type { StepKind, WorkStep } from "./workSteps.logic";

/** A call that started and ended inside this long is quick. */
export const QUICK_CALL_MS = 1000;

/** How many quick calls in a row fold into one row. */
export const QUICK_CALLS_FOLD = 2;

/** A quick call starting within this long of the one before it ending is the same run of them. */
export const QUICK_RUN_GAP_MS = 1000;

/**
 * Whether a step is a quick call: done inside a second, with nothing of its
 * own to keep in sight — an edit is what the run changed, a look shows its
 * pictures, a failure wears its mark, a job sent to the background runs on.
 */
export function isQuickCall(step: WorkStep): boolean {
  if (step.state !== "done" || step.endedAt === null) return false;
  if (step.kind === "edit" || step.kind === "look") return false;
  if (step.noResult !== undefined || step.background !== undefined) return false;
  const took = Date.parse(step.endedAt) - Date.parse(step.startedAt);
  return Number.isFinite(took) && took >= 0 && took < QUICK_CALL_MS;
}

/**
 * Whether a quick call goes on the run `before` ends: it started within a
 * second of that one ending — where an engine says a call only as it returns,
 * the two returned within a second of each other. Two quick calls a minute
 * apart with nothing said between them are two rows.
 */
function joinsRun(before: WorkStep, step: WorkStep): boolean {
  if (before.endedAt === null) return false;
  const gap = Date.parse(step.startedAt) - Date.parse(before.endedAt);
  return Number.isFinite(gap) && gap < QUICK_RUN_GAP_MS;
}

/** Quick calls folded into one row, keyed by its first: a call joining it never re-keys it. */
export interface QuickCalls<Line> {
  readonly key: string;
  readonly quick: ReadonlyArray<Line>;
}

/**
 * The lines with each run of quick calls folded: `stepOf` says which lines
 * are quick calls and `keyOf` names a line. A lone quick call stays its own
 * row; a call only ever joins the last run, at its end.
 */
export function foldQuickCalls<Line>(
  lines: ReadonlyArray<Line>,
  stepOf: (line: Line) => WorkStep | null,
  keyOf: (line: Line) => string,
): ReadonlyArray<Line | QuickCalls<Line>> {
  const folded: Array<Line | QuickCalls<Line>> = [];
  let run: Line[] = [];
  let last: WorkStep | null = null;
  const close = () => {
    if (run.length >= QUICK_CALLS_FOLD) folded.push({ key: keyOf(run[0]!), quick: run });
    else folded.push(...run);
    run = [];
    last = null;
  };
  for (const line of lines) {
    const step = stepOf(line);
    if (step === null || !isQuickCall(step)) {
      close();
      folded.push(line);
      continue;
    }
    if (last !== null && !joinsRun(last, step)) close();
    run.push(line);
    last = step;
  }
  close();
  return folded;
}

/**
 * How many quick calls stand at the end of `lines`: the run a call landing
 * now joins. One alone there is not a row of its own while a burst goes on —
 * it waits for the second, and they enter as one row (`RunChat`).
 */
export function quickCallsAtEnd<Line>(
  lines: ReadonlyArray<Line>,
  stepOf: (line: Line) => WorkStep | null,
): number {
  let count = 0;
  let after: WorkStep | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const step = stepOf(lines[index]!);
    if (step === null || !isQuickCall(step)) break;
    if (after !== null && !joinsRun(step, after)) break;
    count += 1;
    after = step;
  }
  return count;
}

/** A folded row's words around its count, by what its calls were. */
const QUICK_WORDS: Readonly<
  Partial<Record<StepKind, readonly [verb: string, one: string, many: string]>>
> = {
  command: ["Ran", "command", "commands"],
  read: ["Read", "file", "files"],
  search: ["Ran", "search", "searches"],
  web: ["Read", "page", "pages"],
  tool: ["Used", "tool", "tools"],
};

/**
 * A folded row in words, its count apart so it alone changes while the row
 * ticks: "Ran" · 10 · "commands" for calls of one kind, "Ran" · 10 · "steps"
 * for a mix.
 */
export function quickCallsWords(steps: ReadonlyArray<WorkStep>): {
  readonly verb: string;
  readonly count: number;
  readonly noun: string;
} {
  const kinds = new Set(steps.map((step) => step.kind));
  const [only] = kinds;
  const words = kinds.size === 1 && only !== undefined ? QUICK_WORDS[only] : undefined;
  const count = steps.length;
  if (words === undefined) return { verb: "Ran", count, noun: count === 1 ? "step" : "steps" };
  return { verb: words[0], count, noun: count === 1 ? words[1] : words[2] };
}

/** How long a folded row's calls took, first start to last end, in milliseconds; null where unknown. */
export function quickCallsSpanMs(steps: ReadonlyArray<WorkStep>): number | null {
  const starts = steps.map((step) => Date.parse(step.startedAt)).filter(Number.isFinite);
  const ends = steps
    .map((step) => (step.endedAt === null ? Number.NaN : Date.parse(step.endedAt)))
    .filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return null;
  const span = Math.max(...ends) - Math.min(...starts);
  return span >= 0 ? span : null;
}
