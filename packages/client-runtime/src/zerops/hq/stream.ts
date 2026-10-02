/**
 * HQ's structure over a WebSocket (`/api/structure/ws`): `snapshot` — the whole structure as
 * `GET /api/structure` answers it — then `change` messages, `{ key: appId, value: app | null }`,
 * each the whole application as it now is, or its going; under the key `ungrouped`, the whole list
 * of the Mates in no application. A reconnect starts with a fresh snapshot, so nothing held from
 * before it is needed to read it right.
 *
 * Pure: the messages and the fold; the client holds the socket (`client.ts`).
 *
 * @module hq/stream
 */
import type { HqStructure } from "./client.ts";

type HqApp = HqStructure["apps"][number];
type HqUngrouped = HqStructure["ungrouped"];

/** The key a change of the Mates in no application comes under; an application's is its id. */
const UNGROUPED_KEY = "ungrouped";

export type HqStructureEvent =
  | { readonly kind: "snapshot"; readonly structure: HqStructure }
  | { readonly kind: "change"; readonly appId: string; readonly app: HqApp | null }
  | { readonly kind: "ungrouped"; readonly mates: HqUngrouped };

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

/** A message from the socket, parsed, as a structure event; nothing for one that is not. */
export function structureEventOf(message: unknown): HqStructureEvent | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { type } = message as { readonly type?: unknown };
  if (type === "snapshot") {
    const { apps, ungrouped = [] } = message as {
      readonly apps?: unknown;
      readonly ungrouped?: unknown;
    };
    // An HQ from before the Mates in no application names none of them.
    return Array.isArray(apps) && apps.every(isApp) && isUngrouped(ungrouped)
      ? { kind: "snapshot", structure: { ungrouped, apps } }
      : undefined;
  }
  if (type === "change") {
    const { key, value } = message as { readonly key?: unknown; readonly value?: unknown };
    if (typeof key !== "string") return undefined;
    if (key === UNGROUPED_KEY) {
      return isUngrouped(value) ? { kind: "ungrouped", mates: value } : undefined;
    }
    if (value === null) return { kind: "change", appId: key, app: null };
    return isApp(value) ? { kind: "change", appId: key, app: value } : undefined;
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
  if (structure === null) return null;
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
