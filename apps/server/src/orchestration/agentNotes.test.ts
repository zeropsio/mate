import { describe, expect, it } from "vite-plus/test";

import { withAgentNotes } from "./agentNotes.ts";

describe("withAgentNotes", () => {
  it("leaves a message exactly as it was when there is nothing to say", () => {
    expect(withAgentNotes("ship it", [])).toBe("ship it");
    expect(withAgentNotes("ship it", undefined)).toBe("ship it");
    expect(withAgentNotes("ship it", null)).toBe("ship it");
    // Blank notes are nothing to say, not an empty block.
    expect(withAgentNotes("ship it", ["", "   "])).toBe("ship it");
  });

  it("puts the notes in front of what the person typed, inside their own tag", () => {
    expect(withAgentNotes("what now?", ["appdev #1 landed on main."])).toBe(
      "<zerops-update>\nappdev #1 landed on main.\n</zerops-update>\n\nwhat now?",
    );
  });

  it.each([
    ["a built-in command", "/mcp"],
    ["a command with arguments", "/review main"],
    ["a command after blank space", "  /context"],
  ])("leaves %s alone, so the agent still runs it", (_name, text) => {
    // Notes in front of `/mcp` made Claude Code read prose and the model answer
    // it (Drew, 2026-10-03); they wait for the next message instead.
    expect(withAgentNotes(text, ["appdev #2 landed."])).toBe(text);
  });

  it("still tells the agent ahead of a message that opens with a path", () => {
    expect(withAgentNotes("/var/www/app.ts is broken", ["appdev #2 landed."])).toBe(
      "<zerops-update>\nappdev #2 landed.\n</zerops-update>\n\n/var/www/app.ts is broken",
    );
  });

  it("is the whole turn when there is no text to carry", () => {
    expect(withAgentNotes("", ["appdev #1 landed on main."])).toBe(
      "<zerops-update>\nappdev #1 landed on main.\n</zerops-update>",
    );
  });
});
