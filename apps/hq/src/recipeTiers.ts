/**
 * A tier of an application's recipe, as `main` of its recipe repository holds it (SPEC §3.2c): what
 * a deploy reads for the services it deploys. The reader is the recipe's (T10a, `@t3tools/shared/
 * hqRecipe` `RecipeTierResponse`): `absent` without the repository, the file, or a service in it.
 *
 * @module recipeTiers
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export type RecipeTierRead =
  | { readonly state: "present"; readonly importYaml: string; readonly mainHead: string }
  | { readonly state: "absent" };

export class RecipeTierUnreadable extends Schema.TaggedError<RecipeTierUnreadable>()(
  "RecipeTierUnreadable",
  { message: Schema.String },
) {}

export class RecipeTiers extends Context.Service<
  RecipeTiers,
  {
    readonly read: (
      appId: string,
      tier: "stage" | "production",
    ) => Effect.Effect<RecipeTierRead, RecipeTierUnreadable>;
  }
>()("@t3tools/hq/recipeTiers") {}

/**
 * Until the recipe's own reader is merged (T10a, `Changes.recipeTier`), no application has a
 * recipe: every tier reads `absent`, and nothing deploys.
 */
export const noRecipeTiersYet = Layer.succeed(RecipeTiers, {
  read: () => Effect.succeed({ state: "absent" }),
});
