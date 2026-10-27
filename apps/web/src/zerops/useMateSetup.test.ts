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
    {
      // A New project's first Mate: no stand-up, its Git access still on its way.
      case: "Git access on its way",
      setup: { git: "waiting", runtimes: "none", standup: "none" },
      settled: false,
    },
    {
      // It heals once an admin sets HQ up, or its setup is finished: read on.
      case: "Git access failed",
      setup: { git: "failed", gitFailure: { reason: "no_hq" }, runtimes: "none", standup: "none" },
      settled: false,
    },
    {
      case: "Git access granted",
      setup: { git: "done", runtimes: "none", standup: "none" },
      settled: true,
    },
  ])("$case: settled $settled", ({ setup, settled }) => {
    expect(mateSetupSettled({ at: "", ...setup })).toBe(settled);
  });
});
