import { describe, expect, it } from "vite-plus/test";
import { mateNoticeVoice } from "./mateNoticeVoice";
import { restartLine, RESTART_LINES } from "./restartLine";

describe("what a Mate says while it restarts", () => {
  it("rotates short named lines for an ongoing restart", () => {
    const lines = RESTART_LINES.map((_, cycle) => restartLine("Rosa", cycle));
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) {
      expect(line).toContain("Rosa");
      expect(line).not.toContain("I'm");
    }
    expect(restartLine("Rosa", lines.length)).toBe(lines[0]);
  });
  it("says the picked line, and plays the restart on its face", () => {
    for (let cycle = 0; cycle < RESTART_LINES.length; cycle++) {
      expect(
        mateNoticeVoice({
          reachability: {
            kind: "ready",
            notice: { level: "restarting", by: "you", overdue: false },
          },
          conversationShown: false,
          nowMs: 0,
          mateName: "Rosa",
          restartLine: cycle,
        }),
      ).toMatchObject({ restarting: true, face: "waking", secondary: restartLine("Rosa", cycle) });
    }
  });
});
