import { describe, expect, it } from "vite-plus/test";

import { crewSetupDraftOf } from "./crewSetupDraft";

describe("crewSetupDraftOf", () => {
  it.each([
    {
      stored: { goal: "A tea shop that ships weekly." },
      draft: { goal: "A tea shop that ships weekly." },
    },
    { stored: { goal: 4 }, draft: null },
    { stored: "A tea shop.", draft: null },
    { stored: null, draft: null },
  ])("keeps a setup draft only as it was written: $stored", ({ stored, draft }) => {
    expect(crewSetupDraftOf(stored)).toEqual(draft);
  });
});
