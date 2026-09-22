import { describe, expect, it } from "vite-plus/test";

import { creationRefreshWanted } from "./creationRefresh";

describe("creationRefreshWanted", () => {
  // The owner's run of 2026-09-17: the card waited at "Almost there." on a
  // Mate that had answered minutes earlier, because the pushed inventory had
  // not delivered its container; a reload found it at once.
  const cases = [
    {
      name: "a creation this browser has not connected to yet",
      creationPending: true,
      waitPhase: null,
      want: true,
    },
    {
      name: "a wait still looking for its project",
      creationPending: false,
      waitPhase: "awaiting-project",
      want: true,
    },
    {
      name: "a wait still looking for its container",
      creationPending: false,
      waitPhase: "awaiting-container",
      want: true,
    },
    {
      name: "a wait still settling before it can be hardened",
      creationPending: false,
      waitPhase: "awaiting-settled",
      want: true,
    },
    {
      name: "a wait running the birth's one restart",
      creationPending: false,
      waitPhase: "hardening",
      want: true,
    },
    {
      name: "a wait already probing the container by HTTP",
      creationPending: false,
      waitPhase: "awaiting-health",
      want: false,
    },
    { name: "a wait that has settled", creationPending: false, waitPhase: "ready", want: false },
    { name: "nothing on its way", creationPending: false, waitPhase: null, want: false },
  ] as const;

  for (const tc of cases) {
    it(tc.name, () => {
      expect(
        creationRefreshWanted({ creationPending: tc.creationPending, waitPhase: tc.waitPhase }),
      ).toBe(tc.want);
    });
  }
});
