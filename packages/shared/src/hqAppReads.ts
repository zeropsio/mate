/**
 * HQ-owned application facts needed at load: the same bounded releases, repository heads and
 * stage/production recipe declarations as HQ's detail reads. Zerops owns deployments and services;
 * none are mirrored here. The structure snapshot carries these by readable application, then a
 * release-revision message replaces just the moved app. No bootstrap requests or old-HQ fallback.
 */
import * as Schema from "effect/Schema";

import { RepoListEntry } from "./hqChanges.ts";
import { RecipeTierResponse } from "./hqRecipe.ts";
import { Release } from "./hqRelease.ts";

export const AppReadValue = Schema.Struct({
  releases: Schema.Array(Release),
  repos: Schema.Array(RepoListEntry),
  recipes: Schema.Struct({ stage: RecipeTierResponse, production: RecipeTierResponse }),
});
export type AppReadValue = typeof AppReadValue.Type;

export const AppReadFailure = Schema.Struct({
  code: Schema.String,
  reason: Schema.NullOr(Schema.String),
});
export type AppReadFailure = typeof AppReadFailure.Type;

/** A failed read is explicit, never an empty list or an absent recipe. */
export const AppRead = Schema.Struct({
  revision: Schema.NullOr(Schema.String),
  value: Schema.NullOr(AppReadValue),
  failure: Schema.NullOr(AppReadFailure),
});
export type AppRead = typeof AppRead.Type;

export const AppReads = Schema.Record(Schema.String, AppRead);
export type AppReads = typeof AppReads.Type;

/** Null removes the app's facts when the reader loses access. */
export const ReleaseRevisionMessage = Schema.Struct({
  type: Schema.Literal("release-revision"),
  appId: Schema.String,
  read: Schema.NullOr(AppRead),
});
export type ReleaseRevisionMessage = typeof ReleaseRevisionMessage.Type;
