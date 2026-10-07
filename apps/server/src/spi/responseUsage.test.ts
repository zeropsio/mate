import { describe, expect, it } from "vite-plus/test";
import { makeClaudeResponseUsage, codexResponseUsage } from "./responseUsage.ts";

const usage = {
  input_tokens: 20,
  cache_read_input_tokens: 40,
  cache_creation_input_tokens: 10,
  output_tokens: 2,
};
const assistant = (id: string, parent: string | null, stop: string | null, output: number) => ({
  type: "assistant",
  session_id: "session",
  parent_tool_use_id: parent,
  message: {
    id,
    model: "claude-model",
    stop_reason: stop,
    usage: { ...usage, output_tokens: output },
  },
});
const stream = (event: unknown, parent: string | null = null) => ({
  type: "stream_event",
  session_id: "session",
  parent_tool_use_id: parent,
  event,
});

describe("completed provider responses", () => {
  it.each([null, "task-tool"])(
    "Claude records the final response meter, including sidechains (%s)",
    (parent) => {
      const read = makeClaudeResponseUsage();
      expect(
        read(
          stream(
            { type: "message_start", message: { id: "response", model: "claude-model", usage } },
            parent,
          ),
        ),
      ).toEqual([]);
      expect(read(assistant("response", parent, null, 2))).toEqual([]);
      expect(
        read(
          stream(
            {
              type: "message_delta",
              usage: { output_tokens: 30 },
              delta: { stop_reason: "end_turn" },
            },
            parent,
          ),
        ),
      ).toEqual([]);
      const facts = read(stream({ type: "message_stop" }, parent));
      expect(facts).toEqual([
        {
          nativeThreadId: "session",
          nativeResponseId: "response",
          model: "claude-model",
          components: {
            uncachedInput: "20",
            cachedInput: "40",
            cacheCreation: "10",
            output: "30",
            reasoning: null,
            inclusiveTotal: null,
          },
          nativeCost: null,
          parentId: parent,
        },
      ]);
      expect(read(stream({ type: "message_stop" }, parent))).toEqual([]);
    },
  );

  it("Claude records a completed nonstream sidechain snapshot but never Task or result rollups", () => {
    const read = makeClaudeResponseUsage();
    expect(read(assistant("child-response", "task-tool", "end_turn", 30))).toHaveLength(1);
    expect(read({ type: "result", modelUsage: { model: { inputTokens: 270 } } })).toEqual([]);
    expect(
      read({ type: "system", subtype: "task_notification", usage: { total_tokens: 270 } }),
    ).toEqual([]);
  });

  it("Claude synthetic replies and incomplete sidechains are not recorded consumption", () => {
    const read = makeClaudeResponseUsage();
    const synthetic = assistant("synthetic", null, "end_turn", 0);
    expect(read({ ...synthetic, message: { ...synthetic.message, model: "<synthetic>" } })).toEqual(
      [],
    );
    expect(read(assistant("child", "task-tool", null, 30))).toEqual([]);
  });

  it("Claude keeps concurrent parent and child responses separate", () => {
    const read = makeClaudeResponseUsage();
    for (const [id, parent] of [
      ["parent", null],
      ["child", "task-tool"],
    ] as const) {
      read(stream({ type: "message_start", message: { id, model: "model", usage } }, parent));
      read(
        stream(
          {
            type: "message_delta",
            usage: { output_tokens: id === "parent" ? 30 : 60 },
            delta: { stop_reason: "end_turn" },
          },
          parent,
        ),
      );
    }
    expect(read(stream({ type: "message_stop" }, "task-tool"))[0]?.components.output).toBe("60");
    expect(read(stream({ type: "message_stop" }))[0]?.components.output).toBe("30");
  });

  it.each([
    {
      inputTokens: 100,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 10,
      outputTokens: 50,
      reasoningOutputTokens: 20,
      totalTokens: 150,
    },
    {
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 50,
      reasoningOutputTokens: 20,
      totalTokens: 150,
    },
  ])("Codex records one raw native response with a disjoint token split", (meter) => {
    expect(
      codexResponseUsage(
        { threadId: "child", responseId: "response", usage: meter },
        "model",
        "parent",
      ),
    ).toEqual({
      nativeThreadId: "child",
      nativeResponseId: "response",
      model: "model",
      components: {
        uncachedInput: meter.cacheWriteInputTokens === undefined ? null : "50",
        cachedInput: "40",
        cacheCreation: meter.cacheWriteInputTokens === undefined ? null : "10",
        output: "50",
        reasoning: "20",
        inclusiveTotal: "150",
      },
      nativeCost: null,
      parentId: "parent",
    });
  });

  it.each([-1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "invalid native meter values fail rather than becoming estimated usage (%s)",
    (outputTokens) => {
      expect(() =>
        codexResponseUsage(
          { threadId: "thread", responseId: "response", usage: { outputTokens } },
          null,
          null,
        ),
      ).toThrow("Invalid provider response token quantity");
    },
  );

  it.each([
    null,
    {},
    {
      threadId: "thread",
      responseId: "response",
      tokenUsage: { total: { totalTokens: 270 }, last: { totalTokens: 30 } },
    },
  ])("Codex never substitutes a thread counter for exact response usage", (payload) => {
    expect(codexResponseUsage(payload, null, null)).toBeUndefined();
  });
});
