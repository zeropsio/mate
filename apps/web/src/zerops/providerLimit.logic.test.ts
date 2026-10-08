import { describe, expect, it } from "vite-plus/test";
import {
  currentProviderLimit,
  readUsageLimitNotice,
  usageLimitProvider,
} from "./providerLimit.logic";

describe("provider refusal deadlines", () => {
  it("a weekly refusal with only a time of day cannot invent tomorrow as its reset", () => {
    expect(
      readUsageLimitNotice(
        "You've hit your weekly limit · resets 2am (UTC)",
        "2026-10-08T09:00:00Z",
      ),
    ).toEqual({ resetsAt: null });
  });
  it("the provider's dated reset governs a weekly refusal", () => {
    const evidence = {
      pause: null,
      lastError: "Claude usage limit reached.",
      lastMessage: "You've hit your weekly limit · resets 2am (UTC)",
      noticeAt: "2026-10-08T09:00:00Z",
      resetAt: "2026-10-12T02:00:00Z",
    };
    expect(
      currentProviderLimit({ ...evidence, nowMs: Date.parse("2026-10-09T02:00:00Z") }).current,
    ).toBe(true);
    expect(currentProviderLimit({ ...evidence, nowMs: Date.parse(evidence.resetAt) }).expired).toBe(
      true,
    );
  });
});

it("names the known driver when Claude's refusal wording is generic", () => {
  expect(usageLimitProvider("You've hit your weekly limit", "claudeAgent")).toBe("Claude");
  expect(usageLimitProvider("99% used", "claudeAgent")).toBeNull();
});
