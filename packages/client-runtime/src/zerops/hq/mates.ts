/**
 * The Mates a reader observes, as HQ's structure socket leaves them (`stream.ts`): every one the
 * reader may observe (`observe_mate`), by its project — its presence, and its overview's sections
 * where HQ holds one (`@t3tools/shared/hqMates`) — and the people the reader's view names.
 *
 * Pure: the fold over the socket's events; whoever holds the socket keeps what it leaves.
 *
 * @module hq/mates
 */
import type { HqPeople } from "@t3tools/shared/hqMates";

import type { HqMates, HqStructureEvent } from "./stream.ts";

/**
 * The Mates an event leaves: a snapshot replaces them all; a Mate's message replaces each part it
 * names whole, keeping the rest, or takes the Mate out once the reader may no longer observe it.
 * A Mate the reader may newly observe comes whole, its presence with it; sections without one are
 * no Mate to hold. One before any snapshot that carried Mates leaves nothing known.
 */
export function applyMatesEvent(mates: HqMates | null, event: HqStructureEvent): HqMates | null {
  if (event.kind === "snapshot") return event.mates;
  if (mates === null || event.kind !== "mate") return mates;
  const held = mates.get(event.projectId);
  if (event.value === null) {
    if (held === undefined) return mates;
    const next = new Map(mates);
    next.delete(event.projectId);
    return next;
  }
  const presence = event.value.presence ?? held?.presence;
  if (presence === undefined) return mates;
  return new Map(mates).set(event.projectId, { ...held, ...event.value, presence });
}

/** The people an event leaves: a snapshot and the people's own message each carry them whole. */
export function applyPeopleEvent(
  people: HqPeople | null,
  event: HqStructureEvent,
): HqPeople | null {
  if (event.kind === "snapshot" || event.kind === "people") return event.people;
  return people;
}
