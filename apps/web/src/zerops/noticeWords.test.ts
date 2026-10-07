import { describe, expect, it } from "vite-plus/test";
import { mateFailureWords, usageLimitProvider, usageLimitWords } from "./noticeWords";

describe("usage notices", () => {
  it.each(["Claude", "Codex", "Grok", "OpenCode"])("recognizes %s's own limit", (name) => {
    expect(usageLimitProvider(`${name} usage limit reached. Try again later.`)).toBe(name);
    expect(usageLimitWords(name, undefined, "Rosa")).toBe(`Rosa hit the ${name} limit.`);
  });
  it("does not guess an agent from a notice that names none", () => {
    const provider = usageLimitProvider("You've hit your session limit");
    expect(provider).toBe("coding agent");
    expect(usageLimitWords(provider!)).toBe("The Mate hit the coding agent's limit.");
  });
  it("does not reinterpret a failed task about limits as a limit", () => {
    expect(usageLimitProvider("Could not test Claude usage limit reached handling")).toBeNull();
    expect(usageLimitProvider("Git could not authenticate")).toBeNull();
  });
  it("keeps sign-in requests in the same name-based voice", () => {
    const error = "Claude's sign-in has expired. Sign Claude in again.";
    expect(mateFailureWords(error, "claudeAgent")).toBe(
      "The Mate needs a Claude sign-in to continue.",
    );
    expect(mateFailureWords(error, "codex")).toBe(error);
  });
  it("retains the source's cause for a broken action", () => {
    expect(mateFailureWords("Git could not authenticate with the remote.")).toBe(
      "Git could not authenticate with the remote.",
    );
  });
  it("only gives a reset time when the source supplies one", () => {
    expect(usageLimitWords("Claude", "16:00")).toBe(
      "The Mate hit the Claude limit — can continue at 16:00.",
    );
  });
});
