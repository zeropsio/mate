import { describe, expect, it } from "vite-plus/test";

import { linkedChanges, linksChange } from "./changeLinks.ts";

const HQ = "https://hq-30db-8080.prg1.zerops.app";
const SEVEN = { appId: "g1", repo: "app", number: 7 };

describe("linkedChanges: the changes of the official HQ a text links", () => {
  it.each([
    ["a bare address", `Opened ${HQ}/changes/g1/app/7 for review`, [SEVEN]],
    ["a markdown link", `See [the change](${HQ}/changes/g1/app/7).`, [SEVEN]],
    ["one ending a sentence", `It is at ${HQ}/changes/g1/app/7.`, [SEVEN]],
    ["one with a trailing slash", `${HQ}/changes/g1/app/7/`, [SEVEN]],
    [
      "two, in the order they are linked",
      `${HQ}/changes/g1/app/7 and ${HQ}/changes/g1/api/2`,
      [SEVEN, { appId: "g1", repo: "api", number: 2 }],
    ],
    ["no number that only starts the same", `${HQ}/changes/g1/app/53`, [{ ...SEVEN, number: 53 }]],
    ["nothing on another origin", "Opened https://hq.example.test/changes/g1/app/7.", []],
    ["nothing under another path", `${HQ}/api/apps/g1/changes/app/7`, []],
    ["nothing in plain words", "The change is waiting for review.", []],
  ])("%s", (_name, text, links) => {
    expect(linkedChanges(text, HQ)).toEqual(links);
  });

  it("recognises nothing while the official HQ is not known", () => {
    expect(linkedChanges(`${HQ}/changes/g1/app/7`, undefined)).toEqual([]);
  });
});

describe("linksChange: a text links this change, never one whose number starts the same", () => {
  const FIVE = { appId: "g1", repo: "appdev", number: 5 };
  it.each([
    ["its own address", `Ready to merge: ${HQ}/changes/g1/appdev/5`, true],
    ["its address before punctuation", `(${HQ}/changes/g1/appdev/5).`, true],
    ["#53's address", `${HQ}/changes/g1/appdev/53`, false],
    ["another repository's #5", `${HQ}/changes/g1/api/5`, false],
    ["another application's #5", `${HQ}/changes/g2/appdev/5`, false],
    ["its path on another origin", "https://hq.example.test/changes/g1/appdev/5", false],
  ])("%s", (_case, text, links) => {
    expect(linksChange(text, FIVE, HQ)).toBe(links);
  });
});
