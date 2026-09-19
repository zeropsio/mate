import { describe, expect, it } from "vite-plus/test";

import { agentNeedsSignIn } from "./agentSignIn.ts";

describe("an agent refusing for want of credentials", () => {
  it("recognises the Claude driver's own sentence", () => {
    expect(
      agentNeedsSignIn(
        "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.",
      ),
    ).toBe(true);
  });

  it("recognises another driver's, which words the rest differently", () => {
    expect(
      agentNeedsSignIn("Antigravity could not authenticate with the configured credentials."),
    ).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(agentNeedsSignIn("The container is not reachable.")).toBe(false);
    expect(agentNeedsSignIn(null)).toBe(false);
    expect(agentNeedsSignIn(undefined)).toBe(false);
    expect(agentNeedsSignIn("")).toBe(false);
  });
});
