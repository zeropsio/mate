/**
 * What merging a change to the group repo does to the project, read from the files it changes.
 *
 * The group repo holds the recipe — one directory per tier, `0 — AI Agent/` to `4 — Small
 * Production/` and more, each with its `import.yaml` and a README — and `environments.yaml`. None
 * of it is released: a release tags the code in the service repositories, and the group repo holds
 * only what the environments are made from (the owner, 2026-09-30). A merge to its `main` moves
 * the project in these ways only (`../gitea-mate/docs/group-repo.md`, "Recipe deltas";
 * `pipeline/recipes.go`):
 *
 * - a tier's `import.yaml` changed: every environment `environments.yaml` makes from that tier gets
 *   each service the tier declares and it lacks, created empty. A service it has keeps what it
 *   was created with, and one the tier no longer declares is never deleted.
 * - `environments.yaml` changed: the project deploys to what it declares.
 * - a Mate, a stage or a production made later is made from the tier on `main` then.
 *
 * The tiers anything is made from are the app's own (`RECIPE_TIER_PATHS`): a Mate from the AI
 * Agent tier, a stage from the stage tier, the production from the small production tier. Nothing
 * in the project is made from any other — `1 — Remote (CDE)`, `2 — Local`, the highly available
 * production — and a README changes nothing.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module recipeReach
 */

import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import { ENVIRONMENTS_DOCUMENT_PATH, RECIPE_TIER_PATHS, type RecipeTier } from "./recipeTier.ts";

export interface RecipeReach {
  /** How many of the project's stages are made from a recipe it changes; each gets what it adds. */
  readonly stages: number;
  /** The production is made from a recipe it changes, and gets what it adds. */
  readonly production: boolean;
  /**
   * What is made from a recipe it changes and has nothing made yet, in the order they are added:
   * a Mate always — one already here keeps what it has — a stage or a production only where the
   * project has none.
   */
  readonly later: ReadonlyArray<RecipeTier>;
  /** The recipes it changes that nothing in the project is made from, by their titles, in order. */
  readonly unused: ReadonlyArray<string>;
  /** It changes `environments.yaml`: which environments the project deploys to. */
  readonly declarations: boolean;
}

/** Where a tier keeps its recipe, inside its directory. */
const RECIPE_FILE = "import.yaml";

/** `3 — Stage`: the recipe's number, its em dash, and the tier's title. */
const TIER_DIRECTORY = /^(\d+)\s*—\s*(\S.*)$/u;

/** The order a Mate, a stage and a production are added in. */
const MADE_IN_ORDER: ReadonlyArray<RecipeTier> = ["mate", "stage", "production"];

/** What the app makes from each tier directory: `3 — Stage` → `stage`. */
const MADE_FROM: ReadonlyMap<string, RecipeTier> = new Map(
  MADE_IN_ORDER.map((tier) => {
    const path = RECIPE_TIER_PATHS[tier];
    return [path.slice(0, path.lastIndexOf("/")), tier];
  }),
);

/** The tier directory whose recipe `path` is, or `undefined` for any other file. */
function recipeDirectory(path: string): string | undefined {
  const slash = path.indexOf("/");
  if (slash === -1 || path.slice(slash + 1) !== RECIPE_FILE) return undefined;
  const directory = path.slice(0, slash);
  return TIER_DIRECTORY.test(directory) ? directory : undefined;
}

/** The recipe's own order: its number first. */
function byNumber(left: string, right: string): number {
  const number = (directory: string) => Number(TIER_DIRECTORY.exec(directory)?.[1] ?? 0);
  return number(left) - number(right) || left.localeCompare(right);
}

export function recipeReach(input: {
  /** Every file the change touches, with the path a moved one had before. */
  readonly files: ReadonlyArray<{
    readonly filename: string;
    readonly previousFilename?: string | undefined;
  }>;
  /** The environments `environments.yaml` declares on `main`. */
  readonly environments: ReadonlyArray<{ readonly tier: GroupEnvironmentTier }>;
}): RecipeReach {
  const paths = input.files.flatMap((file) =>
    file.previousFilename === undefined ? [file.filename] : [file.filename, file.previousFilename],
  );
  const directories = [...new Set(paths.flatMap((path) => recipeDirectory(path) ?? []))].sort(
    byNumber,
  );
  const changed = new Set(directories.flatMap((directory) => MADE_FROM.get(directory) ?? []));
  const declared = (tier: GroupEnvironmentTier) =>
    input.environments.filter((environment) => environment.tier === tier).length;
  const stages = changed.has("stage") ? declared("stage") : 0;
  const production = changed.has("production") && declared("production") > 0;
  return {
    stages,
    production,
    later: MADE_IN_ORDER.filter(
      (tier) => changed.has(tier) && (tier === "mate" || declared(tier) === 0),
    ),
    unused: directories
      .filter((directory) => !MADE_FROM.has(directory))
      .map((directory) => TIER_DIRECTORY.exec(directory)?.[2]?.trim() ?? directory),
    declarations: paths.includes(ENVIRONMENTS_DOCUMENT_PATH),
  };
}
