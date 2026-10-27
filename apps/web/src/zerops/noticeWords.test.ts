import { describe, expect, it } from "vite-plus/test";
import { mateFailureWords, usageLimitWords } from "./noticeWords";
import { projectLimitError } from "@t3tools/client-runtime/data";

describe("usage notices", () => {
  it.each(["Claude", "Codex", "Grok", "OpenCode"])("recognizes %s's own limit", (name) => {
    expect(projectLimitError(`${name} usage limit reached. Try again later.`)?.provider).toBe(name);
    expect(usageLimitWords(name, undefined, "Rosa")).toBe(`Rosa hit the ${name} limit.`);
  });
  it("does not guess an agent from a notice that names none", () => {
    const provider = projectLimitError("You've hit your session limit");
    expect(provider?.provider).toBe("coding agent");
    expect(usageLimitWords(provider!.provider)).toBe("The Mate hit the coding agent's limit.");
  });
  it("does not reinterpret a failed task about limits as a limit", () => {
    expect(projectLimitError("Could not test Claude usage limit reached handling")).toBeNull();
    expect(projectLimitError("Git could not authenticate")).toBeNull();
  });
  it("A retained sign-in refusal describes the failed turn, not current admission", () => {
    const error = "Claude's sign-in has expired. Sign Claude in again.";
    expect(mateFailureWords(error, "claudeAgent")).toBe(
      "The Mate's turn could not continue because Claude was signed out.",
    );
    expect(mateFailureWords(error, "codex")).toBe(error);
  });
  it("retains the source's cause for a broken action", () => {
    expect(mateFailureWords("Git could not authenticate with the remote.")).toBe(
      "Git could not authenticate with the remote.",
    );
  });
  // Milo's run 4 (L7): Claude said "You've hit your weekly limit"; the notice never said "weekly".
  it.each([
    { provider: "Claude", window: "7-day", says: "Rosa hit Claude's weekly limit." },
    { provider: "Claude", window: "7-day Opus", says: "Rosa hit Claude's weekly Opus limit." },
    { provider: "Codex", window: "5-hour", says: "Rosa hit Codex's 5-hour limit." },
    {
      provider: "coding agent",
      window: "7-day",
      says: "Rosa hit the coding agent's weekly limit.",
    },
    { provider: "Claude", window: "usage", says: "Rosa hit the Claude limit." },
    { provider: "Claude", window: undefined, says: "Rosa hit the Claude limit." },
  ])(
    "names the window the limit's record names ($provider, $window)",
    ({ provider, window, says }) => {
      expect(usageLimitWords(provider, undefined, "Rosa", window)).toBe(says);
    },
  );
  it("only gives a reset time when the source supplies one", () => {
    expect(usageLimitWords("Claude", "16:00")).toBe(
      "The Mate hit the Claude limit — can continue at 16:00.",
    );
  });
});
