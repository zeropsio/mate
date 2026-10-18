import { describe, expect, it } from "vite-plus/test";

import { mateTaskIdOfConversation } from "./mateTask.ts";

describe("a task's conversation", () => {
  it.each([
    ["task-7f3a9c", "7f3a9c"],
    ["task-gh.3a.acme.2f.tea-shop.23.12", "gh:acme/tea-shop#12"],
    ["task-", ""],
  ])("names HQ's task %s by its id", (conversationId, taskId) => {
    expect(mateTaskIdOfConversation(conversationId)).toBe(taskId);
  });

  it("names no task for a conversation that is not a task's", () => {
    expect(mateTaskIdOfConversation("thread-1")).toBeUndefined();
  });
});
