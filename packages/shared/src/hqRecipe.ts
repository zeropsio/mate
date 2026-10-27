/**
 * An application's recipe in HQ (SPEC §3.2c): the import files its environments and its Mates are
 * made from, one per tier, on the `main` of its recipe repository `<appId>/group` — laid out as main's
 * group repository was: `<n> — <Title>/import.yaml`, with a `README.md` beside each and one at the
 * top. HQ keeps no `environments.yaml`: it holds the environments itself.
 *
 * A Mate proposes the tiers `main` lacks as a change of its own titled {@link RECIPE_PROPOSAL_TITLE};
 * Core lands one that only adds files by itself (HQ's `permissions.ts` `land_recipe`), a person
 * merges one that edits a file, and Core closes an empty one.
 *
 * Reading a tier, on `main`, bounded:
 *
 * - a person: `GET /api/apps/:appId/recipe/:tier`, whoever may read the application's changes;
 * - a Mate: `GET /api/mate/recipe/:tier`, its own application's recipe;
 *
 * → {@link RecipeTierResponse}: `absent` when the file is not there or declares no service; a file
 * past the read's bound is refused `413 too_large` with the reason `recipe_too_large`.
 *
 * @module hqRecipe
 */
import * as Schema from "effect/Schema";

import { Sha } from "./hqChanges.ts";

/** An application's recipe repository, beside its services': the name is reserved for it. */
export const RECIPE_REPO = "group";

/** The exact title of a Mate's recipe proposal: zcp writes it, the client knows a proposal by it. */
export const RECIPE_PROPOSAL_TITLE = "Mate: the group's import files";

export const RECIPE_TIERS = ["mate", "stage", "production"] as const;
export const RecipeTier = Schema.Literals(RECIPE_TIERS);
export type RecipeTier = typeof RecipeTier.Type;

/** Each tier's import file in the recipe repository: a Mate's, a stage's, a production's. */
export const RECIPE_TIER_PATHS: { readonly [T in RecipeTier]: string } = {
  mate: "0 — AI Agent/import.yaml",
  stage: "3 — Stage/import.yaml",
  production: "4 — Small Production/import.yaml",
};

export const RecipeTierResponse = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("present"),
    importYaml: Schema.String,
    /** The `main` it was read on. */
    mainHead: Sha,
  }),
  Schema.Struct({ state: Schema.Literal("absent") }),
]);
export type RecipeTierResponse = typeof RecipeTierResponse.Type;

const SERVICES_KEY = /^services:\s*(?:#.*)?$/u;
const ITEM = /^\s+-\s+\S/u;

/**
 * Whether an import file declares a service: a top-level `services:` with an item under it before
 * the next top-level line, as main's client read it (`client-runtime` `recipeTier.ts`) — any
 * indentation, no YAML parser.
 */
export function hasServices(importYaml: string): boolean {
  const lines = importYaml.split("\n");
  const start = lines.findIndex((line) => SERVICES_KEY.test(line));
  if (start === -1) return false;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.length === line.trimStart().length) return false;
    if (ITEM.test(line)) return true;
  }
  return false;
}
