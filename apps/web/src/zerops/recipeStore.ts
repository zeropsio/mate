/**
 * The web app's recipe store.
 *
 * zcp writes the real one; it does not exist yet. Until it does this is the
 * mock, seeded with the showcase group and answering every other group with
 * the same `go-hello-world` recipes — hacks.md H-26 — so that a live group
 * can create an environment today. The fallback can never name a group
 * (`recipeStore.ts`), so what it changes is exactly one thing: whether the
 * "Add production" button has anything to import.
 */

import {
  GO_HELLO_WORLD_GROUP,
  makeMockZeropsRecipeStore,
  type ZeropsRecipeStore,
} from "@t3tools/client-runtime/zerops";

export const zeropsRecipeStore: ZeropsRecipeStore = makeMockZeropsRecipeStore(
  [GO_HELLO_WORLD_GROUP],
  { fallbackRecipes: GO_HELLO_WORLD_GROUP.recipes },
);
