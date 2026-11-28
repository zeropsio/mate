import { Atom } from "effect/reactivity";

import { mateEngineHostAtom } from "./engineHost.ts";
import { sameValue } from "./projections/equal.ts";
import { engineRows } from "./projections/mateEngine.ts";

/** A Board task a person took, and the conversation of their Mate opened for it. */
export interface TakenConversation {
  readonly taskId: string;
  readonly conversationId: string;
}

const NONE: ReadonlyArray<TakenConversation> = [];

/**
 * The Board tasks a Mate's conversations (by its environment) were opened for, each with the
 * conversation that carries it, off the rows this page's own socket holds
 * (`ConversationRow.takenTask`): HQ's relay of them is never read for it, since the HQ that relays
 * them may drop a key it does not know.
 */
export const mateTakenTasksAtom = Atom.family((environmentId: string) =>
  Atom.make((get): ReadonlyArray<TakenConversation> => {
    const engine = get(mateEngineHostAtom);
    if (engine === null) return NONE;
    const carried = get(engine.store.data.project(engineRows, environmentId)).flatMap((row) =>
      row.takenTask === undefined
        ? []
        : [{ taskId: row.takenTask, conversationId: row.conversationId }],
    );
    return carried.length === 0 ? NONE : carried;
  }).pipe(Atom.withEquality(sameValue)),
);
