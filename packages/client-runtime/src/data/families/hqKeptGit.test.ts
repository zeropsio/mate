import { expect, it } from "vite-plus/test";
import { hqKeptGitFamily } from "./hqKeptGit.ts";

const question = {
  appId: "shop",
  appName: "Shop",
  projectId: "gone",
  projectName: null,
  askedAt: "2026-10-25T09:00:00Z",
};
it("admits the removed project's kept-Git question exactly as HQ sent it", () => {
  expect(hqKeptGitFamily.hq!.idOf("keptGit:shop", { orgId: "org", ownerId: "org" })).toBe("shop");
  expect(hqKeptGitFamily.hq!.decode(question, "keptGit:shop")).toEqual(question);
});
it.each([{}, { ...question, askedAt: 42 }, { ...question, projectName: false }])(
  "rejects an unreadable kept-Git question without inventing a choice: %j",
  (raw) => {
    expect(hqKeptGitFamily.hq!.decode(raw, "keptGit:shop")).toBeNull();
  },
);
