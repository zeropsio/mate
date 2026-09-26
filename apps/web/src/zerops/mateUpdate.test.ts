import { describe, expect, it } from "vite-plus/test";

import { mateUpdateLine, mateUpdateQuestion, mateUpdateStatus } from "./mateUpdate";

describe("mateUpdateLine", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly update: Parameters<typeof mateUpdateLine>[0];
    readonly serverVersion: string;
    readonly expected: ReturnType<typeof mateUpdateLine>;
  }> = [
    {
      name: "no update field (standalone server, or zcp unreachable): the installed version alone",
      update: undefined,
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.0", tone: "default" },
    },
    {
      name: "checked, nothing newer: the installed version alone, no suffix",
      update: {
        installed: "0.8.1",
        latest: "0.8.1",
        available: false,
        checkedAt: "2026-09-09T00:00:00Z",
      },
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.1", tone: "default" },
    },
    {
      name: "an update is available: installed, then the newer version in the attention tone",
      update: {
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "2026-09-09T00:00:00Z",
      },
      serverVersion: "0.8.0",
      expected: { text: "Server 0.8.0 · 0.8.1 available", tone: "attention" },
    },
  ];

  for (const { name, update, serverVersion, expected } of cases) {
    it(name, () => {
      expect(mateUpdateLine(update, serverVersion)).toEqual(expected);
    });
  }
});

describe("mateUpdateStatus", () => {
  // The menu that starts a check or an update closes on the click, so the
  // Mate's card is where the person sees what came of it.
  it.each([
    { state: undefined, expected: null },
    { state: { phase: "idle" } as const, expected: null },
    {
      state: { phase: "checking" } as const,
      expected: { text: "Checking for updates…", tone: "quiet" },
    },
    {
      state: { phase: "updating", to: "0.11.49" } as const,
      expected: { text: "Updating to 0.11.49…", tone: "quiet" },
    },
    {
      state: { phase: "updated", to: "0.11.49" } as const,
      expected: { text: "Updated to 0.11.49", tone: "quiet" },
    },
    {
      state: { phase: "already-current" } as const,
      expected: { text: "Up to date", tone: "quiet" },
    },
    {
      state: { phase: "failed", message: "zcp mate update exited 1" } as const,
      expected: { text: "zcp mate update exited 1", tone: "failed" },
    },
  ])("$state.phase says $expected.text", ({ state, expected }) => {
    expect(mateUpdateStatus(state)).toEqual(expected);
  });
});

describe("mateUpdateQuestion", () => {
  // The app's confirm dialog takes the line ending in "?" as its title and
  // the rest as its description; running work stopping is said before the
  // click (spec-mate.md §2.9 step 4), and naming the Mate matters when
  // several are updated one after another.
  it.each([
    {
      mateName: "Nova",
      expected:
        "Update Nova to 0.11.49?\nNova restarts on the new version, which takes about a minute. Work running in it stops; its conversations stay.",
    },
    {
      mateName: undefined,
      expected:
        "Update this Mate to 0.11.49?\nIt restarts on the new version, which takes about a minute. Work running in it stops; its conversations stay.",
    },
  ])("asks about $mateName by name", ({ mateName, expected }) => {
    expect(mateUpdateQuestion(mateName, "0.11.49")).toBe(expected);
  });
});
