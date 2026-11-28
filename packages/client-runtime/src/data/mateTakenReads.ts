import { Atom } from "effect/reactivity";

import { mateEngineHostAtom } from "./engineHost.ts";
import { sameValue } from "./projections/equal.ts";
import { engineRows } from "./projections/mateEngine.ts";

const NONE: ReadonlyArray<string> = [];

/**
 * The Board tasks a Mate's conversations (by its environment) were opened for, off the rows this
 * page's own socket holds (`ConversationRow.takenTask`): HQ's relay of them is never read for it,
 * since the HQ that relays them may drop a key it does not know.
 */
export const mateTakenTasksAtom = Atom.family((environmentId: string) =>
  Atom.make((get): ReadonlyArray<string> => {
    const engine = get(mateEngineHostAtom);
    if (engine === null) return NONE;
    const carried = get(engine.store.data.project(engineRows, environmentId)).flatMap((row) =>
      row.takenTask === undefined ? [] : [row.takenTask],
    );
    return carried.length === 0 ? NONE : carried;
  }).pipe(Atom.withEquality(sameValue)),
);
