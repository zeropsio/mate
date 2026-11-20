import { expect, it } from "vite-plus/test";
import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { updateOutcome } from "./mateUpdate.ts";

const pressed = { from: "1", bootId: "old" };

// witness: packages/client-runtime/src/data/operations/mateUpdate.ts | server.serverVersion !== pressed.from → server.serverVersion === pressed.from
it("OP13: A dropped socket or the same boot proves no outcome of a Mate's update", () => {
  expect(updateOutcome(pressed, null)).toBeNull();
  expect(updateOutcome(pressed, { serverVersion: "1", bootId: "old" })).toBeNull();
  expect(updateOutcome(pressed, { serverVersion: "1" })).toBeNull();
});

// witness: packages/client-runtime/src/data/operations/mateUpdate.ts | restartVerdict(pressed.restart, pressed, server, answer) → restartVerdict(pressed.restart, pressed, server, pressed)
it("OP14: A press answered during a reboot waits for the boot after the one that answered", () => {
  const line = (
    zcp: NonNullable<ExecutionEnvironmentUpdate["zcp"]>,
  ): ExecutionEnvironmentUpdate => ({
    installed: "1",
    latest: "1",
    available: false,
    checkedAt: "now",
    zcp,
    restart: { needed: zcp.behind },
  });
  const behind = { installed: "9.225.0", latest: "9.226.0", behind: true };
  const current = { installed: "9.226.0", latest: "9.226.0", behind: false };
  const restart = { ...pressed, restart: { zcp: "9.226.0" } };
  const during = { bootId: "mid" };
  expect(
    updateOutcome(restart, { serverVersion: "1", bootId: "mid", update: line(behind) }, during),
  ).toBeNull();
  expect(
    updateOutcome(restart, { serverVersion: "1", bootId: "new", update: line(current) }, during),
  ).toEqual({ kind: "succeeded" });
});
