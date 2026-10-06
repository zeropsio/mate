/**
 * Applications' detail as HQ says it (`hqAppDetail`): demanded for each application a surface draws
 * while it draws it, and let go when it goes. Nothing here reads HQ on its own; the account's HQ
 * link subscribes each demanded application's `app-detail` scope.
 */
import { hqAppDetail, hqAppDetails, type HqAppDetailRead } from "@t3tools/client-runtime/data";
import { appRecipeOf, type AppRecipe } from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import type { HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef } from "react";

import { useAccountDataOptional, useAccountOrgId, useProjection } from "./ZeropsAccountData";

const NOT_READ: HqAppDetailRead = {
  releases: undefined,
  repos: undefined,
  changes: undefined,
  recipes: {},
  read: "unread",
  failure: null,
  live: false,
  reconnecting: false,
};
const NOT_READ_ATOM = Atom.make(NOT_READ);
const NONE: Readonly<Record<string, HqAppDetailRead>> = {};
const NONE_ATOM = Atom.make(NONE);

/**
 * Holds each application's detail while the caller is drawn with it: one joining or leaving takes
 * or lets go of its own hold only, never the others'.
 */
function useHqAppDetailDemand(appIds: ReadonlyArray<string>): void {
  const demandDetail = useAccountDataOptional()?.demandDetail;
  const holds = useRef<{
    readonly demandDetail: typeof demandDetail;
    readonly released: Map<string, () => void>;
  }>({ demandDetail: undefined, released: new Map() });
  const key = appIds.join("\n");
  useEffect(() => {
    // Another account's observation: every hold moves to it.
    if (holds.current.demandDetail !== demandDetail) {
      for (const release of holds.current.released.values()) release();
      holds.current = { demandDetail, released: new Map() };
    }
    const { released } = holds.current;
    const drawn = new Set(key === "" ? [] : key.split("\n"));
    for (const [appId, release] of released)
      if (!drawn.has(appId)) {
        release();
        released.delete(appId);
      }
    if (demandDetail === undefined) return;
    for (const ownerId of drawn)
      if (!released.has(ownerId))
        released.set(ownerId, demandDetail({ family: "hqAppDetail", ownerId }));
  }, [demandDetail, key]);
  useEffect(
    () => () => {
      for (const release of holds.current.released.values()) release();
      holds.current = { demandDetail: undefined, released: new Map() };
    },
    [],
  );
}

/** One application's detail, held while the caller is drawn; not read without one. */
export function useHqAppDetail(appId: string | null): HqAppDetailRead {
  useHqAppDetailDemand(appId === null ? [] : [appId]);
  const orgId = useAccountOrgId();
  return useProjection(
    hqAppDetail,
    orgId === null || appId === null ? null : { orgId, appId },
    NOT_READ_ATOM,
  );
}

/** Each application's detail by its id, each held while the caller is drawn. */
function useHqAppDetails(appIds: ReadonlyArray<string>): Readonly<Record<string, HqAppDetailRead>> {
  useHqAppDetailDemand(appIds);
  const orgId = useAccountOrgId();
  const key = useMemo(
    () => (orgId === null || appIds.length === 0 ? null : { orgId, appIds }),
    [orgId, appIds],
  );
  return useProjection(hqAppDetails, key, NONE_ATOM);
}

/**
 * HQ's reason it cannot read an application, in its words: a reason HQ names is worded as every
 * refusal is; any other is said as HQ said it.
 */
function hqAppFailureWords(failure: string): string {
  const words = hqRefusalWords({ code: failure, reason: failure });
  return words === `HQ refused this (${failure}).` ? failure : words;
}

/** An application's recipe HQ cannot read, with the person's *Try again*; `undefined` otherwise. */
export function useHqRecipeFailure(
  appId: string,
): { readonly reason: string; readonly again: () => void } | undefined {
  const { failure } = useHqAppDetail(appId);
  const retry = useAccountDataOptional()?.retry;
  if (failure === null || retry === undefined) return undefined;
  return { reason: hqAppFailureWords(failure), again: retry };
}

/** Each application's recipe, once HQ said both its stage's and its production's tier. */
export function useHqAppRecipes(appIds: ReadonlyArray<string>): ReadonlyMap<string, AppRecipe> {
  const details = useHqAppDetails(appIds);
  return useMemo(() => {
    const recipes = new Map<string, AppRecipe>();
    for (const [appId, { recipes: tiers }] of Object.entries(details)) {
      const { stage, production } = tiers;
      // A tier HQ has not said is not read; only HQ's explicit absent tier earns a negative.
      if (stage === undefined || production === undefined) continue;
      recipes.set(
        appId,
        appRecipeOf({
          stage: stage.state === "present" ? stage.importYaml : null,
          production: production.state === "present" ? production.importYaml : null,
        }),
      );
    }
    return recipes;
  }, [details]);
}

export interface HqAppReleases {
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  /** Each application's changes: the open ones and the latest settled, newest first. */
  readonly changes: ReadonlyMap<string, ReadonlyArray<HqChange>>;
  /** HQ's reason it cannot read an application now, in its words. */
  readonly failures: ReadonlyMap<string, string>;
}

/**
 * Each application's releases, repositories and changes, by its id: an application HQ has not said
 * a list of is absent from it — unread, never an earned "none".
 */
export function useHqAppReleases(appIds: ReadonlyArray<string>): HqAppReleases {
  const details = useHqAppDetails(appIds);
  return useMemo(() => {
    const releases = new Map<string, ReadonlyArray<Release>>();
    const repos = new Map<string, ReadonlyArray<RepoListEntry>>();
    const changes = new Map<string, ReadonlyArray<HqChange>>();
    const failures = new Map<string, string>();
    for (const [appId, detail] of Object.entries(details)) {
      if (detail.releases !== undefined) releases.set(appId, detail.releases);
      if (detail.repos !== undefined) repos.set(appId, detail.repos);
      if (detail.changes !== undefined) changes.set(appId, detail.changes);
      if (detail.failure !== null) failures.set(appId, hqAppFailureWords(detail.failure));
    }
    return { releases, repos, changes, failures };
  }, [details]);
}
