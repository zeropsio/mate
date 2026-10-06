import { describe, expect, it } from "vite-plus/test";

import type { ChangeDiscussionRead, OperationProgress } from "@t3tools/client-runtime/data";

import { commentRefusal, sayOnChange, type CommentIntent } from "./changeDiscussion.logic";

describe("commentRefusal", () => {
  it.each([
    { stage: { stage: "accepted", operationId: "c1" }, said: null },
    { stage: { stage: "reflected", operationId: "c1" }, said: null },
    { stage: { stage: "done", operationId: "c1", outcome: "succeeded" }, said: null },
    { stage: { stage: "refused", reason: "You may not comment." }, said: "You may not comment." },
    {
      stage: { stage: "unsent", next: "send-again", reason: "HQ is not answering right now." },
      said: "HQ is not answering right now.",
    },
    {
      stage: { stage: "unsent", next: "send-again" },
      said: "HQ could not be reached.",
    },
    {
      stage: { stage: "uncertain", next: "ask-owner-again" },
      said: "HQ could not confirm whether this finished. Check the project before trying again.",
    },
  ] as const)("$stage.stage says $said", ({ stage, said }) => {
    expect(commentRefusal(stage)).toBe(said);
  });
});

const INTENT: CommentIntent = {
  kind: "change-comment",
  orgId: "org",
  link: { appId: "shop", repo: "web", number: 7 },
  body: "Ship it",
  authorUserId: "u1",
};

function ports(read: ChangeDiscussionRead, progress: OperationProgress) {
  const steps: string[] = [];
  return {
    steps,
    ports: {
      untilRead: async () => {
        steps.push("read");
        return read;
      },
      submit: async (intent: CommentIntent) => {
        steps.push(`submit ${intent.body}`);
        return { requestId: "r1", progress };
      },
    },
  };
}

describe("sayOnChange", () => {
  it("sends only once HQ's conversation is read, and is said once HQ took it", async () => {
    const { steps, ports: p } = ports(
      { kind: "read", comments: [] },
      { stage: "accepted", operationId: "c1" },
    );
    await expect(sayOnChange(p, INTENT)).resolves.toEqual({ kind: "accepted", requestId: "r1" });
    expect(steps).toEqual(["read", "submit Ship it"]);
  });

  it("sends nothing while the conversation cannot be read, and says why", async () => {
    const { steps, ports: p } = ports(
      { kind: "failed", reason: "HQ has no such change." },
      { stage: "accepted", operationId: "c1" },
    );
    await expect(sayOnChange(p, INTENT)).resolves.toEqual({
      kind: "refused",
      reason: "HQ has no such change.",
    });
    expect(steps).toEqual(["read"]);
  });

  it("answers what HQ did not take", async () => {
    const { ports: p } = ports(
      { kind: "read", comments: [] },
      { stage: "refused", reason: "You may not comment." },
    );
    await expect(sayOnChange(p, INTENT)).resolves.toEqual({
      kind: "refused",
      reason: "You may not comment.",
    });
  });
});
