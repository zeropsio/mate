// The processes the account holds of one project and how current they are: the shapes
// `data/projections/processes.ts` derives and the candidates rule reads.
import type { ActivityProcess } from "./activity/dto.ts";
import type { HistoryRead } from "./activity/historyRead.ts";
import type { UnavailableReason } from "./scopeFreshness.ts";

/** A process as the platform's whole row says it: identity, status, pipeline, its end. */
export type ProcessValue = ActivityProcess;

export interface ProjectProcesses {
  /** Known rows before active-list filtering; missing membership proves no terminal outcome. */
  readonly retained: ReadonlyArray<ProcessValue> | undefined;
  /** Every process held of the project, newest first; `undefined` before the first read. */
  readonly processes: ReadonlyArray<ProcessValue> | undefined;
  /** Those that run now, as the organization's running work lists them, newest first. */
  readonly running: ReadonlyArray<ProcessValue>;
  /** The organization's running work is observed live now. */
  readonly live: boolean;
  /** Read before and not live now: what is held stays, catching up. */
  readonly reconnecting: boolean;
  /** The organization's running work was refused: why. */
  readonly unavailableReason?: UnavailableReason;
  readonly history: HistoryRead;
}
