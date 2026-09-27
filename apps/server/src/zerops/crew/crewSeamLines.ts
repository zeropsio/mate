/**
 * crewSeamLines — the seam lines of a crewmate's chat that no card carries
 * (PRD §4.5, design-system *Seams*): a landing, a save that reaches the
 * conversation later, and the reason of a conversation opened between turns.
 * Each is a thread activity of kind `crew.seam` on the conversation the
 * person reads at that moment, its `summary` the line's words and its
 * payload a `CrewSeam`.
 *
 * A seam line never fails the press that wrote it: the landing or the save
 * stands, and a line that could not be written is the section's last error.
 *
 * @module crewSeamLines
 */
import {
  CommandId,
  CREW_SEAM_ACTIVITY_KIND,
  EventId,
  ThreadId,
  type CrewSeam,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { asRefusal, type CrewCore } from "./crewCore.ts";

export const appendSeam = (core: CrewCore, threadId: string, words: string, seam: CrewSeam) =>
  Effect.gen(function* () {
    const id = yield* core.uuid;
    const now = yield* core.now;
    yield* asRefusal(
      core.orchestration.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`crew:seam:${id}`),
        threadId: ThreadId.make(threadId),
        activity: {
          id: EventId.make(`crew-seam-${id}`),
          tone: "info",
          kind: CREW_SEAM_ACTIVITY_KIND,
          summary: words,
          payload: seam,
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        core.memory.lastError = error.message;
      }).pipe(Effect.andThen(core.changed)),
    ),
  );
