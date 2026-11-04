import { describe, expect, it } from "vite-plus/test";

import { MCP_NOTES_START, mcpNoteLines, mcpNoteStep } from "./mcpTurnNotes.logic";

describe("what a Mate hears of the MCP servers the person added", () => {
  const added = mcpNoteStep(MCP_NOTES_START, { kind: "added", name: "linear" });

  it("tells a server added here once, with the next message", () => {
    const seen = mcpNoteStep(added, { kind: "seen", name: "linear", line: "Linear is connected." });
    expect(mcpNoteLines(seen)).toEqual(["Linear is connected."]);
    const told = mcpNoteStep(seen, { kind: "told", lines: ["Linear is connected."] });
    expect(mcpNoteLines(told)).toEqual([]);
    expect(
      mcpNoteLines(
        mcpNoteStep(told, { kind: "seen", name: "linear", line: "Linear is connected." }),
      ),
    ).toEqual([]);
  });

  it("tells it again once it stands differently, the newest word only", () => {
    const waiting = mcpNoteStep(added, { kind: "seen", name: "linear", line: "waits for sign-in" });
    const told = mcpNoteStep(waiting, { kind: "told", lines: ["waits for sign-in"] });
    const connected = mcpNoteStep(told, { kind: "seen", name: "linear", line: "connected" });
    expect(mcpNoteLines(connected)).toEqual(["connected"]);
    const changedBeforeSending = mcpNoteStep(
      mcpNoteStep(added, { kind: "seen", name: "linear", line: "connecting" }),
      { kind: "seen", name: "linear", line: "connected" },
    );
    expect(mcpNoteLines(changedBeforeSending)).toEqual(["connected"]);
  });

  it("never tells a server this tab did not add", () => {
    expect(
      mcpNoteLines(mcpNoteStep(MCP_NOTES_START, { kind: "seen", name: "github", line: "GitHub" })),
    ).toEqual([]);
  });

  it("keeps what a send did not carry for the next one", () => {
    const two = mcpNoteStep(
      mcpNoteStep(mcpNoteStep(added, { kind: "added", name: "github" }), {
        kind: "seen",
        name: "linear",
        line: "Linear",
      }),
      { kind: "seen", name: "github", line: "GitHub" },
    );
    expect(mcpNoteLines(mcpNoteStep(two, { kind: "told", lines: ["GitHub"] }))).toEqual(["Linear"]);
  });
});
