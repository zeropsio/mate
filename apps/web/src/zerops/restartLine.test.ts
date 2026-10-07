import { describe, expect, it } from "vite-plus/test";

import { mateNoticeVoice, RESTART_LINES } from "./mateNoticeVoice";
import { restartLineFor } from "./restartLine";

describe("what a Mate says while it restarts", () => {
  it("keeps one line for the whole restart and moves to another on the next", () => {
    const first = restartLineFor("env-a", true);
    expect(restartLineFor("env-a", true)).toBe(first);
    expect(restartLineFor("env-a", true)).toBe(first);
    expect(restartLineFor("env-a", false)).toBeUndefined();
    const second = restartLineFor("env-a", true);
    expect(second).not.toBe(first);
    expect(restartLineFor("env-a", true)).toBe(second);
  });

  it("says the picked line, and plays the restart on its face", () => {
    const say = (restartLine: number) =>
      mateNoticeVoice({
        reachability: { kind: "ready", notice: { level: "restarting", by: "you", overdue: false } },
        conversationShown: false,
        nowMs: 0,
        mateName: "Rosa",
        restartLine,
      });
    const lines = RESTART_LINES.map((_, at) => say(at));
    expect(new Set(lines.map((voice) => ("text" in voice ? voice.text : null))).size).toBe(
      RESTART_LINES.length,
    );
    expect(say(RESTART_LINES.length)).toEqual(say(0));
    for (const voice of lines) expect(voice).toMatchObject({ restarting: true, face: "waking" });
  });
});
