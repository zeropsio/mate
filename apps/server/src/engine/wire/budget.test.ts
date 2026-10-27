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

const call = (n: number, fields: Record<string, unknown>): Item =>
  ({
    id: itemId(run, n),
    conversationId: conversation,
    runId: run,
    seq: n,
    rev: n,
    at: 1,
    by: { kind: "mate" },
    kind: "call",
    step: "mcp",
    tool: { name: "zerops_deploy", server: "zerops" },
    words: null,
    state: "done",
    endedAt: 2,
    ...fields,
  }) as Item;

describe("the wire's encoder holds records to their budget", () => {
  it("cuts a call's long result out of its record, names the part, and keeps the rest", () => {
    const resultText = JSON.stringify({ buildLogs: "x".repeat(ENGINE_WIRE_BUDGETS.itemTextBytes) });
    const fitted = fitItem(
      call(1, { result: { toolName: "zerops_deploy", resultText }, input: "deploy api" }),
    );
    if (fitted.kind !== "call") throw new Error(fitted.kind);
    expect(fitted.result).toEqual({ toolName: "zerops_deploy" });
    expect(fitted.cut).toEqual({ part: "result", total: resultText.length });
    expect(fitted.input).toBe("deploy api");
  });

  it("leaves a call's result within the budget whole, naming no cut", () => {
    const whole = call(1, { result: { toolName: "zerops_deploy", resultText: '{"ok":true}' } });
    expect(fitItem(whole)).toEqual(whole);
  });

  it("keeps what a call's row shows within the item's budget, its long input left out first", () => {
    const shows = {
      toolName: "mcp__zerops__zerops_import",
      input: { content: "y".repeat(ENGINE_WIRE_BUDGETS.itemBytes) },
      files: [{ path: "/var/www/zerops.yaml" }],
    };
    const fitted = fitItem(call(1, { shows }));
    if (fitted.kind !== "call") throw new Error(fitted.kind);
    expect(fitted.shows).toEqual({
      toolName: "mcp__zerops__zerops_import",
      files: [{ path: "/var/www/zerops.yaml" }],
    });
    expect(bytesOf(fitted)).toBeLessThanOrEqual(ENGINE_WIRE_BUDGETS.itemBytes);
  });

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
