/**
 * crewNotes — what the engine did once and must not do again after a
 * restart, kept in the crew log beside the engine's memory: the one nudge an
 * attempt gets, each wake of the lead (and so the run's wake count), a
 * question the lead passed on to the person, the lead's own question
 * until the person answers it, an *Allow* waiting on its crewmate's turn,
 * and each turn's cost as counted. The engine rebuilds its memory from them
 * when it starts.
 *
 * @module crewNotes
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { asRefusal, type CrewCore, type EngineMemory } from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";

export type CrewNote =
  | { readonly kind: "nudged"; readonly key: string }
  | { readonly kind: "lead-woken"; readonly key: string }
  | { readonly kind: "escalated"; readonly key: string }
  | { readonly kind: "lead-asked"; readonly handle: string; readonly text: string }
  | { readonly kind: "lead-answered"; readonly handle: string }
  | { readonly kind: "grant-waiting"; readonly host: string; readonly principal: TurnPrincipal }
  | { readonly kind: "grant-settled"; readonly host: string }
  | {
      readonly kind: "turn-cost";
      readonly threadId: string;
      readonly turnId: string;
      readonly total: number;
    };

const NOTE_KINDS: ReadonlyArray<CrewNote["kind"]> = [
  "nudged",
  "lead-woken",
  "escalated",
  "lead-asked",
  "lead-answered",
  "grant-waiting",
  "grant-settled",
  "turn-cost",
];

const NotePayload = Schema.Struct({
  key: Schema.optional(Schema.String),
  handle: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
  total: Schema.optional(Schema.Number),
  principal: Schema.optional(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("session"), subject: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("crew"), startedBy: Schema.String }),
    ]),
  ),
});
const decodePayload = Schema.decodeUnknownOption(NotePayload);

const apply = (memory: EngineMemory, note: CrewNote, run: string | null, at: string) => {
  switch (note.kind) {
    case "nudged":
      memory.nudged.add(note.key);
      return;
    case "lead-woken":
      memory.woken.add(note.key);
      memory.lastWakeAt = Math.max(memory.lastWakeAt ?? 0, Date.parse(at));
      if (run !== null) memory.wakeCounts.set(run, (memory.wakeCounts.get(run) ?? 0) + 1);
      return;
    case "escalated":
      memory.escalated.add(note.key);
      return;
    case "lead-asked":
      memory.leadQuestions.set(note.handle, { text: note.text, at });
      return;
    case "lead-answered":
      memory.leadQuestions.delete(note.handle);
      return;
    case "grant-waiting":
      memory.grantsWaiting.set(note.host, note.principal);
      return;
    case "grant-settled":
      memory.grantsWaiting.delete(note.host);
      return;
    case "turn-cost":
      memory.costedTurns.add(note.turnId);
      memory.costSeen.set(
        note.threadId,
        Math.max(memory.costSeen.get(note.threadId) ?? 0, note.total),
      );
      return;
  }
};

/** Records `note` in memory and in the crew log. */
export const remember = (core: CrewCore, note: CrewNote, run: string | null) =>
  Effect.gen(function* () {
    const at = yield* core.now;
    apply(core.memory, note, run, at);
    const { kind, ...payload } = note;
    yield* asRefusal(core.store.appendLog({ crew: CREW_ID, run, at, kind, payload }));
  });

/** Rebuilds the engine's memory of what it did once, from the crew log. */
export const restoreNotes = (core: CrewCore) =>
  Effect.gen(function* () {
    const entries = yield* asRefusal(core.store.logOf(CREW_ID, NOTE_KINDS));
    for (const entry of entries) {
      const payload = Option.getOrUndefined(decodePayload(entry.payload));
      const note = noteOf(entry.kind, payload);
      if (note !== undefined) apply(core.memory, note, entry.run, entry.at);
    }
  });

const noteOf = (
  kind: string,
  payload: typeof NotePayload.Type | undefined,
): CrewNote | undefined => {
  switch (kind) {
    case "nudged":
    case "lead-woken":
    case "escalated":
      return payload?.key === undefined ? undefined : { kind, key: payload.key };
    case "lead-asked":
      return payload?.handle === undefined || payload.text === undefined
        ? undefined
        : { kind, handle: payload.handle, text: payload.text };
    case "lead-answered":
      return payload?.handle === undefined ? undefined : { kind, handle: payload.handle };
    case "grant-waiting":
      return payload?.host === undefined || payload.principal === undefined
        ? undefined
        : { kind, host: payload.host, principal: payload.principal };
    case "grant-settled":
      return payload?.host === undefined ? undefined : { kind, host: payload.host };
    case "turn-cost":
      return payload?.threadId === undefined ||
        payload.turnId === undefined ||
        payload.total === undefined
        ? undefined
        : { kind, threadId: payload.threadId, turnId: payload.turnId, total: payload.total };
    default:
      return undefined;
  }
};
