import { describe, expect, it } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";
import { v1ThreadBlockers } from "./V1UpdateDrain.ts";

describe("legacy update idle proof", () => {
  it.each([
    {
      name: "active native turn",
      session: { status: "ready" as const, activeTurnId: TurnId.make("running") },
      latestTurn: null,
      reason: "active turn",
    },
    {
      name: "durably running turn",
      session: null,
      latestTurn: { state: "running" },
      reason: "active turn",
    },
    {
      name: "session opening",
      session: { status: "starting" as const, activeTurnId: null },
      latestTurn: null,
      reason: "session opening or running",
    },
    {
      name: "running provider",
      session: { status: "running" as const, activeTurnId: null },
      latestTurn: null,
      reason: "session opening or running",
    },
    {
      name: "title maintenance",
      session: null,
      latestTurn: null,
      titleRegeneration: {},
      reason: "title generation",
    },
  ])("$name postpones automatic updating", ({ reason, ...state }) =>
    expect(v1ThreadBlockers(state)).toContain(reason),
  );

  it("an idle native session remains ready for graceful close and resume", () =>
    expect(
      v1ThreadBlockers({
        session: { status: "ready", activeTurnId: null },
        latestTurn: { state: "completed" },
      }),
    ).toEqual([]));
});
