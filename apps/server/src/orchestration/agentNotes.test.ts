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

  it("is the whole turn when there is no text to carry", () => {
    expect(withAgentNotes("", ["appdev #1 landed on main."])).toBe(
      "<zerops-update>\nappdev #1 landed on main.\n</zerops-update>",
    );
  });
});
