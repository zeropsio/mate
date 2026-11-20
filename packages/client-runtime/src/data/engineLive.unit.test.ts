import { expect, it } from "vite-plus/test";

import { ENGINE_LIVE_POLICY, makeEngineLiveText } from "./engineLive.ts";

const ada = { environmentId: "env-ada", conversationId: "thread-ada" };
const bea = { environmentId: "env-bea", conversationId: "thread-bea" };

function liveText() {
  return makeEngineLiveText({
    policy: ENGINE_LIVE_POLICY,
    setTimer: () => 0,
    clearTimer: () => {},
  });
}

// witness: packages/client-runtime/src/data/engineLive.ts | offset !== current.length → offset < current.length
it("ST51: A streamed text append at any offset but its end drops the item's text until an open replaces it", () => {
  const live = liveText();
  live.open(ada, "i/2", "text", "On ");
  live.append(ada, "i/2", "text", 5, "lost");
  expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
  live.append(ada, "i/2", "text", 3, "it.");
  expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
  live.open(ada, "i/2", "text", "On it.");
  expect(live.read(ada.environmentId, "i/2", "text")).toBe("On it.");
});

// witness: packages/client-runtime/src/data/engineLive.ts | drop(itemKey(key.environmentId, itemId)); → drop(itemKey(key.conversationId, itemId));
it("ST52: An item's streamed text is dropped once its record is whole, so the record is drawn", () => {
  const live = liveText();
  live.open(ada, "i/2", "text", "On it.");
  live.settle(ada, "i/2");
  expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
});

// witness: packages/client-runtime/src/data/engineLive.ts | for (const [id, entry] of [...entries]) if (entry.conversation === conversation) drop(id); → for (const id of entries.keys()) drop(id);
it("ST53: Forgetting one conversation's streamed text keeps every other conversation's", () => {
  const live = liveText();
  live.open(ada, "i/2", "text", "Ada's");
  live.open(bea, "i/2", "text", "Bea's");
  live.forget(ada);
  expect(live.read(ada.environmentId, "i/2", "text")).toBeNull();
  expect(live.read(bea.environmentId, "i/2", "text")).toBe("Bea's");
});

// witness: packages/client-runtime/src/data/engineLive.ts | siblings.length >= policy.itemsPerConversation → siblings.length > policy.itemsPerConversation
it("ST54: A conversation holds no more streaming items than its budget, dropping the oldest first", () => {
  const live = liveText();
  const count = ENGINE_LIVE_POLICY.itemsPerConversation;
  for (let index = 0; index <= count; index++) live.open(ada, `i/${index}`, "text", `${index}`);
  expect(live.read(ada.environmentId, "i/0", "text")).toBeNull();
  expect(live.read(ada.environmentId, `i/${count}`, "text")).toBe(`${count}`);
  expect(live.read(ada.environmentId, "i/1", "text")).toBe("1");
});

// witness: packages/client-runtime/src/data/engineLive.ts | text.slice(-policy.outputChars) → text.slice(0, policy.outputChars)
it("ST55: A streamed text over its budget keeps its head for text and reasoning, and its tail for command output", () => {
  const live = liveText();
  for (const stream of ["text", "reasoning", "output"] as const) {
    const budget =
      stream === "output" ? ENGINE_LIVE_POLICY.outputChars : ENGINE_LIVE_POLICY.textChars;
    const whole = "x".repeat(budget) + "END";
    live.open(ada, "i/2", stream, "");
    live.append(ada, "i/2", stream, 0, whole);
    const held = live.read(ada.environmentId, "i/2", stream);
    expect(held?.length).toBe(budget);
    expect(held?.endsWith("END")).toBe(stream === "output");
  }
});
