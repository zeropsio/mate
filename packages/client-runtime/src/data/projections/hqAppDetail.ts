/**
 * One application's detail as HQ last said it, for the surfaces that show it — change rows and
 * review, release dialogs, the recipe and its repositories: each record apart, `undefined` until HQ
 * said it, kept through an outage or a refusal, gone once HQ removed or withheld it. How the
 * application's scope is observed is the streams' own word.
 *
 * @module data/projections/hqAppDetail
 */
import type { HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import type { Release } from "@t3tools/shared/hqRelease";

import { hqAppDetailScope, type HqAppDetailValue } from "../families/hqAppDetail.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { StreamFault } from "../streamMachine.ts";
import { scopeFreshness, type ScopeFreshness } from "./freshness.ts";
import type { RosterRead } from "./projects.ts";

export interface HqAppRecipes {
  readonly mate?: RecipeTierResponse;
  readonly stage?: RecipeTierResponse;
  readonly production?: RecipeTierResponse;
}

export interface HqAppDetailRead extends Omit<ScopeFreshness, "complete"> {
  readonly releases: ReadonlyArray<Release> | undefined;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly changes: ReadonlyArray<HqChange> | undefined;
  /** Each tier HQ said; a tier it did not say is absent from here, never "no recipe". */
  readonly recipes: HqAppRecipes;
  /** Where the application's read stands: not asked for, its first catchup under way, or read. */
  readonly read: RosterRead;
  /** HQ's code and words for why it cannot read the application now, while it says one. */
  readonly failure: HqAppFailure | null;
}

/** Why HQ cannot read an application: its `scope-error` code where it named one, and its words. */
export interface HqAppFailure {
  readonly code?: string;
  readonly message: string;
}

export interface HqAppKey {
  readonly orgId: string;
  readonly appId: string;
}

const releasesOf = (value: HqAppDetailValue | undefined): ReadonlyArray<Release> | undefined =>
  value?.kind === "releases" ? value.value : undefined;
const reposOf = (value: HqAppDetailValue | undefined): ReadonlyArray<RepoListEntry> | undefined =>
  value?.kind === "repos" ? value.value : undefined;
const changesOf = (value: HqAppDetailValue | undefined): ReadonlyArray<HqChange> | undefined =>
  value?.kind === "changes" ? value.value : undefined;

const tierOf = (value: HqAppDetailValue | undefined) =>
  value?.kind === "recipe" ? value.value : undefined;

const failureOf = (fault: StreamFault | null | undefined): HqAppFailure | null =>
  fault == null
    ? null
    : fault.code === undefined
      ? { message: fault.message }
      : { code: fault.code, message: fault.message };

/** The records the application's scope lists now, by record key. */
function recordsOf(read: ProjectionReads, { orgId, appId }: HqAppKey) {
  const records = new Map<string, HqAppDetailValue>();
  for (const id of read.members(hqAppDetailScope(orgId, appId)).ids) {
    const fact = read.fact("hqAppDetail", id);
    if (fact.kind === "known") records.set(id.slice(appId.length + 1), fact.value);
  }
  return records;
}

export const hqAppDetail: Projection<HqAppKey, HqAppDetailRead> = {
  name: "hqAppDetail",
  keyOf: ({ orgId, appId }) => `${orgId}/${appId}`,
  derive: (read, key) => {
    const scope = hqAppDetailScope(key.orgId, key.appId);
    const { complete, ...freshness } = scopeFreshness(read, scope);
    const stream = read.stream(scope);
    const records = recordsOf(read, key);
    const recipes: Record<string, RecipeTierResponse> = {};
    for (const tier of ["mate", "stage", "production"] as const) {
      const value = tierOf(records.get(`recipe:${tier}`));
      if (value !== undefined) recipes[tier] = value;
    }
    return {
      releases: releasesOf(records.get("releases")),
      repos: reposOf(records.get("repos")),
      changes: changesOf(records.get("changes")),
      recipes,
      read: complete
        ? "read"
        : stream.phase === "idle" || stream.phase === "paused"
          ? "unread"
          : "reading",
      failure: freshness.live ? null : failureOf(stream.fault),
      ...freshness,
    };
  },
  equals: sameValue,
};

/** Each named application's detail, by its id: what a surface over several applications reads. */
export const hqAppDetails: Projection<
  { readonly orgId: string; readonly appIds: ReadonlyArray<string> },
  Readonly<Record<string, HqAppDetailRead>>
> = {
  name: "hqAppDetails",
  keyOf: ({ orgId, appIds }) => `${orgId}/${appIds.join(",")}`,
  derive: (read, { orgId, appIds }) =>
    Object.fromEntries(appIds.map((appId) => [appId, hqAppDetail.derive(read, { orgId, appId })])),
  equals: sameValue,
};
