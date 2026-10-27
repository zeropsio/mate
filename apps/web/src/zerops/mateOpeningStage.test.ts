import { describe, expect, it } from "vite-plus/test";

import { stageSpeaks } from "./mateOpeningStage";

// A Mate's page while its conversation cannot show: the stage, with the Mate's face over its name,
// only for words of the link's own; opening it is the quiet page and its one line.
describe("stageSpeaks", () => {
  it.each([
    {
      case: "a blip: no words",
      voice: { surface: "stage", text: null, actions: [], processes: false },
      speaks: false,
    },
    {
      case: "a first connect past the quiet: the page's opening line",
      voice: { surface: "stage", text: "Opening Quinn…", actions: [], processes: true },
      speaks: false,
    },
    {
      case: "a first connect that is slow: the same line, with Try now under it",
      voice: { surface: "stage", text: "Opening Quinn…", actions: ["try-now"], processes: true },
      speaks: false,
    },
    {
      case: "a restart the route knows",
      voice: { surface: "stage", text: "Quinn is restarting.", actions: [], processes: false },
      speaks: true,
    },
    {
      case: "a reconnect with Try now",
      voice: {
        surface: "stage",
        text: "Reconnecting to Quinn…",
        actions: ["try-now"],
        processes: false,
      },
      speaks: true,
    },
    {
      case: "a container that is not running",
      voice: {
        surface: "stage",
        text: "This Mate isn't running.",
        actions: ["go-to-projects"],
        processes: false,
      },
      speaks: true,
    },
  ] as const)("$case", ({ voice, speaks }) => {
    expect(stageSpeaks(voice)).toBe(speaks);
  });
});
