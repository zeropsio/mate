import { describe, expect, it } from "vite-plus/test";

import {
  mateUpdateLine,
  mateUpdateQuestion,
  mateUpdateStatus,
  mateUpdateStatusBeside,
} from "./mateUpdate";

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

  it.each(
    Array.from(cases, ({ name, update, serverVersion, expected }) => ({
      title: name,
      update,
      serverVersion,
      expected,
    })),
  )("$title", ({ update, serverVersion, expected }) => {
    expect(mateUpdateLine(update, serverVersion)).toEqual(expected);
  });
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
      state: { phase: "updating", to: "0.11.49", overdue: true } as const,
      expected: { text: "Updating to 0.11.49… taking longer than usual", tone: "quiet" },
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
  // the rest as its description; what the update does with the Mate's work
  // is said before the click — it waits for it, up to the drain's deadline,
  // never stops it (Milo's stress run 6 read "Work running in it stops") —
  // and naming the Mate matters when several are updated one after another.
  it.each([
    {
      mateName: "Nova",
      expected:
        "Update Nova to 0.11.49?\nNova finishes the work it's doing first, its helpers' too, then restarts on the new version, which takes about a minute. Its conversations stay. If that work isn't done within 10 minutes, Nova doesn't update and keeps working.",
    },
    {
      mateName: undefined,
      expected:
        "Update this Mate to 0.11.49?\nIt finishes the work it's doing first, its helpers' too, then restarts on the new version, which takes about a minute. Its conversations stay. If that work isn't done within 10 minutes, it doesn't update and keeps working.",
    },
  ])("asks about $mateName by name", ({ mateName, expected }) => {
    expect(mateUpdateQuestion(mateName, "0.11.49")).toBe(expected);
  });

  it("a version not known says the newest version, never one an older check knew", () => {
    expect(mateUpdateQuestion("Nova", null).split("\n")[0]).toBe(
      "Update Nova to the newest version?",
    );
  });
});

describe("automatic update line", () => {
  // The onboarding run, 2026-10-16: the Zerops page read "Updated to 0.15.133" beside an Update
  // button, the owner unsure whether one waited.
  it("a Mate updated automatically and already behind a newer version says the newer one waits, never Updated beside Update", () => {
    expect(
      mateUpdateLine(
        {
          installed: "0.15.133",
          latest: "0.15.134",
          available: true,
          checkedAt: "now",
          automatic: {
            protocol: 1,
            rollbackCompatible: true,
            phase: "updated",
            runningVersion: "0.15.133",
          },
        },
        "0.15.133",
      ),
    ).toEqual({ text: "Server 0.15.133 · 0.15.134 available", tone: "attention" });
  });

  it.each([
    ["draining", "Update ready; waiting for your work to finish"],
    ["switching", "Updating — your conversations are safe"],
    ["verifying", "Updating — your conversations are safe"],
    ["updated", "Updated to 0.15.0"],
    ["postponed", "Update postponed; Mate is running 0.14.8"],
  ] as const)("%s shows its authoritative phase", (phase, text) => {
    expect(
      mateUpdateLine(
        {
          installed: phase === "updated" ? "0.15.0" : "0.14.8",
          latest: "0.15.0",
          available: phase !== "updated",
          checkedAt: "now",
          automatic: {
            protocol: 1,
            rollbackCompatible: true,
            phase,
            runningVersion: phase === "updated" ? "0.15.0" : "0.14.8",
          },
        },
        "0.14.8",
      ),
    ).toEqual({ text, tone: "default" });
  });
  it.each(["postponed", "updated"] as const)(
    "an automatic %s record of an older attempt never reads as current: the line says what is installed",
    (phase) => {
      expect(
        mateUpdateLine(
          {
            installed: "0.14.92",
            latest: "0.14.92",
            available: false,
            checkedAt: "now",
            automatic: {
              protocol: 1,
              rollbackCompatible: false,
              phase,
              runningVersion: "0.14.70",
              failedVersion: "0.14.71",
            },
          },
          "0.14.92",
        ),
      ).toEqual({ text: "Server 0.14.92", tone: "default" });
    },
  );
  it("an incompatible release asks for confirmation", () => {
    expect(
      mateUpdateLine(
        {
          installed: "0.14.8",
          latest: "0.15.0",
          available: true,
          checkedAt: "now",
          automatic: {
            protocol: 1,
            rollbackCompatible: false,
            phase: "idle",
            runningVersion: "0.14.8",
          },
        },
        "0.14.8",
      ).text,
    ).toBe("Update available — needs your confirmation");
  });
});

