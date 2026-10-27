/**
 * The pump's memory: what the bridge and toCore keep stays bounded however long a session lives.
 */
import { assert, describe, it } from "vite-plus/test";
import type { SpiEvent } from "@t3tools/contracts";

import type { RequestKey, SessionId, TurnHandle } from "../bridge/spi3.ts";
import { type BridgeInput, makeTranslator } from "../bridge/translate.ts";
import { makeToCore } from "./toCore.ts";

const THREAD = "mate/s/1";
let n = 0;
const event = (type: string, fields: Record<string, unknown> = {}): BridgeInput => ({
  kind: "event",
  event: {
    type,
    eventId: `e${++n}`,
    provider: "codex",
    threadId: THREAD,
    createdAt: "2026-10-07T00:00:00.000Z",
    payload: {},
    ...fields,
  } as unknown as SpiEvent,
});

/** One turn: a reply streamed in 20 parts, a command's output, a question answered. */
const turnOf = (i: number): ReadonlyArray<BridgeInput> => {
  const turn = `h${i}` as TurnHandle;
  const native = `X${i}`;
  return [
    { kind: "send", turn, mode: "new" },
    event("turn.started", { turnId: native }),
    { kind: "sent", turn, nativeTurn: native },
    event("item.started", {
      turnId: native,
      itemId: `cmd${i}`,
      payload: { itemType: "command_execution", status: "inProgress", title: "Command run" },
    }),
    ...Array.from({ length: 20 }, () =>
      event("content.delta", {
        turnId: native,
        itemId: `cmd${i}`,
        payload: { streamKind: "command_output", delta: "x".repeat(1_000) },
      }),
    ),
    event("item.completed", {
      turnId: native,
      itemId: `cmd${i}`,
      payload: { itemType: "command_execution", status: "completed", title: "Command run" },
    }),
    ...Array.from({ length: 20 }, () =>
      event("content.delta", {
        turnId: native,
        itemId: `msg${i}`,
        payload: { streamKind: "assistant_text", delta: "y".repeat(1_000) },
      }),
    ),
    event("item.completed", {
      turnId: native,
      itemId: `msg${i}`,
      payload: { itemType: "assistant_message", status: "completed" },
    }),
    event("request.opened", {
      turnId: native,
      requestId: `req${i}`,
      payload: { requestType: "command_execution_approval" },
    }),
    { kind: "respond", request: `s1.r${i}` as RequestKey },
    event("request.resolved", {
      requestId: `req${i}`,
      payload: { requestType: "command_execution_approval", decision: "accept" },
    }),
    event("turn.completed", { turnId: native, payload: { state: "completed" } }),
  ];
};

describe("the pump's memory", () => {
  it("a long session's turns, text, output and requests are let go once recorded", () => {
    const translator = makeTranslator({ driver: "codex", threadId: THREAD });
    const toCore = makeToCore({ nativeTurn: translator.nativeTurn });
    const inputs: Array<BridgeInput> = [
      { kind: "start", session: "s1" as SessionId, from: "fresh" },
      { kind: "started" },
    ];
    const retained: Array<number> = [];
    for (let i = 1; i <= 400; i++) {
      for (const input of [...(i === 1 ? inputs : []), ...turnOf(i)]) {
        for (const signal of translator.step(input)) toCore.step(signal, i * 1_000);
      }
      if (i === 100 || i === 400) {
        const bridge = translator.retained();
        const core = toCore.retained();
        retained.push(bridge.turns + bridge.items + bridge.requests + bridge.dropped);
        retained.push(core.items + core.text + core.turns);
      }
    }
    // The same after 100 turns as after 400: nothing grows with the session's length.
    assert.strictEqual(retained[0], retained[2]);
    assert.strictEqual(retained[1], retained[3]);
    assert.isAtMost(retained[0]!, 40);
    assert.isAtMost(retained[1]!, 140);
  });
});
