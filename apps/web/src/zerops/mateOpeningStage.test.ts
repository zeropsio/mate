import { describe, expect, it } from "vite-plus/test";

import { mateOpeningStage } from "./mateOpeningStage";

// A reload of a Mate's conversation, before its thread is read: its stage speaks, never a blank
// pane (the owner, 2026-09-30), with the route's own words where the link has any.
describe("mateOpeningStage", () => {
  it.each([
    {
      case: "a blip: the face and the name, nothing said",
      voice: { surface: "none" },
      pastQuiet: false,
      text: null,
    },
    {
      case: "past the quiet: it opens",
      voice: { surface: "none" },
      pastQuiet: true,
      text: "Opening Quinn…",
    },
    {
      case: "a restart the route knows: its words, on the stage",
      voice: { surface: "banner", text: "Quinn is restarting.", actions: [], processes: false },
      pastQuiet: false,
      text: "Quinn is restarting.",
    },
    {
      case: "a reconnect with Try now: its words and its verb",
      voice: {
        surface: "banner",
        text: "Reconnecting to Quinn…",
        actions: ["try-now"],
        processes: false,
      },
      pastQuiet: true,
      text: "Reconnecting to Quinn…",
    },
  ] as const)("$case", ({ voice, pastQuiet, text }) => {
    const stage = mateOpeningStage({ voice, pastQuiet, mateName: "Quinn" });
    expect(stage.surface).toBe("stage");
    expect(stage.text).toBe(text);
    expect(stage.actions).toEqual(voice.surface === "none" ? [] : voice.actions);
  });
});