// Milo's stress run 6: after the person's Update the Zerops card read "Updated to 0.15.31 Updated
// to 0.15.31": the server's record of the update on the line, the person's own answer beside it.
describe("mateUpdateStatusBeside", () => {
  const record = (phase: "updated" | "idle") => ({
    installed: "0.15.31",
    latest: "0.15.31",
    available: false,
    checkedAt: "now",
    automatic: { protocol: 1 as const, rollbackCompatible: true, phase, runningVersion: "0.15.31" },
  });
  it.each([
    { name: "the server records it too", phase: "updated", said: null },
    { name: "only the person's update says it", phase: "idle", said: "Updated to 0.15.31" },
  ] as const)("the card says a Mate updated once: $name", ({ phase, said }) => {
    const line = mateUpdateLine(record(phase), "0.15.31");
    const status = mateUpdateStatusBeside(line, { phase: "updated", to: "0.15.31" });
    expect([line.text, status?.text ?? null]).toEqual([
      phase === "updated" ? "Updated to 0.15.31" : "Server 0.15.31",
      said,
    ]);
  });
});

describe("a Mate that only a restart gets current", () => {
  const base = {
    installed: "0.15.200",
    latest: "0.15.200",
    available: false,
    checkedAt: "now",
    zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
    restart: { needed: true, why: "zcp 9.226.0 is out; only a restart installs it" },
  };

  it.each([
    {
      name: "zcp behind alone",
      update: base,
      expected: { text: "Server 0.15.200 · zcp 9.226.0 available", tone: "attention" },
    },
    {
      name: "zcp behind beside a newer mate",
      update: { ...base, latest: "0.15.201", available: true },
      expected: {
        text: "Server 0.15.200 · 0.15.201 available · zcp 9.226.0 available",
        tone: "attention",
      },
    },
    {
      name: "zcp behind with no version named",
      update: { ...base, zcp: { installed: "9.225.0", latest: "", behind: true } },
      expected: { text: "Server 0.15.200", tone: "default" },
    },
    {
      name: "zcp current",
      update: { ...base, zcp: { installed: "9.226.0", latest: "9.226.0", behind: false } },
      expected: { text: "Server 0.15.200", tone: "default" },
    },
  ] as const)("the update line names the zcp version available: $name", ({ update, expected }) => {
    expect(mateUpdateLine(update, "0.15.200")).toEqual(expected);
  });

  it.each([
    ["draining", undefined, "Update ready; waiting for your work to finish"],
    ["restarting", undefined, "Restarting to update zcp — your conversations are safe"],
    [
      "postponed",
      "this zcp can't restart its Mate yet",
      "Update postponed; this zcp can't restart its Mate yet",
    ],
  ] as const)("a restart %s says so on the line", (phase, reason, text) => {
    expect(
      mateUpdateLine(
        {
          ...base,
          restart: { ...base.restart, phase, ...(reason === undefined ? {} : { reason }) },
        },
        "0.15.200",
      ),
    ).toEqual({ text, tone: "default" });
  });

  it("the question names zcp, and says the container restarts once the work is done", () => {
    expect(mateUpdateQuestion("Nova", null, { zcp: "9.226.0" })).toBe(
      "Update Nova to zcp 9.226.0?\nNova finishes the work it's doing first, its helpers' too, then its container restarts to install it, which takes a few minutes. Its conversations stay. If that work isn't done within 10 minutes, Nova doesn't update and keeps working.",
    );
    expect(mateUpdateQuestion("Nova", "0.15.201", { zcp: "9.226.0" }).split("\n")[0]).toBe(
      "Update Nova to 0.15.201 and zcp 9.226.0?",
    );
  });

  it.each([
    {
      state: { phase: "updated", to: null, zcp: "9.226.0" } as const,
      text: "Updated zcp to 9.226.0",
    },
    {
      state: { phase: "updated", to: "0.15.201", zcp: "9.226.0" } as const,
      text: "Updated to 0.15.201 and zcp 9.226.0",
    },
  ])("a finished restart says what moved: $text", ({ state, text }) => {
    expect(mateUpdateStatus(state)?.text).toBe(text);
  });
});
