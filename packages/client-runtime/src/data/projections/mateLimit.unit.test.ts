import { TurnId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { projectActivityLimit, projectLimitEntry, projectMateLimit } from "./mateLimit.ts";
// witness: packages/client-runtime/src/data/projections/mateLimit.ts | fields.status !== "rejected" || → fields.status === "rejected" ||
it("PJ75: Only an admission the provider rejected without allowed overage is evidence of a usage limit", () => {
  expect(
    projectActivityLimit("Claude usage limit reached.", {
      status: "rejected",
      resetsAt: 1791597600.123,
    }),
  ).toEqual({ provider: "Claude", resetsAt: "2026-10-10T02:00:00.123Z" });
  for (const detail of [
    { status: "allowed" },
    { status: "allowed_warning" },
    { status: "rejected", overageStatus: "allowed" },
    { status: "rejected", overageStatus: "allowed_warning" },
    { status: "rejected", isUsingOverage: true },
    { status: "rejected", overageInUse: true },
  ]) {
    expect(projectActivityLimit("Claude usage limit reached.", detail)).toEqual(null);
  }
});

// witness: packages/client-runtime/src/data/projections/mateLimit.ts | if (/\b(?:weekly|seven.day|7.day)\b/i.test(cli[0])) return { resetsAt: null }; → if (/\b(?:monthly|seven.day|7.day)\b/i.test(cli[0])) return { resetsAt: null };
it("PJ76: A weekly usage refusal that gives only a time of day cannot invent tomorrow as its reset", () => {
  expect(
    projectLimitEntry({
      kind: "message",
      createdAt: "2026-10-08T09:00:00Z",
      message: {
        role: "assistant",
        text: "You've hit your weekly limit · resets 2am (UTC)",
        createdAt: "2026-10-08T09:00:00Z",
      },
    }),
  ).toMatchObject({ resetsAt: null });
});

// witness: packages/client-runtime/src/data/projections/mateLimit.ts | source.refusal.resetsAt !== null && Date.parse(source.refusal.resetsAt) <= nowMs → source.refusal.resetsAt !== null && Date.parse(source.refusal.resetsAt) < nowMs
it("PJ95: A parked usage refusal reads limited until its provider deadline and expired from that instant, whether HQ's overview or the Mate's session carries it", () => {
  const deadline = "2026-10-08T10:00:01.000Z";
  const refused = {
    latestTurn: null,
    session: null,
    refusal: { turnId: TurnId.make("refused"), provider: "Claude", resetsAt: deadline },
  };
  expect(projectMateLimit(refused, Date.parse(deadline) - 1)).toEqual({
    kind: "limited",
    turnId: "refused",
    provider: "Claude",
    resetsAt: deadline,
  });
  expect(projectMateLimit(refused, Date.parse(deadline))).toEqual({
    kind: "expired",
    turnId: "refused",
    provider: "Claude",
    resetsAt: deadline,
  });
  const sessionRefused = {
    latestTurn: {
      turnId: "refused",
      state: "running",
      startedAt: "2026-10-08T10:00:00.000Z",
      completedAt: null,
    },
    session: {
      lastError: "You've hit your weekly limit",
      providerName: "claudeAgent",
      usageLimitResetAt: deadline,
      updatedAt: "2026-10-08T10:00:00.000Z",
    },
  };
  expect(projectMateLimit(sessionRefused, Date.parse(deadline) - 1)).toMatchObject({
    kind: "limited",
    turnId: "refused",
    resetsAt: deadline,
  });
  expect(projectMateLimit(sessionRefused, Date.parse(deadline))).toMatchObject({
    kind: "expired",
    turnId: "refused",
    resetsAt: deadline,
  });
});
