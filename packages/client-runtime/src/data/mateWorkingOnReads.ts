import type { ConversationRow, ConversationWorkingOn } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { mateEngineHostAtom } from "./engineHost.ts";
import { sameValue } from "./projections/equal.ts";
import { engineRows } from "./projections/mateEngine.ts";
import { hqMateOverviewAtom } from "./reads.ts";

const NONE: ReadonlyArray<ConversationWorkingOn> = [];

/** What a Mate's conversations work on for a page, read off their rows (`workingOn`). */
export function workedOn(
  rows: ReadonlyArray<Pick<ConversationRow, "workingOn">>,
): ReadonlyArray<ConversationWorkingOn> {
  const on = rows.flatMap((row) => (row.workingOn === undefined ? [] : [row.workingOn]));
  return on.length === 0 ? NONE : on;
}

/**
 * What a Mate (by its project) works on for its person's pages — a change a review asked it to
 * update or fix — from its conversations' rows: its own socket's where this page holds them, else
 * the ones its overview relays through HQ, so every device and a reload read the same.
 */
export const mateWorkingOnAtom = Atom.family((projectId: string) =>
  Atom.make((get): ReadonlyArray<ConversationWorkingOn> => {
    const overview = get(hqMateOverviewAtom(projectId));
    const environmentId = overview?.identity?.environmentId;
    const engine = get(mateEngineHostAtom);
    const own =
      engine === null || environmentId === undefined
        ? []
        : get(engine.store.data.project(engineRows, environmentId));
    return workedOn(own.length > 0 ? own : (overview?.conversations ?? []));
  }).pipe(Atom.withEquality(sameValue)),
);
