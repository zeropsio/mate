import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSentAsks } from "./sentAsk";

describe("useSentAsks — what this browser just sent each Mate", () => {
  const SENT = { messageId: "message-1", threadId: "thread-1", text: "Add a login", at: "t" };
  beforeEach(() => {
    vi.useFakeTimers();
    useSentAsks.setState({ byEnvironment: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is kept until the conversation says it or the send fails, whatever time passes", () => {
    useSentAsks.getState().note("env-1", SENT);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(useSentAsks.getState().byEnvironment["env-1"]?.messageId).toBe("message-1");
  });

  it("a later send replaces the one before it", () => {
    useSentAsks.getState().note("env-1", SENT);
    useSentAsks.getState().note("env-1", { ...SENT, messageId: "message-2" });
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
