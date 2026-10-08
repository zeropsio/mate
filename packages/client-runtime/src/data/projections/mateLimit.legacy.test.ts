import { projectMateLimit, projectLimitEntry, projectLimitError } from "./mateLimit.ts";
import { describe, expect, it } from "vite-plus/test";

describe("provider refusal deadlines", () => {
  it("a weekly refusal with only a time of day cannot invent tomorrow as its reset", () => {
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
  it("the provider's dated reset governs a weekly refusal", () => {
    const evidence = {
      latestTurn: {
        turnId: "refused",
        state: "error",
        startedAt: "2026-10-08T09:00:00Z",
        completedAt: null,
      },
      session: {
        lastError: "Claude usage limit reached.",
        usageLimitResetAt: "2026-10-12T02:00:00Z",
      },
      latestMessagePreview: {
        role: "assistant",
        text: "You've hit your weekly limit · resets 2am (UTC)",
      },
    };
    expect(projectMateLimit(evidence, Date.parse("2026-10-09T02:00:00Z")).kind).toBe("limited");
    expect(projectMateLimit(evidence, Date.parse(evidence.session.usageLimitResetAt)).kind).toBe(
      "expired",
    );
  });
});

it("names the known driver when Claude's refusal wording is generic", () => {
  expect(projectLimitError("You've hit your weekly limit", "claudeAgent")?.provider).toBe("Claude");
  expect(projectLimitError("99% used", "claudeAgent")).toBeNull();
});
