import { describe, expect, it } from "vite-plus/test";

import { mateShowsSignIn } from "./mateSignIn";

// The owner, 2026-10-12, of the Chief: "This page should have the auth interface instead of the
// form"; 2026-10-13, of Eli: "the detail has composer instead of the auth state".
describe("mateShowsSignIn", () => {
  it.each<[string, Parameters<typeof mateShowsSignIn>[0], boolean]>([
    [
      "shows a Mate's sign-in in place of its question and composer while no agent is signed in",
      { mate: true, signInRequired: true, said: false },
      true,
    ],
    [
      "shows a Chief's sign-in in place of its question and composer while no agent is signed in",
      { mate: true, signInRequired: true, said: false },
      true,
    ],
    [
      "shows the question and the composer once an agent is signed in",
      { mate: true, signInRequired: false, said: false },
      false,
    ],
    [
      "leaves a conversation already under way to its own sign-in notice",
      { mate: true, signInRequired: true, said: true },
      false,
    ],
    [
      "leaves a conversation no Mate lives in as it is",
      { mate: false, signInRequired: true, said: false },
      false,
    ],
  ])("%s", (_title, input, shows) => {
    expect(mateShowsSignIn(input)).toBe(shows);
  });
});
