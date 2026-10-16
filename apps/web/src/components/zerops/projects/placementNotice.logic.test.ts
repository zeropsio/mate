import { describe, expect, it } from "vite-plus/test";

import { placementNotice } from "./placementNotice.logic";

const read = { complete: true, reconnecting: false } as const;

describe("what the projects page says while it cannot sort Mates into projects", () => {
  it.each([
    {
      sentence: "says nothing once every Mate's project is known",
      status: read,
      hqDown: false,
      words: undefined,
    },
    {
      sentence: "says the projects are loading while they are read",
      status: { complete: false, reconnecting: false },
      hqDown: false,
      words: "Loading your projects…",
    },
    {
      sentence: "asks for a sign-in where the session was refused",
      status: { ...read, unavailableReason: "expired-session" as const },
      hqDown: false,
      words: "Projects not loaded — sign in again",
    },
    {
      sentence: "says the account cannot see them where access is denied",
      status: { ...read, unavailableReason: "forbidden" as const },
      hqDown: false,
      words: "Projects not loaded — your account can't see them",
    },
    {
      sentence: "says they could not be loaded where the read was refused",
      status: { ...read, unavailableReason: "refused" as const },
      hqDown: false,
      words: "Projects not loaded — they couldn't be read",
    },
    {
      sentence: "says it keeps trying while the team's HQ does not answer",
      status: { complete: false, reconnecting: true },
      hqDown: true,
      words: "Projects not loaded yet — trying again",
    },
  ])("$sentence", ({ status, hqDown, words }) => {
    const notice = placementNotice(status, hqDown);
    expect(notice).toBe(words);
    // Engine words never reach a person here.
    expect(notice ?? "").not.toMatch(/placement|HQ/iu);
  });
});
