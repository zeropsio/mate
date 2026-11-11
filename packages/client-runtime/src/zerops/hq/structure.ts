/**
 * HQ's structure as `GET /api/structure` answers it: the organization's applications and the Mates
 * it holds in no application — read through their shapes; what this build cannot read is none, and
 * never takes the structure beside it down. What the person may do with each is the client's own
 * verdict over their live Zerops roles, never read from here.
 *
 * Pure.
 *
 * @module hq/structure
 */
import type { MateLiveView } from "@t3tools/shared/hqMates";

import type { HqAppContents, HqBirth, HqStructure, CanonicalHqStructure } from "./client.ts";
import { canonicalEnvironmentsOf, zeropsEnvironments } from "./environments.ts";

type HqApp = CanonicalHqStructure["apps"][number];
type HqUngrouped = HqStructure["ungrouped"];

/** Each Mate HQ relays to the reader, by its project: its presence, and its overview's sections. */
export type HqMates = ReadonlyMap<string, MateLiveView>;

/**
 * The account's tools HQ lists (the old Gitea project), each read through its shape: one this build
 * cannot read is left out; none where HQ sent no list.
 */
function toolsOf(value: unknown): HqStructure["tools"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { projectId, kind } = entry as { readonly projectId?: unknown; readonly kind?: unknown };
    return typeof projectId === "string" && kind === "gitea" ? [{ projectId, kind }] : [];
  });
}

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
    can: _hint,
    environments: sent,
    births: told,
    contents: held,
    ...app
  } = value as HqApp & {
    readonly can?: unknown;
    readonly environments?: unknown;
    readonly births?: unknown;
    readonly contents?: unknown;
  };
  const environments = sent === undefined ? undefined : canonicalEnvironmentsOf(sent);
  return {
    ...app,
    projects: app.projects.map(unhinted),
    ...(environments === undefined ? {} : { environments }),
    ...(Array.isArray(told) ? { births: told.filter(isBirth) } : {}),
    ...(isContents(held) ? { contents: held } : {}),
  };
}

/** An entry without a verdict an older HQ streamed beside it: the client decides its own. */
const unhinted = <E extends { readonly can?: unknown }>({ can: _hint, ...entry }: E) => entry;

/**
 * The structure as HQ answers it (`GET /api/structure`, a snapshot): each part read through its
 * shape; none where its applications or its Mates in no application cannot be read.
 */
export function canonicalHqStructureOf(value: unknown): CanonicalHqStructure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const {
    apps,
    ungrouped = [],
    tools: listed,
  } = value as {
    readonly apps?: unknown;
    readonly ungrouped?: unknown;
    readonly tools?: unknown;
  };
  // An HQ from before the Mates in no application names none of them.
  if (!(Array.isArray(apps) && apps.every(isApp) && isUngrouped(ungrouped))) return undefined;
  const tools = toolsOf(listed);
  return {
    ...(tools === undefined ? {} : { tools }),
    ungrouped: ungrouped.map(unhinted),
    apps: apps.map(appOf),
  };
}

export function zeropsStructure(structure: CanonicalHqStructure): HqStructure {
  return {
    ...structure,
    apps: structure.apps.map(({ environments, ...app }) => ({
      ...app,
      ...(environments === undefined ? {} : { environments: zeropsEnvironments(environments) }),
    })),
  };
}
/** @deprecated Outward project DTOs for clients that have not adopted canonical selectors. */
export function hqStructureOf(value: unknown): HqStructure | undefined {
  const structure = canonicalHqStructureOf(value);
  return structure === undefined ? undefined : zeropsStructure(structure);
}
