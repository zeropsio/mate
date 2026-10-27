import { assert, describe, it } from "@effect/vitest";

import { versionName } from "./versionNames.ts";

const SHA = "7e2d4c1aa0b1c2d3e4f5061728394a5b6c7d8e9f";

describe("versionName", () => {
  // Main B16: the label a person reads it by, and the commit's seven hex.
  it("names a version for its label and the commit's short sha", () => {
    assert.strictEqual(versionName("main", SHA), "main 7e2d4c1");
    assert.strictEqual(versionName("v0.1.0", SHA), "v0.1.0 7e2d4c1");
  });
});
