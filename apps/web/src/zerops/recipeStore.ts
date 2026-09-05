/**
 * The web app's recipe store.
 *
 * zcp writes the real one; it does not exist yet. Until it does this is the
 * mock, seeded with the showcase group only. A live group therefore has no
 * store recipe, and the creation dialog offers what it can instead: a clone
 * of a sibling's export, or nothing yet with the agent to set it up.
 */

import {
  GO_HELLO_WORLD_GROUP,
  makeMockZeropsRecipeStore,
  type ZeropsRecipeStore,
} from "@t3tools/client-runtime/zerops";

export const zeropsRecipeStore: ZeropsRecipeStore = makeMockZeropsRecipeStore([
  GO_HELLO_WORLD_GROUP,
]);
