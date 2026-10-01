import { describe, expect, it } from "vite-plus/test";

import { interruptedPresses } from "./matePress";

const mate = (serviceId: string | undefined, tags: ReadonlyArray<string>) => ({
  ...(serviceId === undefined ? {} : { service: { id: serviceId } }),
  project: { tagList: tags },
});

// A press interrupted before its close-off: the container carries the press's marker, its
// project no `mate:closed-off` (pass 28). *Finish setup* finishes it.
describe("interruptedPresses", () => {
  it.each([
    {
      case: "a marked container whose project was never marked closed off",
      mate: mate("zcp-a", ["mate"]),
      marker: true,
      interrupted: true,
    },
    {
      case: "a press that got as far as its close-off",
      mate: mate("zcp-a", ["mate", "mate:closed-off"]),
      marker: true,
      interrupted: false,
    },
    {
      case: "a Mate made before the press: no marker",
      mate: mate("zcp-a", ["mate"]),
      marker: false,
      interrupted: false,
    },
    {
      case: "a marker the store has not read yet",
      mate: mate("zcp-a", ["mate"]),
      marker: "unread" as const,
      interrupted: false,
    },
    {
      case: "a marker whose stream failed",
      mate: mate("zcp-a", ["mate"]),
      marker: "unknown" as const,
      interrupted: false,
    },
    {
      case: "a Mate with no container listed",
      mate: mate(undefined, ["mate"]),
      marker: true,
      interrupted: false,
    },
  ])("$case", ({ mate: candidate, marker, interrupted }) => {
    const markers = new Map([["zcp-a", marker]]);
    expect(interruptedPresses([candidate], markers).has("zcp-a")).toBe(interrupted);
  });
});
