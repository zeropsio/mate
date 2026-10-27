/**
 * The helpers' and the background tasks' bands as one line each (pass 43,
 * R12-9): one place per fact — the mark says how it stands, the title what it
 * does, the time how long — and no bar whose meaning is not plain. The count
 * shows only where there are several; the others are said in words, never as
 * "n/total". Opened, a row each: its mark, its title, its time.
 *
 * Pure: the band draws this.
 */
import type { BackgroundWork } from "@t3tools/contracts";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { DockBackgroundTask, DockModel } from "./conversationDock.logic";

export interface BandLine {
  /** Its mark: how it stands. */
  readonly tone: ServiceStatusToneId;
  /** How many, only where there are several. */
  readonly count: string | null;
  /** What the one in focus does. */
  readonly title: string;
  /** The others, in words. */
  readonly others: string | null;
  /** Its time: counting while it runs, its length once it ended. */
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** What a screen reader hears, the mark said in its word. */
  readonly label: string;
}

/** A mark's state in a word, for those who cannot see the mark. */
const TONE_WORD: Record<ServiceStatusToneId, string> = {
  busy: "working",
  ok: "done",
  failed: "failed",
  attention: "waiting for you",
  off: "stopped",
};

/** Which mark stands for several: one that waits for the person, then work, then a failure. */
const TONE_RANK: ReadonlyArray<ServiceStatusToneId> = ["attention", "busy", "failed", "ok", "off"];

function newest<T extends { readonly startedAt: string }>(rows: ReadonlyArray<T>): T | undefined {
  return rows.reduce<T | undefined>(
    (best, row) => (best === undefined || row.startedAt >= best.startedAt ? row : best),
    undefined,
  );
}

/** From the first start to the last end, or still counting while any runs. */
function spanOfAll(
  rows: ReadonlyArray<{ readonly startedAt: string; readonly endedAt: string | null }>,
): { readonly startedAt: string; readonly endedAt: string | null } {
  const startedAt = rows.map((row) => row.startedAt).toSorted()[0] ?? "";
  const ends = rows.map((row) => row.endedAt);
  const endedAt = ends.some((end) => end === null)
    ? null
    : ((ends as ReadonlyArray<string>).toSorted().at(-1) ?? null);
  return { startedAt, endedAt };
}

export function helpersBand(helpers: NonNullable<DockModel["helpers"]>): BandLine {
  const { rows } = helpers;
  const tone = TONE_RANK.find((rank) => rows.some((row) => row.tone === rank)) ?? "off";
  const focus = newest(rows.filter((row) => row.tone === tone)) ?? rows[0];
  const title = focus?.title ?? "";
  const several = rows.length > 1;
  return {
    tone,
    count: several ? `${rows.length} helpers` : null,
    title,
    others: null,
    ...spanOfAll(rows),
    label: several
      ? `Helpers: ${rows.length}, ${title}, ${TONE_WORD[tone]}`
      : `Helper: ${title}, ${TONE_WORD[tone]}`,
  };
}

/** A task's state as its mark. */
export const TASK_TONE: Record<DockBackgroundTask["state"], ServiceStatusToneId> = {
  running: "busy",
  done: "ok",
  failed: "failed",
  stopped: "off",
  lost: "off",
};

/** The others' states, in the order a reader wants them; one that never reported stopped. */
const OTHERS_ORDER = ["running", "done", "failed", "stopped"] as const;

function othersWords(tasks: ReadonlyArray<DockBackgroundTask>): string | null {
  const groups = OTHERS_ORDER.map((state) => ({
    state,
    count: tasks.filter((task) => (task.state === "lost" ? "stopped" : task.state) === state)
      .length,
  })).filter((group) => group.count > 0);
  if (groups.length === 0) return null;
  return groups
    .map(({ state, count }, index) =>
      index === 0 ? `${count} ${count === 1 ? "other" : "others"} ${state}` : `${count} ${state}`,
    )
    .join(", ");
}

export function backgroundBand(background: NonNullable<DockModel["background"]>): BandLine {
  const { tasks } = background;
  const running = tasks.filter((task) => task.state === "running");
  // The newest running, else the newest to end.
  const focus =
    newest(running) ??
    tasks.reduce<DockBackgroundTask | undefined>(
      (best, task) =>
        best === undefined || (task.endedAt ?? "") >= (best.endedAt ?? "") ? task : best,
      undefined,
    );
  const tone = focus === undefined ? "off" : TASK_TONE[focus.state];
  const title = focus?.title ?? "";
  const others = othersWords(tasks.filter((task) => task !== focus));
  return {
    tone,
    count: null,
    title,
    others,
    startedAt: focus?.startedAt ?? "",
    endedAt: focus?.endedAt ?? null,
    label: [
      `Background: ${title}`,
      TONE_WORD[tone] === "working" ? "running" : TONE_WORD[tone],
      others,
    ]
      .filter((part) => part !== null)
      .join(", "),
  };
}

/** A line of what still runs after the Mate's turn, at its card's foot (`afterWorkLines`). */
export interface AfterWorkLine {
  readonly key: string;
  readonly title: string;
  /** Whose it is, in words; none on the line that names nothing. */
  readonly word: string | undefined;
  /** It is one of its helpers': its line opens the helpers' panel. */
  readonly helper: boolean;
  /** When it started; none on the line that names nothing. */
  readonly startedAt: string | null;
  /** It counts what runs past the rows rather than naming one: no mark of its own. */
  readonly more?: true;
}

/** How many rows the card lists of what runs before it counts the rest (the helpers panel's). */
const AFTER_WORK_ROWS = 5;

const workTitle = (item: BackgroundWork["items"][number]) =>
  item.title ?? (item.of === "helper" ? "A helper" : "A background job");

/**
 * What the Mate's card says still runs after its turn, from its row's named work: a row each, as
 * the helpers panel lists them — its title, whether it is a helper or the Mate's own job, and how
 * long it has run — the first five, then how many more run. Never one line standing for several,
 * whose one time would be none of theirs (Eli, 2026-10-14: "· and 4 more — Its helpers — 2h 10m").
 * Never nothing under its head: where nothing names what runs, it finishes the work it started.
 */
export function afterWorkLines(work: BackgroundWork | undefined): ReadonlyArray<AfterWorkLine> {
  if (work === undefined || work.items.length === 0 || work.count === 0) {
    return [
      {
        key: "finishing",
        title: "Finishing work it started",
        word: undefined,
        helper: false,
        startedAt: null,
      },
    ];
  }
  const rows = work.items.slice(0, AFTER_WORK_ROWS).map((item, index): AfterWorkLine => ({
    key: `${String(index)}:${String(item.since)}`,
    title: workTitle(item),
    word: item.of === "helper" ? "Its helper" : "Its own job",
    helper: item.of === "helper",
    startedAt: new Date(item.since).toISOString(),
  }));
  const more = work.count - rows.length;
  return more <= 0
    ? rows
    : [
        ...rows,
        {
          key: "more",
          title: `and ${String(more)} more`,
          word: undefined,
          helper: false,
          startedAt: null,
          more: true,
        },
      ];
}
