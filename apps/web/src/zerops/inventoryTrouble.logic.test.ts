import { describe, expect, it } from "vite-plus/test";
import { accountFootLine, inventoryTroubleVoice } from "./inventoryTrouble.logic";

const RECOVERING = {
  sentence: "Zerops isn't answering. Trying again…",
  tryNow: true,
  retrying: true,
} as const;
const REFUSED = {
  sentence: "Zerops isn't answering. Try now to ask again.",
  tryNow: true,
  retrying: false,
} as const;

describe("the source's trouble at the menu foot", () => {
  it.each([
    { source: null, voice: null },
    { source: "retrying", voice: RECOVERING },
    { source: "refused", voice: REFUSED },
  ] as const)("$source", ({ source, voice }) => {
    expect(inventoryTroubleVoice(source)).toEqual(voice);
  });
  it.each([
    { trouble: null, attempt: "idle", said: null },
    {
      trouble: RECOVERING,
      attempt: "idle",
      said: { sentence: RECOVERING.sentence, actions: ["try-now"] },
    },
    {
      trouble: RECOVERING,
      attempt: "trying",
      said: { sentence: RECOVERING.sentence, actions: ["trying"] },
    },
    {
      trouble: RECOVERING,
      attempt: "still",
      said: { sentence: "Still not answering. Trying again…", actions: ["try-now"] },
    },
    {
      trouble: REFUSED,
      attempt: "idle",
      said: { sentence: REFUSED.sentence, actions: ["try-now"] },
    },
    {
      trouble: REFUSED,
      attempt: "still",
      said: { sentence: "Still not answering. Try now to ask again.", actions: ["try-now"] },
    },
  ] as const)("$attempt while $trouble", ({ trouble, attempt, said }) => {
    expect(accountFootLine({ trouble, attempt })).toEqual(said);
  });
});
