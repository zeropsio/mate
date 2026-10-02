import type { HqChangeComment } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import {
  changeAskLabel,
  changeAskPrompt,
  changeConversationCount,
  changeRemarks,
} from "./changeConversation.ts";

function comment(over: Partial<HqChangeComment> = {}): HqChangeComment {
  return {
    id: "c1",
    authorUserId: "u-ales",
    body: "Looks right to me.",
    createdAt: "2026-09-19T10:00:00Z",
    ...over,
  };
}

/** The organization's members by their Zerops user id. */
const MEMBERS = new Map([
  ["u-ales", "Aleš Novák"],
  ["u-wren", "Wren"],
]);
const nameOf = (userId: string) => MEMBERS.get(userId);

describe("changeRemarks", () => {
  it("names who said it as the organization's members name them", () => {
    const [remark] = changeRemarks({ comments: [comment()], nameOf, me: undefined });
    expect(remark).toEqual({
      id: "c1",
      speaker: "Aleš Novák",
      mine: false,
      body: "Looks right to me.",
      at: "2026-09-19T10:00:00Z",
    });
  });

  it("marks the reader's own words and nobody else's", () => {
    const remarks = changeRemarks({
      comments: [
        comment({ id: "c1", authorUserId: "u-ales" }),
        comment({ id: "c2", authorUserId: "u-wren" }),
      ],
      nameOf,
      me: "u-ales",
    });
    expect(remarks.map((entry) => entry.mine)).toEqual([true, false]);
  });

  it("says somebody said it where no member of the organization is them any more", () => {
    const [remark] = changeRemarks({
      comments: [comment({ authorUserId: "u-gone" })],
      nameOf,
      me: undefined,
    });
    expect(remark?.speaker).toBe("somebody");
  });
});

describe("changeConversationCount", () => {
  it.each([
    [0, "Nothing said yet"],
    [1, "1 comment"],
    [4, "4 comments"],
  ])("counts %i as %s", (count, expected) => {
    const remarks = changeRemarks({
      comments: Array.from({ length: count }, (_, index) => comment({ id: `c${String(index)}` })),
      nameOf,
      me: undefined,
    });
    expect(changeConversationCount(remarks)).toBe(expected);
  });
});

describe("changeAskPrompt", () => {
  const change = { repository: "appdev", number: 4, title: "Cache the link previews" };

  it("quotes what the person wrote rather than paraphrasing it", () => {
    expect(changeAskPrompt({ ...change, said: "The cache key ignores the locale." })).toBe(
      'On #4 "Cache the link previews" on appdev:\n\nThe cache key ignores the locale.\n\nDo that, then push.',
    );
  });

  it("quotes the words without the space around them", () => {
    expect(changeAskPrompt({ ...change, said: "  rebase it \n" })).toBe(
      'On #4 "Cache the link previews" on appdev:\n\nrebase it\n\nDo that, then push.',
    );
  });

  it("names the change the way the forge addresses it, so the Mate's tools find it", () => {
    const prompt = changeAskPrompt({ ...change, said: "rebase it" });
    expect(prompt).toContain("#4");
    expect(prompt).toContain("appdev");
  });
});

describe("changeAskLabel", () => {
  it.each([
    [undefined, "Ask the Mate"],
    ["Theo", "Ask Theo"],
  ])("names %s as %s", (mate, expected) => {
    expect(changeAskLabel(mate)).toBe(expected);
  });
});
