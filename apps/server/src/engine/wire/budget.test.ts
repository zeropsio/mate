import { describe, expect, it } from "vite-plus/test";
import { ConversationId, ENGINE_WIRE_BUDGETS, itemId, runId, type Item } from "@t3tools/contracts";

import { bytesOf, changesFrames, cutUtf8, fitItem, liveFrames } from "./budget.ts";

const conversation = ConversationId.make("mate");
const run = runId(conversation, 1);

const note = (n: number, text: string): Item => ({
  id: itemId(run, n),
  conversationId: conversation,
  runId: run,
  seq: n,
  rev: n,
  at: 1,
  by: { kind: "mate" },
  kind: "note",
  text,
  streaming: false,
  answer: false,
});

describe("the wire's encoder holds records to their budget", () => {
  it("cuts a long message to the inline budget and names the part and its whole length", () => {
    const text = "é".repeat(ENGINE_WIRE_BUDGETS.itemTextBytes);
    const fitted = fitItem(note(1, text));
    if (fitted.kind !== "note") throw new Error(fitted.kind);
    expect(new TextEncoder().encode(fitted.text).length).toBeLessThanOrEqual(
      ENGINE_WIRE_BUDGETS.itemTextBytes,
    );
    expect(fitted.cut).toEqual({ part: "text", total: text.length * 2 });
  });

  it("leaves a message within the budget whole, naming no cut", () => {
    expect(fitItem(note(1, "Deployed."))).toEqual(note(1, "Deployed."));
  });

  it("never splits a character when it cuts", () => {
    expect(cutUtf8("aé", 2)).toBe("a");
    expect(cutUtf8("aé", 3)).toBe("aé");
  });

  it("sends changes over the frame budget as parts whose cursor moves only with the last", () => {
    const items = Array.from({ length: 12 }, (_, n) => note(n + 1, "x".repeat(1_000)));
    const frames = changesFrames(
      { epoch: 2, from: 10, to: 40 },
      { runs: [], items, requests: [] },
      4_000,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(bytesOf(frame)).toBeLessThanOrEqual(4_000);
    expect(frames.map((frame) => [frame.from, frame.to])).toEqual(
      frames.map((_, index) => [10, index === frames.length - 1 ? 40 : 10]),
    );
    expect(frames.flatMap((frame) => frame.items.map((item) => item.id))).toEqual(
      items.map((item) => item.id),
    );
  });

  it("sends streamed text in frames within a live frame's budget, each at its offset", () => {
    const text = "word ".repeat(2_000);
    const frames = liveFrames(itemId(run, 2), "text", text, { open: true }, 4_096);
    expect(frames[0]?.type).toBe("live.open");
    let rebuilt = "";
    for (const frame of frames) {
      expect(bytesOf(frame.text)).toBeLessThanOrEqual(4_096 + 2);
      if (frame.type === "live.append") expect(frame.offset).toBe(rebuilt.length);
      rebuilt += frame.text;
    }
    expect(rebuilt).toBe(text);
  });
});
