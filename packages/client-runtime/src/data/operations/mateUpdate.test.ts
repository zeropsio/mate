import { describe, expect, it } from "vite-plus/test";
import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { updateOutcome, updateVerdict } from "./mateUpdate.ts";

describe("Mate update evidence", () => {
  const pressed = { from: "1", bootId: "old" };
  it("a dropped socket or the same boot proves no outcome", () => {
    expect(updateOutcome(pressed, null)).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "old" })).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1" })).toBeNull();
  });
  it("a changed version proves an update, including a late return", () => {
    expect(updateOutcome(pressed, { serverVersion: "2", bootId: "new" })).toEqual({
      kind: "succeeded",
    });
  });
  it("a later boot on the original version proves the update did not take", () => {
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "new" })).toEqual({
      kind: "failed",
      reason: "The update did not take: this Mate is still on 1.",
    });
  });
  it("an absent original boot cannot prove a restart on the same version", () => {
    expect(updateOutcome({ from: "1" }, { serverVersion: "1", bootId: "new" })).toBeNull();
  });
  describe("a press that only a container restart answers", () => {
    const Z = "Zerops Control Plane";
    const line = (input: {
      readonly zcp?: { installed: string; latest: string; behind: boolean };
      readonly latest?: string;
      readonly available?: boolean;
      readonly restart?: NonNullable<ExecutionEnvironmentUpdate["restart"]>;
    }): ExecutionEnvironmentUpdate => ({
      installed: "1",
      latest: input.latest ?? "1",
      available: input.available ?? false,
      checkedAt: "now",
      ...(input.zcp === undefined ? {} : { zcp: input.zcp }),
      restart: input.restart ?? { needed: false },
    });
    const behind = { installed: "9.225.0", latest: "9.226.0", behind: true };
    const current = { installed: "9.226.0", latest: "9.226.0", behind: false };
    const restart = { ...pressed, restart: { zcp: "9.226.0" } };
    const answered = { attempt: "restart-1", target: { zcp: "9.226.0" }, bootId: "old" };
    const postponed = (attempt: string, startedAt: string) =>
      line({
        zcp: behind,
        restart: {
          needed: true,
          phase: "postponed",
          reason: "its work wasn't done within 10 minutes",
          attempt,
          startedAt,
        },
      });
    it.each([
      {
        name: "the same boot, still draining, proves nothing",
        server: { serverVersion: "1", bootId: "old", update: line({ zcp: behind }) },
        expected: null,
      },
      {
        name: "its own attempt postponed settles it, saying why",
        server: { serverVersion: "1", bootId: "old", update: postponed("restart-1", "t1") },
        expected: {
          kind: "failed",
          reason: "Update postponed; its work wasn't done within 10 minutes",
        },
      },
      {
        name: "an older attempt postponed is not this press's",
        server: { serverVersion: "1", bootId: "old", update: postponed("restart-0", "t0") },
        expected: null,
      },
      {
        name: "the next boot with zcp current proves it",
        server: { serverVersion: "1", bootId: "new", update: line({ zcp: current }) },
        expected: { kind: "succeeded" },
      },
      {
        name: "the next boot on the version pressed for proves it, written as zcp writes it",
        server: {
          serverVersion: "1",
          bootId: "new",
          update: line({ zcp: { installed: "v9.226.0", latest: "", behind: false } }),
        },
        expected: { kind: "succeeded" },
      },
      {
        name: "the next boot with zcp still behind did not take",
        server: { serverVersion: "1", bootId: "new", update: line({ zcp: behind }) },
        expected: { kind: "failed", reason: `The restart didn't install ${Z} 9.226.0.` },
      },
      {
        name: "the next boot with no release evidence proves nothing yet",
        server: {
          serverVersion: "1",
          bootId: "new",
          update: line({ zcp: { installed: "9.225.0", latest: "", behind: false } }),
        },
        expected: null,
      },
      {
        name: "the next boot with no reading of zcp proves nothing yet",
        server: { serverVersion: "1", bootId: "new" },
        expected: null,
      },
    ])("$name", ({ server, expected }) => {
      expect(updateOutcome(restart, server, answered)).toEqual(expected);
    });
    it.each([
      {
        name: "on the version pressed for",
        server: { serverVersion: "2", update: line({ zcp: current, latest: "2" }) },
        expected: { kind: "succeeded" },
      },
      {
        name: "current with a known latest",
        server: { serverVersion: "3", update: line({ zcp: current, latest: "3" }) },
        expected: { kind: "succeeded" },
      },
      {
        name: "still behind",
        server: {
          serverVersion: "1",
          update: line({ zcp: current, latest: "2", available: true }),
        },
        expected: { kind: "failed", reason: "The restart didn't install mate 2." },
      },
      {
        name: "with no manifest",
        server: { serverVersion: "1", update: line({ zcp: current, latest: "" }) },
        expected: null,
      },
    ])("a restart for mate too: the next boot $name", ({ server, expected }) => {
      const both = { ...pressed, restart: { zcp: "9.226.0", mate: "2" } };
      expect(
        updateOutcome(
          both,
          { ...server, bootId: "new" },
          {
            ...answered,
            target: { zcp: "9.226.0", mate: "2" },
          },
        ),
      ).toEqual(expected);
    });
    it("a next boot that cannot say stays unconfirmed, for the wait to bound", () => {
      expect(updateVerdict(restart, { serverVersion: "1", bootId: "new" }, answered)).toBe(
        "unconfirmed",
      );
    });
    it("a press the server answered as a restart is judged as one, whatever the press thought", () => {
      expect(
        updateOutcome(
          pressed,
          { serverVersion: "1", bootId: "new", update: line({ zcp: current }) },
          answered,
        ),
      ).toEqual({ kind: "succeeded" });
    });
    it("a lost answer settles on any restart started after the press, by the server's clock", () => {
      const seen = { ...restart, seenRestart: "t1" };
      expect(
        updateOutcome(seen, {
          serverVersion: "1",
          bootId: "old",
          update: postponed("restart-1", "t1"),
        }),
      ).toBeNull();
      expect(
        updateOutcome(seen, {
          serverVersion: "1",
          bootId: "old",
          update: postponed("restart-2", "t2"),
        }),
      ).toEqual({
        kind: "failed",
        reason: "Update postponed; its work wasn't done within 10 minutes",
      });
      expect(
        updateOutcome(seen, { serverVersion: "1", bootId: "new", update: line({ zcp: current }) }),
      ).toEqual({ kind: "succeeded" });
    });
    it("a press answered during a reboot waits for the boot after the one that answered", () => {
      const during = { ...answered, bootId: "mid" };
      expect(
        updateOutcome(
          restart,
          { serverVersion: "1", bootId: "mid", update: line({ zcp: behind }) },
          during,
        ),
      ).toBeNull();
      expect(
        updateOutcome(
          restart,
          { serverVersion: "1", bootId: "new", update: line({ zcp: current }) },
          during,
        ),
      ).toEqual({ kind: "succeeded" });
    });
  });
});
