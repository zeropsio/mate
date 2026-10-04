/**
 * HQ's structure over a WebSocket (`/api/structure/ws`): `snapshot` — the whole structure as
 * `GET /api/structure` answers it, with each application's changes the reader may read
 * (`@t3tools/shared/hqChanges`) — then `change` messages, `{ key: appId, value: app | null }`,
 * each the whole application as it now is, or its going; under the key `ungrouped`, the whole list
 * of the Mates in no application; and `changes` messages, an application's changes whole, or
 * `null` once the reader may no longer read them. The snapshot carries those applications'
 * releases, repository heads and stage/production recipes, and a
 * `release-revision` message supplies one moved application's fresh load data. A reconnect starts
 * with a fresh snapshot, so nothing held from before it is needed to read it right.
 *
 * The snapshot says, as `official`, whether HQ could check Zerops that it is the official HQ
 * (`unknown` while Zerops does not answer, which HQ serves through), and an `official` message says
 * it again each time it changes.
 *
 * The same socket carries the Mates the reader may observe (`@t3tools/shared/hqMates`): the
 * snapshot holds each of them whole, with the people the view names; a `mate` message, what
 * changed of one Mate, or `null` once the reader may no longer observe it; a `people` message, the
 * people map whole. Their fold is `mates.ts`.
 *
 * Changes and Mates are read through the contract's own schemas: what this build cannot read is
 * none, and never takes the structure beside it down; a field it does not know is passed by.
 *
 * Pure: the messages and the folds; the client holds the socket (`client.ts`).
 *
 * @module hq/stream
 */
import { ChangesMessage, ChangesSnapshot, type HqChange } from "@t3tools/shared/hqChanges";
import { AppReads, ReleaseRevisionMessage, type AppRead } from "@t3tools/shared/hqAppReads";
import {
  HqMatesMessage,
  HqPeople,
  MateLiveView,
  type MateLiveChange,
} from "@t3tools/shared/hqMates";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { HqAppContents, HqBirth, HqStructure } from "./client.ts";
import { environmentsOf } from "./environments.ts";

type HqApp = HqStructure["apps"][number];
type HqUngrouped = HqStructure["ungrouped"];

/** The key a change of the Mates in no application comes under; an application's is its id. */
const UNGROUPED_KEY = "ungrouped";

/** Each application's changes, by its id: the open ones and the latest settled, newest first. */
export type HqChanges = ReadonlyMap<string, ReadonlyArray<HqChange>>;

/** Each Mate the reader may observe, by its project: its presence, and its overview's sections. */
export type HqMates = ReadonlyMap<string, MateLiveView>;

/**
 * HQ-owned load data for each readable application, by id.
 */
export type HqAppReads = ReadonlyMap<string, AppRead>;

export type HqStructureEvent =
  | {
      readonly kind: "snapshot";
      readonly structure: HqStructure;
      /** `null` where HQ sent none, or none this build can read. */
      readonly changes: HqChanges | null;
      /** `null` until a snapshot with readable load data arrives. */
      readonly appReads: HqAppReads | null;
      /** `null` where HQ sent none — an HQ from before the Mates' overviews — or none readable. */
      readonly mates: HqMates | null;
      readonly people: HqPeople | null;
      /**
       * Whether HQ is the official one as its last check of Zerops said
       * (`@t3tools/shared/hqStream` `HqOfficialVerdict`); `null` before the Core's first check,
       * absent from a Core whose stream does not say it.
       */
      readonly official?: string | null;
      /** The Core HQ runs, as its bundle stamps it; absent from a Core whose stream does not name it. */
      readonly build?: string;
    }
  | { readonly kind: "official"; readonly official: string | null }
  | { readonly kind: "change"; readonly appId: string; readonly app: HqApp | null }
  | { readonly kind: "ungrouped"; readonly mates: HqUngrouped }
  | {
      readonly kind: "changes";
      readonly appId: string;
      /** `null` once the reader may no longer read them. */
      readonly changes: ReadonlyArray<HqChange> | null;
    }
  | {
      readonly kind: "mate";
      readonly projectId: string;
      /** What changed of it, each part whole; `null` once the reader may no longer observe it. */
      readonly value: MateLiveChange | null;
    }
  | { readonly kind: "people"; readonly people: HqPeople }
  | {
      readonly kind: "release-revision";
      readonly appId: string;
      /** `null` once the reader may no longer read this application. */
      readonly read: AppRead | null;
    };

const readSnapshotChanges = Schema.decodeUnknownOption(ChangesSnapshot);
const readChangesMessage = Schema.decodeUnknownOption(ChangesMessage);
const readAppReads = Schema.decodeUnknownOption(AppReads);
const readReleaseRevisionMessage = Schema.decodeUnknownOption(ReleaseRevisionMessage);
const readMateView = Schema.decodeUnknownOption(MateLiveView);
const readPeople = Schema.decodeUnknownOption(HqPeople);
const readMatesMessage = Schema.decodeUnknownOption(HqMatesMessage);

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

