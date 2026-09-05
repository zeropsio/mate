import { describe, expect, it } from "vite-plus/test";

import { clampPercent, codexPlanLabel, makeUsageLimits } from "./usageLimitsSupport.ts";

/**
 * Pins the three re-exports `usageLimitsSupport.ts` carries out of the
 * ported zone (`provider/Layers/CodexProvider.ts`,
 * `provider/providerUsageLimits.ts`) for `apps/server/src/usage/
 * cliproxyUsageLimits.ts`. A port that renames, reshapes, or changes the
 * output of any of the three fails here, not at the cliproxy call site —
 * see the doc comment on `usageLimitsSupport.ts`.
 */
describe("usageLimitsSupport", () => {
  describe("codexPlanLabel", () => {
    it.each([
      ["free", "ChatGPT Free Subscription"],
      ["go", "ChatGPT Go Subscription"],
      ["plus", "ChatGPT Plus Subscription"],
      ["pro", "ChatGPT Pro 20x Subscription"],
      ["prolite", "ChatGPT Pro 5x Subscription"],
      ["team", "ChatGPT Team Subscription"],
      ["business", "ChatGPT Business Subscription"],
      ["self_serve_business_prolite", "ChatGPT Business Subscription"],
      ["self_serve_business_usage_based", "ChatGPT Business Subscription"],
      ["enterprise", "ChatGPT Enterprise Subscription"],
      ["ent26", "ChatGPT Enterprise Subscription"],
      ["enterprise_cbp_automation", "ChatGPT Enterprise Subscription"],
      ["enterprise_cbp_usage_based", "ChatGPT Enterprise Subscription"],
      ["edu", "ChatGPT Edu Subscription"],
      ["edu_plus", "ChatGPT Edu Subscription"],
      ["edu_pro", "ChatGPT Edu Subscription"],
      ["unknown", "ChatGPT Subscription"],
    ] as const)("maps plan type %s to %s", (planType, label) => {
      expect(codexPlanLabel(planType)).toBe(label);
    });

    it.each([null, undefined, "", "not-a-real-plan"] as const)(
      "returns undefined for an unrecognized plan type (%j)",
      (planType) => {
        expect(codexPlanLabel(planType)).toBeUndefined();
      },
    );
  });

  describe("clampPercent", () => {
    it.each([
      [-50, 0],
      [-0.001, 0],
      [0, 0],
      [42.5, 42.5],
      [100, 100],
      [100.5, 100],
      [1_000, 100],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [Number.NEGATIVE_INFINITY, 0],
    ])("clamps %s to %s", (value, expected) => {
      expect(clampPercent(value)).toBe(expected);
    });
  });

  describe("makeUsageLimits", () => {
    const checkedAt = "2026-09-05T12:00:00.000Z";
    const session = {
      id: "five_hour",
      kind: "session",
      label: "Session",
      usedPercent: 40,
    } as const;
    const weekly = {
      id: "seven_day",
      kind: "weekly",
      label: "Weekly",
      usedPercent: 20,
    } as const;
    const monthly = {
      id: "thirty_day",
      kind: "monthly",
      label: "Monthly",
      usedPercent: 10,
    } as const;
    const other = {
      id: "credits",
      kind: "other",
      label: "Credits",
      usedPercent: 5,
    } as const;

    it("carries checkedAt through unchanged", () => {
      expect(makeUsageLimits({ checkedAt, windows: [session] }).checkedAt).toBe(checkedAt);
    });

    it("sorts windows by kind (session, weekly, monthly, other) regardless of input order", () => {
      expect(
        makeUsageLimits({ checkedAt, windows: [other, monthly, weekly, session] }).windows,
      ).toEqual([session, weekly, monthly, other]);
    });

    it("breaks a tie within the same kind by id", () => {
      const sessionB = { ...session, id: "z_session" };
      expect(makeUsageLimits({ checkedAt, windows: [sessionB, session] }).windows).toEqual([
        session,
        sessionB,
      ]);
    });

    it("returns an empty windows array for no windows", () => {
      expect(makeUsageLimits({ checkedAt, windows: [] }).windows).toEqual([]);
    });
  });
});
