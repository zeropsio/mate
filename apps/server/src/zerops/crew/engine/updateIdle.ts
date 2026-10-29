/**
 * The engine crew's part in an update's drain: only work in flight holds an update back — an
 * effect, a crewmate's turn or carry-on, a running operation. The run and its board are the crew's
 * record: a run waiting on its person, a queued task or an open question outlives the restart as it
 * stands, so it never holds an update, however long the person takes.
 */
import type { CrewOperation } from "@t3tools/contracts";

import type { UpdateIdleFacts } from "../../../update/MateUpdateDrain.ts";

export interface CrewUpdateRecord {
  readonly effects: Readonly<Record<string, unknown>>;
  readonly members: Readonly<
    Record<string, { readonly active: unknown | null; readonly carryOn: unknown | null }>
  >;
}

export interface CrewUpdateFrame {
  readonly operations?: ReadonlyArray<Pick<CrewOperation, "status">> | undefined;
}

export const crewEngineUpdateFacts = (
  record: CrewUpdateRecord,
  frame: CrewUpdateFrame,
): UpdateIdleFacts => {
  const blockers: string[] = [];
  if (Object.keys(record.effects).length > 0) blockers.push("crew process or callback");
  if ((frame.operations ?? []).some((operation) => operation.status === "running"))
    blockers.push("crew operation running");
  if (
    Object.values(record.members).some(
      (member) => member.active !== null || member.carryOn !== null,
    )
  )
    blockers.push("crew turn or continuation");
  return { idle: blockers.length === 0, blockers };
};
