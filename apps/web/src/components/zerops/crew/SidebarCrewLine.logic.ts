/**
 * A crew as one line under its Mate in the left menu (pass 16, M14): every
 * crewmate's face, the lead first, and the crew's one most urgent fact — who
 * needs you, or whose finished work waits for your review, or nothing.
 *
 * Every word comes from `crew/phrases.ts` (R5); a face's state is its
 * thread's, through the one mapping (`mateMarkStateForThreadStatus`).
 */
import { crewLineNeedsWord, crewLineReadyWord } from "@t3tools/client-runtime/zerops/crew/phrases";
import type { CrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import type { CrewAttention, ThreadId } from "@t3tools/contracts";
import type { MateMarkState, MateTintId } from "@t3tools/shared/brand";
import { mateMarkStateForThreadStatus } from "@t3tools/shared/threadStatus";

export interface CrewLineFace {
  readonly handle: string;
  readonly displayName: string;
  readonly tint: MateTintId;
  /** Its thread's face; idle before its first turn. */
  readonly state: MateMarkState;
  /** Its chat, which the face opens; `null` before its first turn. */
  readonly threadId: ThreadId | null;
  readonly lead: boolean;
}

export type CrewLineFact =
  /** Crewmates wait on the person: a question, an approval, a plan, a stop to decide. */
  | { readonly kind: "needs"; readonly words: string }
  /** Finished work waits for the person's review; *Review* opens the first. */
  | { readonly kind: "land"; readonly words: string; readonly taskId: string };

export function crewLine(
  view: Pick<CrewView, "crewmates" | "tasks" | "personLands">,
  attention: ReadonlyArray<Pick<CrewAttention, "kind" | "handle">>,
): { readonly faces: ReadonlyArray<CrewLineFace>; readonly fact: CrewLineFact | null } {
  const faces = view.crewmates.map((row): CrewLineFace => ({
    handle: row.crewmate.handle,
    displayName: row.crewmate.displayName,
    tint: row.crewmate.tint,
    state: row.status === null ? "idle" : mateMarkStateForThreadStatus(row.status.kind),
    threadId: row.crewmate.currentThreadId,
    lead: row.crewmate.kind === "lead",
  }));
  // Who needs you: a crewmate whose face says so, or whom the crew's
  // *Waiting on you* list names for anything but a task ready to land — that
  // one is the next fact's. In the crew's own order, the lead first.
  const waiting = new Set(
    attention.flatMap((row) =>
      row.handle === null || row.kind === "ready-to-land" ? [] : [row.handle],
    ),
  );
  const needs = faces.filter((face) => face.state === "needs" || waiting.has(face.handle));
  if (needs.length > 0) {
    return {
      faces,
      fact: { kind: "needs", words: crewLineNeedsWord(needs.map((face) => face.displayName)) },
    };
  }
  // Finished work waits for your review while the crew does not put it in
  // itself (`crewPersonLands`): no run on, or a run that waits for you.
  const ready = view.personLands ? view.tasks.filter((row) => row.task.state === "ready") : [];
  const first = ready[0];
  return {
    faces,
    fact:
      first === undefined
        ? null
        : {
            kind: "land",
            words: crewLineReadyWord(
              ready.map((row) => row.owner?.crewmate.displayName ?? row.task.owner),
            ),
            taskId: first.task.id,
          },
  };
}
