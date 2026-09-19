import { describe, expect, it } from "vite-plus/test";

import {
  changeAskLabel,
  changeAskPrompt,
  changeConversationCount,
  changeRemarks,
} from "./changeConversation.ts";
import type { GiteaIssueComment } from "./giteaClient.ts";

function comment(over: Partial<GiteaIssueComment> = {}): GiteaIssueComment {
  return {
    id: 1,
    author: "ales",
    avatarUrl: undefined,
    body: "Looks right to me.",
    at: "2026-09-19T10:00:00Z",
    ...over,
  };
}

const MATES = new Map([["p-abc", "Theo"]]);

describe("changeRemarks", () => {
  it("names a Mate rather than showing its bot login", () => {
    const [remark] = changeRemarks({
      comments: [comment({ author: "mate-p-abc" })],
      mateNames: MATES,
      me: undefined,
    });
    expect(remark?.speaker).toBe("Theo");
    expect(remark?.mateProjectId).toBe("p-abc");
  });

  it("keeps the bot login when the account cannot name that Mate", () => {
    const [remark] = changeRemarks({
      comments: [comment({ author: "mate-p-zzz" })],
      mateNames: MATES,
      me: undefined,
    });
    expect(remark?.speaker).toBe("mate-p-zzz");
    expect(remark?.mateProjectId).toBe("p-zzz");
  });

  it("marks the reader's own words and nobody else's", () => {
    const remarks = changeRemarks({
      comments: [comment({ id: 1, author: "ales" }), comment({ id: 2, author: "wren" })],
      mateNames: MATES,
      me: "ales",
    });
    expect(remarks.map((entry) => entry.mine)).toEqual([true, false]);
  });

  it("drops the empty comments Gitea writes for events that are not remarks", () => {
    const remarks = changeRemarks({
      comments: [comment({ id: 1, body: "   " }), comment({ id: 2, body: "Merged." })],
      mateNames: MATES,
      me: undefined,
    });
    expect(remarks.map((entry) => entry.id)).toEqual([2]);
  });

  it("trims what is kept, so a trailing newline is not a blank line on the page", () => {
    const [remark] = changeRemarks({
      comments: [comment({ body: "Ship it.\n\n" })],
      mateNames: MATES,
      me: undefined,
    });
    expect(remark?.body).toBe("Ship it.");
  });

  it("falls back to a word rather than nothing where Gitea sent no author", () => {
    const [remark] = changeRemarks({
      comments: [comment({ author: undefined })],
      mateNames: MATES,
      me: undefined,
    });
    expect(remark?.speaker).toBe("somebody");
    expect(remark?.mine).toBe(false);
  });
});

describe("changeConversationCount", () => {
  it.each([
    [0, "Nothing said yet"],
    [1, "1 comment"],
    [4, "4 comments"],
  ])("counts %i as %s", (count, expected) => {
    const remarks = changeRemarks({
      comments: Array.from({ length: count }, (_, index) => comment({ id: index + 1 })),
      mateNames: MATES,
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

  it("asks for the change itself when nothing was written", () => {
    expect(changeAskPrompt({ ...change, said: "   " })).toBe(
      'Take #4 "Cache the link previews" on appdev forward: read it, do what it still needs, and push.',
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
