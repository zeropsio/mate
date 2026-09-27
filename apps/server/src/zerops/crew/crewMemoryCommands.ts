/**
 * crewMemoryCommands — the person's presses on a crewmate's memory (PRD §5.6
 * *Reset and memory*): edit one entry, remove one, or *Forget memory*, which
 * clears every entry and never touches the copy or the tasks.
 *
 * @module crewMemoryCommands
 */
import * as Effect from "effect/Effect";

import { asRefusal, refuse, requireApplied, requireMember, type CrewCore } from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";

const requireEntry = (core: CrewCore, handle: string, entryId: string) =>
  Effect.gen(function* () {
    yield* requireMember(yield* requireApplied(core), handle);
    const entry = (yield* asRefusal(core.store.memory(CREW_ID, handle))).find(
      (row) => row.id === entryId,
    );
    if (entry === undefined) {
      return yield* refuse("wrong-state", `@${handle} has no memory entry ${entryId}`);
    }
    return entry;
  });

export const editMemory = (core: CrewCore, handle: string, entryId: string, text: string) =>
  Effect.gen(function* () {
    const entry = yield* requireEntry(core, handle, entryId);
    yield* asRefusal(core.store.putMemory({ ...entry, text, updatedAt: yield* core.now }));
  });

export const removeMemory = (core: CrewCore, handle: string, entryId: string) =>
  Effect.gen(function* () {
    yield* requireEntry(core, handle, entryId);
    yield* asRefusal(core.store.deleteMemory(CREW_ID, handle, entryId));
  });

/** *Forget memory*: every entry of the crewmate, and nothing else. */
export const forgetMemory = (core: CrewCore, handle: string) =>
  Effect.gen(function* () {
    yield* requireMember(yield* requireApplied(core), handle);
    yield* asRefusal(core.store.clearMemory(CREW_ID, handle));
  });

/** A landed task's handoff is spent: the next task starts without it. */
export const dropHandoff = (core: CrewCore, handle: string, assignment: string) =>
  Effect.gen(function* () {
    for (const entry of yield* asRefusal(core.store.memory(CREW_ID, handle))) {
      if (entry.kind === "handoff" && entry.fromAssignment === assignment) {
        yield* asRefusal(core.store.deleteMemory(CREW_ID, handle, entry.id));
      }
    }
  });
