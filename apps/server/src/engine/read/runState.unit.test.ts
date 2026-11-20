import { Run, type RunEnd } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { turnStateOf, runStatusOf } from "./runState.ts";

const decodeRun = Schema.decodeUnknownSync(Run);
const fixtureRun = (state: string, end: RunEnd | null, id = "run") =>
  decodeRun({
    id,
    conversationId: "conversation",
    ordinal: 1,
    seq: 1,
    rev: 1,
    trigger: { kind: "person", itemId: "item" },
    joins: null,
    principal: { kind: "engine" },
    state,
    maintenance: false,
    waitingOn: state === "waiting" ? { kind: "request", requestId: "request" } : null,
    stopAsked: null,
    end,
    endSource: null,
    sessionId: null,
    providerTurnId: null,
    queuedAt: 0,
    admittedAt: ["admitted", "sending", "running", "waiting", "ended"].includes(state) ? 1 : null,
    startedAt: ["running", "waiting", "ended"].includes(state) ? 2 : null,
    endedAt: state === "ended" ? 3 : null,
    unresponsiveSince: null,
  });

// witness: apps/server/src/engine/read/runState.ts | return "interrupted"; → return "error";
it("RS1: A run reads as a running turn from its admission until it ends and as none while queued or in a state this build does not know; its end reads completed, interrupted when stopped, cut by a restart or held by a usage limit, broken when it failed or crashed, and none for an end kind this build does not know; breaks: a stopped turn shows as an error, or a queued message as working", () => {
  for (const [state, expected] of [
    ["admitted", "running"],
    ["sending", "running"],
    ["running", "running"],
    ["waiting", "running"],
    ["queued", null],
    ["unknown", null],
  ] as const) {
    expect(turnStateOf(fixtureRun(state, null)), state).toBe(expected);
  }

  for (const [end, expected] of [
    [{ kind: "completed" }, "completed"],
    [{ kind: "stopped", by: { kind: "engine" } }, "interrupted"],
    [{ kind: "cut-by-restart", continuedBy: null }, "interrupted"],
    [{ kind: "usage-limit", resetsAt: null }, "interrupted"],
    [{ kind: "failed", reason: "x", next: null }, "error"],
    [{ kind: "crashed", reason: "x" }, "error"],
    [{ kind: "unknown", type: "future" }, null],
    [null, null],
  ] as const) {
    expect(turnStateOf(fixtureRun("ended", end)), end?.kind ?? "missing end").toBe(expected);
  }
});

// witness: apps/server/src/engine/read/runState.ts | return isRefusedAttempt(end) ? "interrupted" : "error"; → return "error";
it("RS2: An attempt admission refused because the sender may not use the login or nobody is on record for it never ran: it reads interrupted and leaves its conversation ready, while a refusal whose reason this build does not know reads broken; breaks: another person's refused message marks the conversation failed", () => {
  for (const [reason, turn, status] of [
    ["not-permitted", "interrupted", "ready"],
    ["unrecorded", "interrupted", "ready"],
    ["unknown", "error", "error"],
  ] as const) {
    const lastEnded = fixtureRun("ended", {
      kind: "failed",
      reason: "x",
      next: null,
      admission: { loginId: "claude-code", reason },
    });
    expect(turnStateOf(lastEnded), reason).toBe(turn);
    expect(runStatusOf({ activeRun: null, lastEnded }), reason).toBe(status);
  }
});

// witness: apps/server/src/engine/read/runState.ts | if (view.activeRun !== null) return "running"; → if (view.activeRun === null) return "running";
it("RS3: A conversation reads running while a run is on, even when its last run broke; at rest it reads error only when its last run broke, otherwise ready; breaks: a working conversation shows an error, or a broken one shows ready", () => {
  const activeRun = fixtureRun("running", null, "active-run");
  for (const end of [
    { kind: "crashed", reason: "x" },
    { kind: "failed", reason: "x", next: null },
  ] as const) {
    const lastEnded = fixtureRun("ended", end);
    expect(runStatusOf({ activeRun, lastEnded }), end.kind).toBe("running");
    expect(runStatusOf({ activeRun: null, lastEnded }), end.kind).toBe("error");
  }
  for (const end of [{ kind: "completed" }, { kind: "stopped", by: { kind: "engine" } }] as const) {
    expect(runStatusOf({ activeRun: null, lastEnded: fixtureRun("ended", end) }), end.kind).toBe(
      "ready",
    );
  }
  expect(runStatusOf({ activeRun: null, lastEnded: null })).toBe("ready");
});
