// @effect-diagnostics nodeBuiltinImport:off - the witness reads the filesystem the helper wrote.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { testTempDir } from "./testTempDir.ts";

describe("a test's temp dir", () => {
  const made: Array<string> = [];

  it("is there while the test that made it runs", () => {
    const dir = testTempDir("temp-dir-passes-");
    made.push(dir);
    expect(NodeFS.statSync(dir).isDirectory()).toBe(true);
  });

  it.fails("is made by a test that then fails", () => {
    made.push(testTempDir("temp-dir-fails-"));
    throw new Error("the test fails after making its dir");
  });

  it("A z3 test leaves no temp dir behind when it ends, whether it passes or fails", () => {
    expect(made.map((dir) => NodeFS.existsSync(dir))).toEqual([false, false]);
  });
});
