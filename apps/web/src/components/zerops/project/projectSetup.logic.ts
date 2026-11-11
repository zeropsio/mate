/**
 * What the project page's side column says of what is set up once: who reaches the project, what
 * it cost, its automated Mates. Each a line, never a section of its own.
 */
import type { AccessTableView } from "../projects/accessTable.logic";
import { formatUsd } from "../projects/projectSpend.logic";

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** Who reaches the project, in a line: "16 people". `null` while it is read or where Zerops shows none. */
export function peopleSummary(view: AccessTableView): string | null {
  return view.kind === "table" ? plural(view.rows.length, "person", "people") : null;
}

/** The spend line beside the figure: "last 30 days · $1.18 a day". */
export function spendDaily(averageUsd: number, days: number): string {
  return `last ${String(days)} days · ${formatUsd(averageUsd)} a day`;
}

/**
 * The automation line, where the project has automated Mates: how many, and how many are at a
 * task or wait on a person's answer.
 */
export function automationSummary(
  pool: ReadonlyArray<{
    readonly automation: {
      readonly task: {
        readonly waiting?: true | undefined;
        readonly done?: true | undefined;
      } | null;
    };
  }>,
): string {
  const atWork = pool.filter(
    ({ automation: { task } }) => task !== null && task.waiting !== true && task.done !== true,
  ).length;
  const waiting = pool.filter(({ automation }) => automation.task?.waiting === true).length;
  return [
    plural(pool.length, "automated Mate", "automated Mates"),
    ...(atWork > 0 ? [`${String(atWork)} at work`] : []),
    ...(waiting > 0 ? [`${String(waiting)} waiting on an answer`] : []),
  ].join(" · ");
}
