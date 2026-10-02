/**
 * HQ's structure over a WebSocket (`/api/structure/ws`): `snapshot` — the whole structure as
 * `GET /api/structure` answers it, with each application's changes the reader may read
 * (`@t3tools/shared/hqChanges`) — then `change` messages, `{ key: appId, value: app | null }`,
 * each the whole application as it now is, or its going; under the key `ungrouped`, the whole list
 * of the Mates in no application; and `changes` messages, an application's changes whole, or
 * `null` once the reader may no longer read them. A reconnect starts with a fresh snapshot, so
 * nothing held from before it is needed to read it right.
 *
 * Changes are read through the contract's own schemas: changes this build cannot read are none,
 * and never take the structure beside them down.
 *
 * Pure: the messages and the folds; the client holds the socket (`client.ts`).
 *
 * @module hq/stream
 */
import { ChangesMessage, ChangesSnapshot, type HqChange } from "@t3tools/shared/hqChanges";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { HqStructure } from "./client.ts";
import { environmentsOf } from "./environments.ts";

type HqApp = HqStructure["apps"][number];
type HqUngrouped = HqStructure["ungrouped"];

/** The key a change of the Mates in no application comes under; an application's is its id. */
const UNGROUPED_KEY = "ungrouped";

/** Each application's changes, by its id: the open ones and the latest settled, newest first. */
export type HqChanges = ReadonlyMap<string, ReadonlyArray<HqChange>>;

export type HqStructureEvent =
  | {
      readonly kind: "snapshot";
      readonly structure: HqStructure;
      /** `null` where HQ sent none, or none this build can read. */
      readonly changes: HqChanges | null;
    }
  | { readonly kind: "change"; readonly appId: string; readonly app: HqApp | null }
  | { readonly kind: "ungrouped"; readonly mates: HqUngrouped }
  | {
      readonly kind: "changes";
      readonly appId: string;
      /** `null` once the reader may no longer read them. */
      readonly changes: ReadonlyArray<HqChange> | null;
    };

const readSnapshotChanges = Schema.decodeUnknownOption(ChangesSnapshot);
const readChangesMessage = Schema.decodeUnknownOption(ChangesMessage);

const isApp = (value: unknown): value is HqApp =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  Array.isArray((value as { readonly projects?: unknown }).projects);

const isUngrouped = (value: unknown): value is HqUngrouped =>
  Array.isArray(value) &&
  value.every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { readonly projectId?: unknown }).projectId === "string" &&
      typeof (entry as { readonly mate?: unknown }).mate === "object" &&
      (entry as { readonly mate?: unknown }).mate !== null,
  );

/** An application as HQ sent it, its environments read through their shape or not known. */
function appOf(value: HqApp): HqApp {
  const { environments: sent, ...app } = value as HqApp & { readonly environments?: unknown };
  const environments = sent === undefined ? undefined : environmentsOf(sent);
  return environments === undefined ? app : { ...app, environments };
}

/** A message from the socket, parsed, as a structure event; nothing for one that is not. */
export function structureEventOf(message: unknown): HqStructureEvent | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type } = message as { readonly type?: unknown };
  if (type === "snapshot") {
    const {
      apps,
      ungrouped = [],
      changes,
    } = message as {
      readonly apps?: unknown;
      readonly ungrouped?: unknown;
      readonly changes?: unknown;
    };
    // An HQ from before the Mates in no application names none of them.
    if (!(Array.isArray(apps) && apps.every(isApp) && isUngrouped(ungrouped))) return undefined;
    return {
      kind: "snapshot",
      structure: { ungrouped, apps: apps.map(appOf) },
      changes: Option.match(readSnapshotChanges(changes), {
        onNone: () => null,
        onSome: (byApp) => new Map(Object.entries(byApp)),
      }),
    };
  }
  if (type === "changes") {
    return Option.match(readChangesMessage(message), {
      onNone: () => undefined,
      onSome: ({ appId, changes }) => ({ kind: "changes", appId, changes }),
    });
  }
  if (type === "change") {
    const { key, value } = message as { readonly key?: unknown; readonly value?: unknown };
    if (typeof key !== "string") return undefined;
    if (key === UNGROUPED_KEY) {
      return isUngrouped(value) ? { kind: "ungrouped", mates: value } : undefined;
    }
    if (value === null) return { kind: "change", appId: key, app: null };
    return isApp(value) ? { kind: "change", appId: key, app: appOf(value) } : undefined;
  }
  return undefined;
}

/**
 * The structure an event leaves: a snapshot replaces it; a change replaces its application in
 * place, adds it at the end, or takes it out, and the Mates in no application all at once. A change
 * before any snapshot leaves nothing known.
 */
export function applyStructureEvent(
  structure: HqStructure | null,
  event: HqStructureEvent,
): HqStructure | null {
  if (event.kind === "snapshot") return event.structure;
  if (structure === null || event.kind === "changes") return structure;
  if (event.kind === "ungrouped") return { ...structure, ungrouped: event.mates };
  const { appId, app } = event;
  const others = structure.apps.filter((entry) => entry.id !== appId);
  if (app === null) return { ...structure, apps: others };
  const at = structure.apps.findIndex((entry) => entry.id === appId);
  return {
    ...structure,
    apps:
      at < 0
        ? [...structure.apps, app]
        : structure.apps.map((entry) => (entry.id === appId ? app : entry)),
  };
}

/**
 * The changes an event leaves: a snapshot replaces them; an application's message replaces its
 * own, or takes them out. One before any snapshot that carried changes leaves nothing known; the
 * structure's own events leave them as they are.
 */
export function applyChangesEvent(
  changes: HqChanges | null,
  event: HqStructureEvent,
): HqChanges | null {
  if (event.kind === "snapshot") return event.changes;
  if (changes === null || event.kind !== "changes") return changes;
  const next = new Map(changes);
  if (event.changes === null) next.delete(event.appId);
  else next.set(event.appId, event.changes);
  return next;
}
