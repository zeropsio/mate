import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  TaskAssignmentNumber,
  compareTaskAssignments,
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

describe("HQ assignment numbers", () => {
  it("keeps PostgreSQL grant order exactly past JavaScript integer precision and refuses noncanonical identities", () => {
    const valid = Schema.is(TaskAssignmentNumber);
    expect(valid("9007199254740993")).toBe(true);
    expect(valid("9223372036854775807")).toBe(true);
    expect(compareTaskAssignments("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
    for (const value of ["", "0", "01", "+1", "1.0", "1e3", " 1", "9223372036854775808", 1])
      expect(valid(value)).toBe(false);
  });
});
