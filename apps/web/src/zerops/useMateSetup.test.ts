import type { MateSetup } from "@t3tools/client-runtime/zerops/mateSetup";
import { describe, expect, it } from "vite-plus/test";

import { mateSetupSettled } from "./useMateSetup";

describe("mateSetupSettled", () => {
  it.each<{
    readonly case: string;
    readonly setup: Omit<MateSetup, "at">;
    readonly settled: boolean;
  }>([
    {
      case: "runtimes importing",
      setup: { runtimes: "running", standup: "waiting" },
      settled: false,
    },
    {
      case: "the stand-up running",
      setup: { runtimes: "done", standup: "running" },
      settled: false,
    },
    { case: "the stand-up done", setup: { runtimes: "done", standup: "done" }, settled: true },
    { case: "the stand-up failed", setup: { runtimes: "none", standup: "failed" }, settled: true },
    { case: "no stand-up to run", setup: { runtimes: "none", standup: "none" }, settled: true },
    { case: "nothing said of a stand-up", setup: { runtimes: "done" }, settled: false },
  ])("$case: settled $settled", ({ setup, settled }) => {
    expect(mateSetupSettled({ at: "", ...setup })).toBe(settled);
  });
});
