/**
 * A tier of an application's recipe, as `main` of its recipe repository holds it (SPEC §3.2c): what
 * a deploy reads for the services it deploys. Read as every reader of a tier reads it
 * (`Changes.recipeTier`, `@t3tools/shared/hqRecipe` `RecipeTierResponse`): `absent` without the
 * repository, the file, or a service in it. Any failure to read it is one error to the deploy.
 *
 * @module recipeTiers
 */
import type { RecipeTier, RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { Changes } from "./changes.ts";

export class RecipeTierUnreadable extends Schema.TaggedError<RecipeTierUnreadable>()(
  "RecipeTierUnreadable",
  { message: Schema.String },
) {}

export class RecipeTiers extends Context.Service<
  RecipeTiers,
  {
    readonly read: (
      appId: string,
      tier: RecipeTier,
    ) => Effect.Effect<RecipeTierResponse, RecipeTierUnreadable>;
  }
>()("@t3tools/hq/recipeTiers") {}

/** Why a tier could not be read, in a word a log can carry. */
const unreadable = (error: { readonly _tag: string }) =>
  new RecipeTierUnreadable({
    message:
      "reason" in error && typeof error.reason === "string"
        ? `${error._tag}: ${error.reason}`
        : error._tag,
  });

export const recipeTiersLayer = Layer.effect(
  RecipeTiers,
  Effect.gen(function* () {
    const changes = yield* Changes;
    return {
      read: (appId, tier) => changes.recipeTier(appId, tier).pipe(Effect.mapError(unreadable)),
    };
  }),
);
