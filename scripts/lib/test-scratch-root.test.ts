import { describe, expect, it } from "vite-plus/test";
import { TEST_RAMDISK_TMPDIR, useTestScratchRoot } from "./test-scratch-root.ts";

describe("the test scratch root", () => {
  it.each([
    {
      title: "the RAM disk is present: TMPDIR points at it",
      present: true,
      before: "/var/x",
      after: TEST_RAMDISK_TMPDIR,
    },
    {
      title: "the RAM disk is absent: TMPDIR is unchanged",
      present: false,
      before: "/var/x",
      after: "/var/x",
    },
    {
      title: "the RAM disk is absent and TMPDIR unset: it stays unset",
      present: false,
      before: undefined,
      after: undefined,
    },
  ])("$title", ({ present, before, after }) => {
    const env: NodeJS.ProcessEnv = before === undefined ? {} : { TMPDIR: before };
    useTestScratchRoot(env, (directory) => present && directory === TEST_RAMDISK_TMPDIR);
    expect(env["TMPDIR"]).toBe(after);
  });
});
