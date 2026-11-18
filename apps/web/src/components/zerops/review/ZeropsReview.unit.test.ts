import { expect, it } from "vite-plus/test";
import { changeFixOptions } from "./ZeropsReview.logic.ts";

// witness: apps/web/src/components/zerops/review/ZeropsReview.logic.ts | branch: pull.branch, → branch: undefined,
it("RV1: A change that conflicts with main asks its branch's conversation to resolve it, about the change at its head", () => {
  const options = changeFixOptions({
    branch: "badge",
    repositoryUrl: "https://github.com/acme/apidev",
    repository: "apidev",
    number: 1,
    headSha: "4f1c2e9",
  });
  expect(options.branch).toBe("badge");
  expect(options.repositoryUrl).toBe("https://github.com/acme/apidev");
  expect(options.about).toEqual({ kind: "change", repo: "apidev", number: 1, head: "4f1c2e9" });
});
