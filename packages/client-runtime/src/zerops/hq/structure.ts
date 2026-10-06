/**
 * HQ's structure as `GET /api/structure` answers it: its applications as the reader sees them in
 * Zerops, the Mates it holds in no application, and what the reader may do with each — read through
 * their shapes; what this build cannot read is none, and never takes the structure beside it down.
 *
 * Pure.
 *
 * @module hq/structure
 */
import { HqOffers } from "@t3tools/shared/hqOffers";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { HqAppContents, HqBirth, HqStructure } from "./client.ts";
import { environmentsOf } from "./environments.ts";

type HqApp = HqStructure["apps"][number];
type HqUngrouped = HqStructure["ungrouped"];

/** Each Mate HQ relays to the reader, by its project: its presence, and its overview's sections. */
export type HqMates = ReadonlyMap<string, MateLiveView>;

const readOffers = Schema.decodeUnknownOption(HqOffers);

/** A `can` record as HQ sent it; none where it sent none this build can read. */
const offersOf = (value: unknown): HqOffers | undefined => Option.getOrUndefined(readOffers(value));

/** A Mate's entry, its offers and moves read through their shapes: one unreadable is unknown. */
function mateOffersOf<E extends { readonly can?: unknown }>(
  entry: E,
): Omit<E, "can"> & { readonly can?: HqOffers } {
  const { can: offered, ...rest } = entry;
  const can = offersOf(offered);
  return {
    ...rest,
    ...(can === undefined ? {} : { can }),
  };
}

/** Each project HQ holds nowhere with its offers, each read on its own. */
function unheldOf(value: unknown): Readonly<Record<string, HqOffers>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([projectId, offered]) => {
      const can = offersOf(offered);
      return can === undefined ? [] : [[projectId, can] as const];
    }),
  );
}

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

/** Environments HQ refused the reader, with its reason; none where HQ sent them. */
function refusedOf(value: unknown): { readonly refused: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { refused } = value as { readonly refused?: unknown };
  return typeof refused === "string" ? { refused } : undefined;
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
    can: offered,
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
  const environments = sent === undefined ? undefined : (refusedOf(sent) ?? environmentsOf(sent));
  const can = offersOf(offered);
  return {
    ...app,
    projects: app.projects.map(mateOffersOf),
    ...(can === undefined ? {} : { can }),
    ...(environments === undefined ? {} : { environments }),
    ...(Array.isArray(told) ? { births: told.filter(isBirth) } : {}),
    ...(isContents(held) ? { contents: held } : {}),
  };
}

/**
 * The structure as HQ answers it (`GET /api/structure`, a snapshot): each part read through its
 * shape; none where its applications or its Mates in no application cannot be read.
 */
export function hqStructureOf(value: unknown): HqStructure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const {
    apps,
    ungrouped = [],
    can: offered,
    unheld: told,
    tools: listed,
    rolesAnsweredAt,
  } = value as {
    readonly apps?: unknown;
    readonly ungrouped?: unknown;
    readonly can?: unknown;
    readonly unheld?: unknown;
    readonly tools?: unknown;
    readonly rolesAnsweredAt?: unknown;
  };
  // An HQ from before the Mates in no application names none of them.
  if (!(Array.isArray(apps) && apps.every(isApp) && isUngrouped(ungrouped))) return undefined;
  const can = offersOf(offered);
  const unheld = unheldOf(told);
  const tools = toolsOf(listed);
  return {
    ...(tools === undefined ? {} : { tools }),
    ...(can === undefined ? {} : { can }),
    ...(unheld === undefined ? {} : { unheld }),
    ...(typeof rolesAnsweredAt === "string" ? { rolesAnsweredAt } : {}),
    ungrouped: ungrouped.map(mateOffersOf),
    apps: apps.map(appOf),
  };
}
