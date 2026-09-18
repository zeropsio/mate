import { describe, expect, it } from "vite-plus/test";

import {
  claudeUsageResponseToLimits,
  codexPlanLabel,
  codexRateLimitsToLimits,
  makeUnavailableUsageLimits,
} from "./usageLimitsSupport.ts";

/**
 * Pins the re-exports `usageLimitsSupport.ts` carries out of the ported zone
 * for `apps/server/src/usage/cliproxyApi.ts`. A port that renames, reshapes,
 * or changes the output of any of them fails here, not at the hub call site —
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

  describe("makeUnavailableUsageLimits", () => {
    it("marks the limits unavailable with no windows", () => {
      expect(
        makeUnavailableUsageLimits({
          checkedAt: "2026-09-05T12:00:00.000Z",
          reason: "probeFailed",
          message: "The hub could not read this account.",
        }),
      ).toEqual({
        checkedAt: "2026-09-05T12:00:00.000Z",
        windows: [],
        unavailable: { reason: "probeFailed", message: "The hub could not read this account." },
      });
    });
  });

  describe("claudeUsageResponseToLimits", () => {
    it("reads Claude's session and weekly utilization as windows", () => {
      const { limits } = claudeUsageResponseToLimits({
        checkedAt: "2026-09-05T12:00:00.000Z",
        response: {
          rate_limits_available: true,
          rate_limits: {
            five_hour: { utilization: 40, resets_at: "2026-09-05T15:00:00.000Z" },
            seven_day: { utilization: 20, resets_at: "2026-09-10T12:00:00.000Z" },
          },
        } as never,
      });
      expect(limits.windows.map((window) => [window.kind, window.usedPercent])).toEqual([
        ["session", 40],
        ["weekly", 20],
      ]);
    });

    it("reports unsupported when the response carries no rate limits", () => {
      const { limits } = claudeUsageResponseToLimits({
        checkedAt: "2026-09-05T12:00:00.000Z",
        response: { rate_limits_available: false } as never,
      });
      expect(limits.unavailable?.reason).toBe("unsupported");
    });
  });

  describe("codexRateLimitsToLimits", () => {
    it("reads Codex's primary and secondary windows and banked reset credits", () => {
      const limits = codexRateLimitsToLimits({
        checkedAt: "2026-09-05T12:00:00.000Z",
        snapshot: {
          primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1_788_000_000 },
          secondary: { usedPercent: 10, windowDurationMins: 10_080, resetsAt: 1_788_500_000 },
        } as never,
        resetCredits: { availableCount: 2, credits: [] } as never,
      });
      expect(limits.windows.map((window) => window.usedPercent)).toEqual([30, 10]);
      expect(limits.resetCredits?.availableCount).toBe(2);
    });
  });
});
