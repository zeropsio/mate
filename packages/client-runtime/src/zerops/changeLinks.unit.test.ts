import { expect, it } from "vite-plus/test";

import { linkedChanges, linksChange } from "./changeLinks.ts";

const HQ = "https://hq.example.test";
const link = { appId: "app-1", repo: "webdev", number: 32 };

// witness: packages/client-runtime/src/zerops/changeLinks.ts | linked.appId === link.appId && linked.repo === link.repo && linked.number === link.number, → linked.appId === link.appId && linked.repo === link.repo && String(linked.number).startsWith(String(link.number)),
it("ZV+3: A text links a change only by its exact number at the official HQ, never one whose number merely starts the same, and links nothing while the official HQ is unknown", () => {
  expect(linksChange(`Opened ${HQ}/changes/app-1/webdev/320 for review.`, link, HQ)).toBe(false);
  expect(linksChange(`Opened ${HQ}/changes/app-1/webdev/32.`, link, HQ)).toBe(true);
  expect(
    linksChange("Opened https://elsewhere.example.test/changes/app-1/webdev/32.", link, HQ),
  ).toBe(false);
  expect(linksChange(`Opened ${HQ}/changes/app-1/webdev/32.`, link, undefined)).toBe(false);
  expect(linkedChanges(`Opened ${HQ}/changes/app-1/webdev/32.`, undefined)).toEqual([]);
});
