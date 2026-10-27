import { describe, expect, it } from "vite-plus/test";

import {
  isMateTaskConversation,
  MATE_TASKS_CONVERSATION_ID,
  mateTaskIdOfConversation,
} from "./mateTask.ts";

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

describe("an automated Mate's tasks", () => {
  it("every task of an automated Mate runs in its one conversation, and an older task's own stays a task's", () => {
    expect(isMateTaskConversation(MATE_TASKS_CONVERSATION_ID)).toBe(true);
    expect(isMateTaskConversation("task-7f3a9c")).toBe(true);
    expect(isMateTaskConversation("thread-1")).toBe(false);
    // The one conversation names no task of its own: its messages do.
    expect(mateTaskIdOfConversation(MATE_TASKS_CONVERSATION_ID)).toBeUndefined();
  });
});
