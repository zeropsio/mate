import { expect, it } from "vite-plus/test";
import { projectActivityLimit, projectLimitEntry } from "./mateLimit.ts";
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
