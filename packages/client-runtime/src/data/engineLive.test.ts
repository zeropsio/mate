import { describe, expect, it } from "vite-plus/test";

import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "./engineLive.ts";

const ada = { environmentId: "env-ada", conversationId: "thread-ada" };
const bea = { environmentId: "env-bea", conversationId: "thread-bea" };

function harness() {
  const timers: Array<{ callback: () => void; handle: number }> = [];
  let next = 0;
  const live = makeEngineLiveText({
    policy: ENGINE_LIVE_POLICY,
    setTimer: (callback) => {
      const handle = next++;
      timers.push({ callback, handle });
      return handle;
    },
    clearTimer: (handle) => {
      const at = timers.findIndex((timer) => timer.handle === handle);
      if (at >= 0) timers.splice(at, 1);
    },
  });
  const flush = () => {
    for (const timer of timers.splice(0)) timer.callback();
  };
  return { live, flush };
}

describe("an engine conversation's streamed text", () => {
  it("grows as each append lands at the end of what is held", () => {
    const { live } = harness();
    live.open(ada, "i/2", "text", "");
    live.append(ada, "i/2", "text", 0, "On ");
    live.append(ada, "i/2", "text", 3, "it.");
    expect(live.read(ada.environmentId, "i/2", "text")).toBe("On it.");
  });

  it("drops an item's text on an append at any other offset, until an open replaces it", () => {
    const { live } = harness();
    live.open(ada, "i/2", "text", "On ");
    live.append(ada, "i/2", "text", 5, "lost");
    expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
    live.append(ada, "i/2", "text", 3, "it.");
    expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
    live.open(ada, "i/2", "text", "On it.");
    expect(live.read(ada.environmentId, "i/2", "text")).toBe("On it.");
  });

  it("starts an item's text from an append at offset zero", () => {
    const { live } = harness();
    live.append(ada, "i/2", "reasoning", 0, "Thinking");
    expect(live.read(ada.environmentId, "i/2", "reasoning")).toBe("Thinking");
  });

  it("drops an item's text once its record is whole, so the record is drawn", () => {
    const { live } = harness();
    live.open(ada, "i/2", "text", "On it.");
    live.settle(ada, "i/2");
    expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
  });

  it("forgets one conversation's text and keeps every other's", () => {
    const { live } = harness();
    live.open(ada, "i/2", "text", "Ada's");
    live.open(bea, "i/2", "text", "Bea's");
    live.forget(ada);
    expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
    expect(live.read(bea.environmentId, "i/2", "text")).toBe("Bea's");
  });

  it("tells a reader of an item once per coalescing window, never another item's reader", () => {
    const { live, flush } = harness();
    const heard: string[] = [];
    const stop = live.watch(ada.environmentId, "i/2", () => heard.push("i/2"));
    live.watch(ada.environmentId, "i/3", () => heard.push("i/3"));
    live.open(ada, "i/2", "text", "");
    live.append(ada, "i/2", "text", 0, "a");
    live.append(ada, "i/2", "text", 1, "b");
    expect(heard).toEqual([]);
    flush();
    expect(heard).toEqual(["i/2"]);
    stop();
    live.append(ada, "i/2", "text", 2, "c");
    flush();
    expect(heard).toEqual(["i/2"]);
  });

  it("holds no more streaming items per conversation than its budget, dropping the oldest", () => {
    const { live } = harness();
    const count = ENGINE_LIVE_POLICY.itemsPerConversation;
    for (let index = 0; index <= count; index++) live.open(ada, `i/${index}`, "text", `${index}`);
    expect(live.read(ada.environmentId, "i/0", "text")).toBeNull();
    expect(live.read(ada.environmentId, `i/${count}`, "text")).toBe(`${count}`);
    expect(live.read(ada.environmentId, "i/1", "text")).toBe("1");
  });

  it.each([
    { stream: "text", keeps: "head" },
    { stream: "reasoning", keeps: "head" },
    { stream: "output", keeps: "tail" },
  ] as const)(
    "holds a $stream stream within its budget, keeping its $keeps",
    ({ stream, keeps }) => {
      const { live } = harness();
      const budget =
        stream === "output" ? ENGINE_LIVE_POLICY.outputChars : ENGINE_LIVE_POLICY.textChars;
      const whole = "x".repeat(budget) + "END";
      live.open(ada, "i/2", stream, "");
      live.append(ada, "i/2", stream, 0, whole);
      const held = live.read(ada.environmentId, "i/2", stream);
      expect(held?.length).toBe(budget);
      expect(held?.endsWith("END")).toBe(keeps === "tail");
    },
  );

  it("holds and tells nothing once closed", () => {
    const { live, flush } = harness();
    const heard: string[] = [];
    live.watch(ada.environmentId, "i/2", () => heard.push("i/2"));
    live.close();
    live.open(ada, "i/2", "text", "late");
    flush();
    expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
    expect(heard).toEqual([]);
  });
});
