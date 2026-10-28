import type { HqChangeComment } from "@t3tools/shared/hqChanges";
import { describe, expect, it } from "vite-plus/test";

import {
  changeAskLabel,
  changeAskPrompt,
  changeConversationCount,
  changeHandedPrompt,
  changeRemarks,
} from "./changeConversation.ts";

function comment(over: Partial<HqChangeComment> = {}): HqChangeComment {
  return {
    id: "c1",
    authorUserId: "u-ales",
    authorMateProjectId: null,
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
/** The application's Mates by their project. */
const mateNameOf = (projectId: string) => (projectId === "P_ADA" ? "Ada" : undefined);

describe("changeRemarks", () => {
  it("names who said it as the organization's members name them", () => {
    const [remark] = changeRemarks({ comments: [comment()], nameOf, mateNameOf, me: undefined });
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
      mateNameOf,
      me: "u-ales",
    });
    expect(remarks.map((entry) => entry.mine)).toEqual([true, false]);
  });

  it("says somebody said it where no member of the organization is them any more", () => {
    const [remark] = changeRemarks({
      comments: [comment({ authorUserId: "u-gone" })],
      nameOf,
      mateNameOf,
      me: undefined,
    });
    expect(remark?.speaker).toBe("somebody");
  });

  it("names words said on GitHub by their GitHub login, linked to them there", () => {
    const [remark] = changeRemarks({
      comments: [comment({ authorUserId: null, authorGithubLogin: "nova-dev" })],
      nameOf,
      mateNameOf,
      me: "u-ales",
    });
    expect(remark).toMatchObject({
      speaker: "nova-dev on GitHub",
      url: "https://github.com/nova-dev",
      mine: false,
    });
  });

  it("names a Mate's words by the Mate, never as the reader's own", () => {
    const [remark] = changeRemarks({
      comments: [comment({ authorUserId: null, authorMateProjectId: "P_ADA" })],
      nameOf,
      mateNameOf,
      me: "u-ales",
    });
    expect([remark?.speaker, remark?.mine]).toEqual(["Ada", false]);
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
      mateNameOf,
      me: undefined,
    });
    expect(changeConversationCount(remarks)).toBe(expected);
  });
});

describe("changeHandedPrompt", () => {
  const change = { repository: "appdev", number: 4, title: "Cache the link previews" };

  it.each<[string, string | undefined, string]>([
    [
      "tells the Mate a change handed to it is its own now, and the branch its work goes on",
      "fix-login",
      'Change #4 "Cache the link previews" on appdev is yours now: its Mate is gone. Its work so far is on branch fix-login in HQ. Fetch that branch, carry the change on there, and push to it.',
    ],
    [
      "says its branch without naming one HQ did not say",
      undefined,
      'Change #4 "Cache the link previews" on appdev is yours now: its Mate is gone. Its work so far is on its branch in HQ. Fetch that branch, carry the change on there, and push to it.',
    ],
  ])("%s", (_name, branch, words) => {
    expect(changeHandedPrompt({ ...change, branch })).toBe(words);
  });
});

describe("changeAskPrompt", () => {
  const change = { repository: "appdev", number: 4, title: "Cache the link previews" };

  it("quotes what the person wrote rather than paraphrasing it", () => {
    expect(changeAskPrompt({ ...change, said: "The cache key ignores the locale." })).toBe(
      'A comment on your change #4 "Cache the link previews" on appdev:\n\nThe cache key ignores the locale.',
    );
  });

  it("quotes the words without the space around them", () => {
    expect(changeAskPrompt({ ...change, said: "  rebase it \n" })).toBe(
      'A comment on your change #4 "Cache the link previews" on appdev:\n\nrebase it',
    );
  });

  // Lukas, 2026-10-28: "What should I do here? Merge is greyed out." reached his Mate as
  // an order to do it and push. The Mate judges whether words are a question or work to do.
  it.each([
    "What should I do here? Merge is greyed out.",
    "Handle it",
    "Why does the total round down?",
  ])("adds no order to what the person wrote: %s", (said) => {
    expect(changeAskPrompt({ ...change, said })).toBe(
      `A comment on your change #4 "Cache the link previews" on appdev:\n\n${said}`,
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
