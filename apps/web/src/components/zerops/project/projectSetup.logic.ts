/**
 * What the project page's side column says of what is set up once: who reaches the project and what
 * it cost. Each a line, never a section of its own.
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
