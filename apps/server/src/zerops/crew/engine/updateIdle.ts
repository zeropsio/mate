/**
 * The engine crew's part in an update's drain: what in its own record still holds an update back.
 * The crew's work and requests read as V1's do (`crewUpdateBlockers`); its turns, carry-ons and
 * effects in flight are its own record's.
 */
import type { CrewOperation, CrewRunState, CrewTaskState } from "@t3tools/contracts";

import type { UpdateIdleFacts } from "../../../update/MateUpdateDrain.ts";
import { crewUpdateBlockers } from "../crewUpdateIdle.ts";

export interface CrewUpdateRecord {
  readonly effects: Readonly<Record<string, unknown>>;
  readonly members: Readonly<
    Record<string, { readonly active: unknown | null; readonly carryOn: unknown | null }>
  >;
}

export interface CrewUpdateFrame {
  readonly run: { readonly state: CrewRunState } | null;
  readonly board: { readonly tasks: ReadonlyArray<{ readonly state: CrewTaskState }> };
  readonly operations?: ReadonlyArray<Pick<CrewOperation, "status">> | undefined;
}

export const crewEngineUpdateFacts = (
  record: CrewUpdateRecord,
  frame: CrewUpdateFrame,
): UpdateIdleFacts => {
  const blockers = [
    ...crewUpdateBlockers({
      active: Object.keys(record.effects).length,
      run: frame.run?.state,
      tasks: frame.board.tasks,
      operations: frame.operations ?? [],
    }),
  ];
  if (
    Object.values(record.members).some(
      (member) => member.active !== null || member.carryOn !== null,
    )
  )
    blockers.push("crew turn or continuation");
  return { idle: blockers.length === 0, blockers };
};
