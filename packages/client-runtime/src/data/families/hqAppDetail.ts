/**
 * One application's detail as HQ keeps it (`app-detail` scope): its releases, its repositories with
 * their `main`, each tier of its recipe, and its changes — each an independent record, observed only
 * while a screen demands the application. A record's id is the application's id and its record key,
 * so one application's records stand beside another's.
 *
 * @module data/families/hqAppDetail
 */
import { HqAppDetailFields } from "@t3tools/shared/hqStream";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

const KEYS: ReadonlySet<string> = new Set(Object.keys(HqAppDetailFields));

/**
 * A record as it reads, told by its own shape — a recipe tier by its `state`, a list by its
 * records. An empty list fits each list alike: the key it was held under says which it is.
 */
export type HqAppDetailValue =
  | { readonly kind: "releases"; readonly value: typeof HqAppDetailFields.releases.Type }
  | { readonly kind: "repos"; readonly value: typeof HqAppDetailFields.repos.Type }
  | { readonly kind: "changes"; readonly value: typeof HqAppDetailFields.changes.Type }
  | { readonly kind: "recipe"; readonly value: (typeof HqAppDetailFields)["recipe:stage"]["Type"] }
  | { readonly kind: "empty" };

const readReleases = Schema.decodeUnknownOption(HqAppDetailFields.releases);
const readRepos = Schema.decodeUnknownOption(HqAppDetailFields.repos);
const readChanges = Schema.decodeUnknownOption(HqAppDetailFields.changes);
const readTier = Schema.decodeUnknownOption(HqAppDetailFields["recipe:stage"]);

function decodeDetail(raw: unknown): HqAppDetailValue | null {
  if (Array.isArray(raw) && raw.length === 0) return { kind: "empty" };
  const releases = readReleases(raw);
  if (Option.isSome(releases)) return { kind: "releases", value: releases.value };
  const repos = readRepos(raw);
  if (Option.isSome(repos)) return { kind: "repos", value: repos.value };
  const changes = readChanges(raw);
  if (Option.isSome(changes)) return { kind: "changes", value: changes.value };
  const tier = readTier(raw);
  return Option.isSome(tier) ? { kind: "recipe", value: tier.value } : null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly hqAppDetail: HqAppDetailValue;
  }
}

export const hqAppDetailFamily: FamilySpec<"hqAppDetail"> = {
  family: "hqAppDetail",
  authority: "hq",
  scope: { source: "hq", suffix: "hq-app-detail", leaving: "removed", demand: "detail" },
  hq: {
    scope: "app-detail",
    idOf: (key, owner) =>
      owner.ownerId === null || !KEYS.has(key) ? null : `${owner.ownerId}/${key}`,
    keyOf: (id, owner) => id.slice((owner.ownerId ?? "").length + 1),
    decode: decodeDetail,
    wireScope: (appId) => ({ kind: "app-detail", appId }),
  },
};

/** One application's detail scope under the organization's HQ link. */
export const hqAppDetailScope = (orgId: string, appId: string): ScopeKey =>
  scopeOf(hqAppDetailFamily, orgId, appId);
