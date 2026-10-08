import { describe, expect, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { quiesceV1NativeSessions, v1ThreadBlockers } from "./V1UpdateDrain.ts";

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

describe("legacy native session drain", () => {
  it.effect.each([
    { name: "a completed native stop permits switching", exited: true, idle: true },
    { name: "a stop failure recorded as activity postpones switching", exited: false, idle: false },
  ])("$name", ({ exited, idle }) =>
    Effect.gen(function* () {
      let sessions = [{ threadId: ThreadId.make("existing-conversation") }];
      let requested = false;
      const result = yield* quiesceV1NativeSessions({
        closed: Effect.succeed(true),
        facts: Effect.succeed({ idle: true, blockers: [] }),
        sessions: Effect.sync(() => sessions),
        stop: () =>
          Effect.sync(() => {
            requested = true;
          }),
        settle: Effect.sync(() => {
          if (exited) sessions = [];
        }),
      });
      expect(requested).toBe(true);
      expect(result.idle).toBe(idle);
      if (!exited) expect(result.blockers).toContain("native session did not close");
    }),
  );
});