/** A birth intent as HQ sent it: one whose shape this build cannot read is none. */
const isBirth = (value: unknown): value is HqBirth =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { readonly id?: unknown }).id === "string" &&
  typeof (value as { readonly face?: unknown }).face === "string";

const isContents = (value: unknown): value is HqAppContents => {
  if (typeof value !== "object" || value === null) return false;
  const { empty, deletingProjectIds } = value as {
    readonly empty?: unknown;
    readonly deletingProjectIds?: unknown;
  };
  return (
    typeof empty === "boolean" &&
    Array.isArray(deletingProjectIds) &&
    deletingProjectIds.every((id: unknown) => typeof id === "string") &&
    (!empty || deletingProjectIds.length === 0)
  );
};

/**
 * An application as HQ sent it, its environments read through their shape or not known, and each
 * of its birth intents read through its own.
 */
function appOf(value: HqApp): HqApp {
  const {
    environments: sent,
    births: told,
    contents: held,
    ...app
  } = value as HqApp & {
    readonly environments?: unknown;
    readonly births?: unknown;
    readonly contents?: unknown;
  };
  const environments = sent === undefined ? undefined : environmentsOf(sent);
  return {
    ...app,
    ...(environments === undefined ? {} : { environments }),
    ...(Array.isArray(told) ? { births: told.filter(isBirth) } : {}),
    ...(isContents(held) ? { contents: held } : {}),
  };
}

/** The Mates a snapshot sent, each read on its own: one this build cannot read is left out. */
function matesOf(sent: unknown): HqMates | null {
  if (typeof sent !== "object" || sent === null || Array.isArray(sent)) return null;
  const mates = new Map<string, MateLiveView>();
  for (const [projectId, view] of Object.entries(sent)) {
    const read = readMateView(view);
    if (Option.isSome(read)) mates.set(projectId, read.value);
  }
  return mates;
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
      appReads,
      mates,
      people,
      official,
      build,
    } = message as {
      readonly apps?: unknown;
      readonly ungrouped?: unknown;
      readonly changes?: unknown;
      readonly appReads?: unknown;
      readonly mates?: unknown;
      readonly people?: unknown;
      readonly official?: unknown;
      readonly build?: unknown;
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
      appReads: Option.match(readAppReads(appReads), {
        onNone: () => null,
        onSome: (byApp) => new Map(Object.entries(byApp)),
      }),
      mates: matesOf(mates),
      people: Option.getOrNull(readPeople(people)),
      ...(typeof official === "string" || official === null ? { official } : {}),
      ...(typeof build === "string" ? { build } : {}),
    };
  }
  if (type === "official") {
    const { official } = message as { readonly official?: unknown };
    return typeof official === "string" || official === null
      ? { kind: "official", official }
      : undefined;
  }
  if (type === "mate" || type === "people") {
    return Option.match(readMatesMessage(message), {
      onNone: () => undefined,
      onSome: (read): HqStructureEvent =>
        read.type === "mate"
          ? { kind: "mate", projectId: read.projectId, value: read.value }
          : { kind: "people", people: read.people },
    });
  }
  if (type === "changes") {
    return Option.match(readChangesMessage(message), {
      onNone: () => undefined,
      onSome: ({ appId, changes }) => ({ kind: "changes", appId, changes }),
    });
  }
  if (type === "release-revision") {
    return Option.match(readReleaseRevisionMessage(message), {
      onNone: () => undefined,
      onSome: ({ appId, read }) => ({ kind: "release-revision", appId, read }),
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
 * before any snapshot leaves nothing known; changes and the Mates' messages leave it as it is.
 */
export function applyStructureEvent(
  structure: HqStructure | null,
  event: HqStructureEvent,
): HqStructure | null {
  if (event.kind === "snapshot") return event.structure;
  if (structure === null) return null;
  if (event.kind === "ungrouped") return { ...structure, ungrouped: event.mates };
  if (event.kind !== "change") return structure;
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

/**
 * The application facts an event leaves: the snapshot establishes coverage, and a message
 * replaces one app or removes it on access loss. Unrelated apps retain their object identity.
 */
export function applyAppReadsEvent(
  reads: HqAppReads | null,
  event: HqStructureEvent,
): HqAppReads | null {
  // A revalidation failure keeps what this identity already knew, marked with its failure.
  const retain = (appId: string, read: AppRead): AppRead =>
    read.value === null && read.failure !== null
      ? { ...read, value: reads?.get(appId)?.value ?? null }
      : read;
  if (event.kind === "snapshot") {
    return event.appReads === null
      ? null
      : new Map([...event.appReads].map(([appId, read]) => [appId, retain(appId, read)]));
  }
  if (reads === null || event.kind !== "release-revision") return reads;
  const next = new Map(reads);
  if (event.read === null) next.delete(event.appId);
  else next.set(event.appId, retain(event.appId, event.read));
  return next;
}
