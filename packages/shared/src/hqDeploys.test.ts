import { describe, expect, it } from "vite-plus/test";

import { saysZeropsDidNotAnswer, zeropsDidNotAnswer } from "./hqDeploys.ts";

describe("zeropsDidNotAnswer — HQ's words for a deploy it asks again because Zerops was silent", () => {
  it("says it, with what Zerops failed at", () => {
    expect(zeropsDidNotAnswer("connect ETIMEDOUT")).toBe(
      "Zerops did not answer: connect ETIMEDOUT",
    );
  });

  it.each([
    { message: zeropsDidNotAnswer("connect ETIMEDOUT"), says: true },
    { message: "stage has no deploy token yet; an admin mints it", says: false },
    { message: "git: object not found", says: false },
    { message: null, says: false },
  ])("is read back from a deploy's message: $says", ({ message, says }) => {
    expect(saysZeropsDidNotAnswer(message)).toBe(says);
  });
});
