/**
 * The conversation as an owner kind: its rules (`decide`), its fold (`evolve`), its record's codec
 * and its projections. It owns every id no other kind claims, except the crew's (`crew/…`).
 *
 * @module engine/conversationDomain
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { EngineEvent, KnownEngineEvent } from "@t3tools/contracts";

import type { Domain } from "./owners.ts";
import { projectConversation } from "./store/conversationProjections.ts";
import type { Command, EventDraft } from "./domain/command.ts";
import { decide } from "./domain/decide.ts";
import { evolve } from "./domain/evolve.ts";
import { STATE_VERSION, initialState, type ConversationState } from "./domain/state.ts";

const decodeEvent = Schema.decodeUnknownEffect(EngineEvent);
const encodeEvent = Schema.encodeUnknownEffect(KnownEngineEvent);

/** The crew's ids: never a conversation's. */
const CREW_PREFIX = "crew/";

export const conversationDomain: Domain<ConversationState, Command, EngineEvent, EventDraft> = {
  kind: "conversation",
  owns: (owner) => !owner.startsWith(CREW_PREFIX),
  stateVersion: STATE_VERSION,
  initial: initialState,
  decide,
  evolve,
  decode: (row) => decodeEvent(row),
  encode: (event) => encodeEvent(event),
  project: (event, state) =>
    event._tag === "Unknown" ? Effect.void : projectConversation(event, state),
  rowAgent: (state) => state.agent,
  runOf: (event) => ("runId" in event && typeof event.runId === "string" ? event.runId : null),
};
