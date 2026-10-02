import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SENT_ASK_HOLD_MS, useSentAsks } from "./sentAsk";

describe("useSentAsks — what this browser just sent each Mate", () => {
  const SENT = { messageId: "message-1", threadId: "thread-1", text: "Add a login", at: "t" };
  beforeEach(() => {
    vi.useFakeTimers();
    useSentAsks.setState({ byEnvironment: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { case: "kept while the conversation catches up", after: SENT_ASK_HOLD_MS - 1, kept: true },
    { case: "let go once its hold is over", after: SENT_ASK_HOLD_MS, kept: false },
  ])("$case", ({ after, kept }) => {
    useSentAsks.getState().note("env-1", SENT);
    vi.advanceTimersByTime(after);
    expect(useSentAsks.getState().byEnvironment["env-1"] !== undefined).toBe(kept);
  });

  it("a later send's hold is its own: the first one's end leaves it", () => {
    useSentAsks.getState().note("env-1", SENT);
    vi.advanceTimersByTime(SENT_ASK_HOLD_MS - 10);
    useSentAsks.getState().note("env-1", { ...SENT, messageId: "message-2" });
    vi.advanceTimersByTime(10);
    expect(useSentAsks.getState().byEnvironment["env-1"]?.messageId).toBe("message-2");
  });

  it.each([
    { case: "a failed send is forgotten", messageId: "message-1", kept: false },
    { case: "another message's failure leaves it", messageId: "message-9", kept: true },
  ])("$case", ({ messageId, kept }) => {
    useSentAsks.getState().note("env-1", SENT);
    useSentAsks.getState().forget("env-1", messageId);
    expect(useSentAsks.getState().byEnvironment["env-1"] !== undefined).toBe(kept);
  });
});
