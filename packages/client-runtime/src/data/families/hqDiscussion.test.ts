import { describe, expect, it } from "vite-plus/test";

import { discussionId, discussionLink, hqDiscussionFamily } from "./hqDiscussion.ts";

const LINK = { appId: "shop", repo: "acme/web:main", number: 7 };
const OWNER = { orgId: "org", ownerId: discussionId(LINK) };
const COMMENT = {
  id: "c1",
  authorUserId: "u1",
  authorMateProjectId: null,
  body: "Ship it",
  createdAt: "2026-10-06T10:00:00.000Z",
};
const { authorMateProjectId: _absent, ...OLDER } = COMMENT;
const hq = hqDiscussionFamily.hq!;

describe("hqDiscussionFamily", () => {
  it("names one change's conversation, whatever its repository is called", () => {
    expect(discussionLink(discussionId(LINK))).toEqual(LINK);
    expect(hq.wireScope!(OWNER.ownerId)).toEqual({ kind: "discussion", ...LINK });
  });

  it.each([
    { key: "acme/web:main:7", id: OWNER.ownerId },
    { key: "acme/web:main:8", id: null },
    { key: "other:7", id: null },
  ])("reads the record $key as $id", ({ key, id }) => {
    expect(hq.idOf(key, OWNER)).toBe(id);
  });

  it("resumes with the record key HQ holds the conversation under", () => {
    expect(hq.keyOf(OWNER.ownerId, OWNER)).toBe("acme/web:main:7");
  });

  it.each([
    { name: "comments", raw: { comments: [COMMENT] }, value: { comments: [COMMENT] } },
    { name: "an older HQ's comment", raw: { comments: [OLDER] }, value: { comments: [COMMENT] } },
    { name: "no list", raw: { comments: "not a list" }, value: null },
    { name: "nothing", raw: null, value: null },
  ])("decodes $name", ({ raw, value }) => {
    expect(hq.decode(raw, "web:7")).toEqual(value);
  });
});
