import { expect, it } from "vite-plus/test";
import { nodeVersionMatches } from "./prepare-worktree.ts";
it.each([
  ["v24.19.0", "^24.13.1", true],
  ["v24.13.1", "^24.13.1", true],
  ["v24.13.0", "^24.13.1", false],
  ["v25.0.0", "^24.13.1", false],
  ["v24.19.0", "24.19.0", true],
  ["v24.19.1", "24.19.0", false],
])("Node %s matches required %s: %s", (actual, required, expected) => {
  expect(nodeVersionMatches(actual, required)).toBe(expected);
});
