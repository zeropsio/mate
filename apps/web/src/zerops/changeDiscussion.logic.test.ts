import { describe, expect, it } from "vite-plus/test";

import type { DiscussionGate, OperationProgress } from "@t3tools/client-runtime/data";

import {
  commentRefusal,
  landedAfterLoss,
  makeCommentSends,
  sayOnChange,
  type CommentIntent,
} from "./changeDiscussion.logic";

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

function ports(read: DiscussionGate, progress: OperationProgress) {
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
    const { steps, ports: p } = ports({ kind: "read" }, { stage: "accepted", operationId: "c1" });
    await expect(sayOnChange(p, INTENT, new AbortController().signal)).resolves.toEqual({
      kind: "accepted",
      requestId: "r1",
    });
    expect(steps).toEqual(["read", "submit Ship it"]);
  });

  it("sends nothing while the conversation cannot be read, and says why", async () => {
    const { steps, ports: p } = ports(
      { kind: "failed", reason: "HQ has no such change." },
      { stage: "accepted", operationId: "c1" },
    );
    await expect(sayOnChange(p, INTENT, new AbortController().signal)).resolves.toEqual({
      kind: "refused",
      reason: "HQ has no such change.",
    });
    expect(steps).toEqual(["read"]);
  });

  it("keeps the operation of a comment whose answer was lost, to tell later whether HQ has it", async () => {
    const { ports: p } = ports({ kind: "read" }, { stage: "uncertain", next: "ask-owner-again" });
    await expect(sayOnChange(p, INTENT, new AbortController().signal)).resolves.toEqual({
      kind: "uncertain",
      requestId: "r1",
      reason: "HQ could not confirm whether this finished. Check the project before trying again.",
    });
  });

  it("answers what HQ did not take", async () => {
    const { ports: p } = ports(
      { kind: "read" },
      { stage: "refused", reason: "You may not comment." },
    );
    await expect(sayOnChange(p, INTENT, new AbortController().signal)).resolves.toEqual({
      kind: "refused",
      reason: "You may not comment.",
    });
  });
});

describe("makeCommentSends", () => {
  /** A send whose conversation is read when `open` is called. */
  function gated() {
    let open: () => void = () => {};
    const submitted: string[] = [];
    const run = (signal: AbortSignal) =>
      sayOnChange(
        {
          untilRead: (aborted) =>
            new Promise((resolve) => {
              open = () => resolve({ kind: "read" });
              aborted.addEventListener("abort", () =>
                resolve({ kind: "failed", reason: "HQ is not answering right now." }),
              );
            }),
          submit: async (intent) => {
            submitted.push(intent.body);
            return { requestId: "r1", progress: { stage: "accepted", operationId: "c1" } };
          },
        },
        INTENT,
        signal,
      );
    return { run, submitted, open: () => open() };
  }

  it("joins a second press of the same words to the send already waiting", async () => {
    const sends = makeCommentSends();
    const { run, submitted, open } = gated();
    const first = sends.say("shop|web|7|u1|Ship it", "org|shop|web|7", run);
    const second = sends.say("shop|web|7|u1|Ship it", "org|shop|web|7", run);
    open();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "accepted", requestId: "r1" },
      { kind: "accepted", requestId: "r1" },
    ]);
    expect(submitted).toEqual(["Ship it"]);
  });

  it("sends nothing it was let go of while the conversation was still read", async () => {
    const sends = makeCommentSends();
    const { run, submitted, open } = gated();
    const said = sends.say("shop|web|7|u1|Ship it", "org|shop|web|7", run);
    sends.cancel("org|shop|web|7");
    open();
    await expect(said).resolves.toEqual({
      kind: "refused",
      reason: "HQ is not answering right now.",
    });
    expect(submitted).toEqual([]);
  });
});

describe("landedAfterLoss", () => {
  it.each([
    {
      name: "still unsure",
      progress: { stage: "uncertain", next: "ask-owner-again" },
      landed: false,
    },
    {
      name: "adopted",
      progress: { stage: "done", operationId: "c1", outcome: "succeeded" },
      landed: true,
    },
    { name: "seen by HQ", progress: { stage: "reflected", operationId: "c1" }, landed: true },
  ] as const)("$name", ({ progress, landed }) => {
    expect(landedAfterLoss(progress)).toBe(landed);
  });
});
