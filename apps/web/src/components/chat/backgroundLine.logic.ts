/**
 * Background work as one quiet line (R3, run 9): what a turn sent to the
 * background, on its own card — what runs, what finished, what failed — and,
 * opened, each task once: a failure first, in its own word, with what it
 * reported. Nothing it opens says the line's own words again (R7: a finished
 * task opened onto its own title, or onto `Background command "…" completed`).
 *
 * Pure: the row hands its jobs or its tasks' entries here, and the line draws this.
 */
import { workEntryDisplayIndicatesToolFailure, type WorkLogEntry } from "../../session-logic";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import { taskReportWords, taskSaid, type BackgroundJob } from "./workSteps.logic";

/** "lost": its session is gone and it never reported. */
export type BackgroundState = "running" | "done" | "failed" | "stopped" | "lost";

/** One task, as the opened line lists it. */
export interface BackgroundItem {
  readonly key: string;
  readonly title: string;
  readonly state: BackgroundState;
  /** What it reported past its title and its state, or null. */
  readonly report: string | null;
  /** Its report is a shell's output, set in mono; a helper's is words. */
  readonly mono: boolean;
}

export interface BackgroundLineModel {
  readonly words: string;
  /** Where it ran, after the words — none where the words say it. */
  readonly where: string | null;
  readonly failed: boolean;
  /** One task: its line names it, and it opens onto its report alone. */
  readonly single: boolean;
  /** What it opens onto: empty where the line says it all. */
  readonly items: ReadonlyArray<BackgroundItem>;
}

const STATE_WORD: Record<BackgroundState, string> = {
  running: "running",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
  lost: "didn't report back",
};

/** A report short enough to read on its row — "Exit code 3" — rather than in a block under it. */
export function reportsInline(report: string): boolean {
  return !report.includes("\n") && report.length <= 60;
}

/** The word an item wears in the opened list. */
export function backgroundItemWord(item: BackgroundItem): string {
  return STATE_WORD[item.state];
}

function capitalized(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The line over its items. One task says itself — "Run the soak test failed"
 * — and opens onto its report alone; several are counted by state, each count
 * only ever rising, and open onto each, a failure first.
 */
export function backgroundLineOf(
  items: ReadonlyArray<BackgroundItem>,
  helpers: boolean,
): BackgroundLineModel {
  const failed = items.filter((item) => item.state === "failed").length;
  const running = items.filter((item) => item.state === "running").length;
  const lost = items.filter((item) => item.state === "lost").length;
  // A job stopped is its own state: never one that finished (Milo's second stress run counted a
  // job Milo stopped as finished).
  const stopped = items.filter((item) => item.state === "stopped").length;
  const done = items.length - failed - running - lost - stopped;
  const where = helpers ? "helper" : "in the background";
  const [only] = items;
  if (items.length === 1 && only !== undefined) {
    // A short report reads on the line itself: nothing left to open.
    const inline = only.report !== null && reportsInline(only.report);
    const at = only.state === "running" ? `running ${where}` : where;
    return {
      words: only.state === "running" ? only.title : `${only.title} ${STATE_WORD[only.state]}`,
      where: inline ? `${at} · ${only.report}` : at,
      failed: only.state === "failed",
      single: true,
      items: only.report === null || inline ? [] : [only],
    };
  }
  const noun = helpers ? "helpers" : "background jobs";
  const counts = [
    running > 0 ? `${running} running` : null,
    done > 0 && (running > 0 || failed > 0 || lost > 0 || stopped > 0) ? `${done} finished` : null,
    failed > 0 ? `${failed} failed` : null,
    stopped > 0 ? `${stopped} stopped` : null,
    lost > 0 ? `${lost} didn't report back` : null,
  ].filter((part): part is string => part !== null);
  return {
    words:
      counts.length === 0
        ? `${items.length} ${noun} finished`
        : running === items.length
          ? `${items.length} ${noun} running`
          : `${items.length} ${noun}: ${counts.join(", ")}`,
    where: null,
    failed: failed > 0,
    single: false,
    // A failure first: it is what the person came to read.
    items: [
      ...items.filter((item) => item.state === "failed"),
      ...items.filter((item) => item.state !== "failed"),
    ],
  };
}

/** The jobs a turn sent to the background, as the line's items. */
export function jobItems(jobs: ReadonlyArray<BackgroundJob>): ReadonlyArray<BackgroundItem> {
  return jobs.map((job) => ({
    key: job.key,
    title: capitalized(job.title),
    state: job.state,
    report: job.report,
    mono: true,
  }));
}

/** Tasks that reported in, by task — the last word of each — as the line's items. */
export function taskItems(entries: ReadonlyArray<WorkLogEntry>): ReadonlyArray<BackgroundItem> {
  const lastByTask = new Map<string, WorkLogEntry>();
  for (const entry of entries) lastByTask.set(entry.taskId ?? entry.id, entry);
  return [...lastByTask.values()].map((entry) => {
    const title = capitalized(normalizeCompactToolLabel(entry.toolTitle ?? entry.label));
    return {
      key: entry.id,
      title,
      state: workEntryDisplayIndicatesToolFailure(entry) ? "failed" : "done",
      report: taskReportWords(taskSaid(entry), title),
      mono: entry.agentRole === undefined,
    };
  });
}
