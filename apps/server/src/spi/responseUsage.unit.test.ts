import { expect, it } from "@effect/vitest";

import { makeClaudeTurnUsage, makeCodexTurnUsage, makeOpenCodeTurnUsage } from "./responseUsage.ts";

const usd = (amount: string) => ({
  amount,
  scale: 9,
  currency: "USD",
  basis: "provider-reported-estimate",
});

// One model's line in Claude's cumulative native ledger (`modelUsage`).
const claudeModel = (input: number, output: number, cacheRead: number, costUSD: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: 0,
  thinkingTokens: 0,
  costUSD,
});

// witness: apps/server/src/spi/responseUsage.ts | ? subtract(line.components, old.components) → ? line.components
it("SP+3: Claude turn usage counts its own and its child models' tokens and cost once, from the native ledger, without restored history or the assistant, Task and main-only meters", () => {
  // The resumed session already spent this before the turn.
  const read = makeClaudeTurnUsage({
    session: {
      model_usage: { "claude-opus": claudeModel(1000, 100, 4000, 0.5) },
      total_cost_usd: 0.5,
    },
  });
  const meters = [
    { type: "assistant", session_id: "native", message: { usage: { input_tokens: 7000 } } },
    { type: "stream_event", session_id: "native", usage: { input_tokens: 7000 } },
    {
      type: "system",
      subtype: "task_progress",
      session_id: "native",
      usage: { total_tokens: 900 },
    },
  ];
  expect(meters.flatMap((message) => read(message))).toEqual([]);

  // The turn's own model went on, and a Task subagent ran on another model.
  const result = {
    type: "result",
    session_id: "native",
    uuid: "turn-1",
    modelUsage: {
      "claude-opus": claudeModel(1400, 160, 4500, 0.7),
      "claude-haiku": claudeModel(300, 20, 0, 0.05),
    },
    total_cost_usd: 0.75,
    // The main agent's own meter, which leaves the subagent out.
    usage: { input_tokens: 400, output_tokens: 60 },
  };
  expect(read(result)).toEqual([
    {
      nativeThreadId: "native",
      nativeTurnId: "turn-1",
      parentId: null,
      nativeCost: usd("250000000"),
      models: [
        {
          model: "claude-haiku",
          components: {
            uncachedInput: "300",
            cachedInput: "0",
            cacheCreation: "0",
            output: "20",
            reasoning: "0",
            inclusiveTotal: null,
          },
          nativeCost: usd("50000000"),
        },
        {
          model: "claude-opus",
          components: {
            uncachedInput: "400",
            cachedInput: "500",
            cacheCreation: "0",
            output: "60",
            reasoning: "0",
            inclusiveTotal: null,
          },
          nativeCost: usd("200000000"),
        },
      ],
    },
  ]);
  // The same result told again counts nothing more.
  expect(read(result)).toEqual([]);
});

// One OpenCode step-finish part: one model call's meter.
const openCodeStep = (
  messageID: string,
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
) => ({
  type: "message.part.updated",
  properties: {
    part: {
      id,
      messageID,
      type: "step-finish",
      cost,
      tokens: {
        input: tokens.input,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cache: { read: tokens.read, write: tokens.write },
        total: tokens.input + tokens.output + tokens.reasoning + tokens.read + tokens.write,
      },
    },
  },
});
const openCodeAssistant = (id: string, providerID: string, modelID: string) => ({
  type: "message.updated",
  properties: { info: { id, role: "assistant", providerID, modelID } },
});

// witness: apps/server/src/spi/responseUsage.ts | nativeCost: charge === null || charge.amount === "0" ? null : charge, → nativeCost: charge,
it("SP+4: An OpenCode turn counts each step once under the model that ran it, subagents included; a step without a cost leaves its model's cost unknown, never free", () => {
  const usage = makeOpenCodeTurnUsage();
  usage.observe(openCodeAssistant("msg-main", "anthropic", "claude-sonnet"));
  const first = openCodeStep(
    "msg-main",
    "step-1",
    { input: 100, output: 20, reasoning: 5, read: 50, write: 10 },
    0.01,
  );
  usage.observe(first);
  usage.observe(first);
  usage.observe(
    openCodeStep(
      "msg-main",
      "step-2",
      { input: 10, output: 2, reasoning: 0, read: 0, write: 0 },
      0.002,
    ),
  );
  // A subagent's message, on a model OpenCode has no price for.
  usage.observe(openCodeAssistant("msg-sub", "openai", "gpt-mini"));
  usage.observe(
    openCodeStep("msg-sub", "step-3", { input: 40, output: 8, reasoning: 0, read: 0, write: 0 }, 0),
  );

  const facts = usage.complete("ses-main", "turn-1");
  expect(facts.map((fact) => [fact.nativeThreadId, fact.nativeTurnId])).toEqual([
    ["ses-main", "turn-1"],
  ]);
  expect(facts[0]?.models).toEqual([
    {
      model: "anthropic/claude-sonnet",
      // OpenCode's output excludes reasoning; the line's output includes it.
      components: {
        uncachedInput: "110",
        cachedInput: "50",
        cacheCreation: "10",
        output: "27",
        reasoning: "5",
        inclusiveTotal: "197",
      },
      nativeCost: usd("12000000"),
    },
    {
      model: "openai/gpt-mini",
      components: {
        uncachedInput: "40",
        cachedInput: "0",
        cacheCreation: "0",
        output: "8",
        reasoning: "0",
        inclusiveTotal: "48",
      },
      nativeCost: null,
    },
  ]);
  // A step already counted, told again in the next turn, counts nothing.
  usage.observe(first);
  expect(usage.complete("ses-main", "turn-2")).toEqual([]);
});

// One Codex response's exact meter.
const codexResponse = (
  threadId: string,
  turnId: string,
  responseId: string,
  usage: { input: number; cached: number; output: number; reasoning: number },
  parentThreadId?: string,
) => ({
  threadId,
  turnId,
  responseId,
  ...(parentThreadId === undefined ? {} : { parentThreadId }),
  usage: {
    inputTokens: usage.input,
    cachedInputTokens: usage.cached,
    cacheWriteInputTokens: 0,
    outputTokens: usage.output,
    reasoningOutputTokens: usage.reasoning,
    totalTokens: usage.input + usage.output,
  },
});

// witness: apps/server/src/spi/responseUsage.ts | if (JSON.stringify(old) !== JSON.stringify(components)) → if (JSON.stringify(old) === JSON.stringify(components))
it("SP+5: A Codex turn counts each of its own responses once, and conflicting retries fail instead of inflating the count", () => {
  const read = makeCodexTurnUsage();
  const first = codexResponse("thread", "turn-a", "resp-1", {
    input: 500,
    cached: 200,
    output: 30,
    reasoning: 10,
  });
  read("rawResponse/completed", first);
  expect(() =>
    read(
      "rawResponse/completed",
      codexResponse("thread", "turn-a", "resp-1", {
        input: 500,
        cached: 200,
        output: 90,
        reasoning: 10,
      }),
    ),
  ).toThrow();
  read("rawResponse/completed", first);
  read(
    "rawResponse/completed",
    codexResponse("thread", "turn-a", "resp-2", {
      input: 100,
      cached: 100,
      output: 10,
      reasoning: 0,
    }),
  );
  // A subagent's response belongs to its own thread's turn.
  read(
    "rawResponse/completed",
    codexResponse(
      "child",
      "turn-c",
      "resp-c",
      { input: 70, cached: 0, output: 5, reasoning: 0 },
      "thread",
    ),
  );

  const completed = { threadId: "thread", turn: { id: "turn-a", status: "completed" } };
  expect(read("turn/completed", completed)).toEqual([
    {
      nativeThreadId: "thread",
      nativeTurnId: "turn-a",
      parentId: null,
      nativeCost: null,
      models: [
        {
          model: null,
          components: {
            uncachedInput: "300",
            cachedInput: "300",
            cacheCreation: "0",
            output: "40",
            reasoning: "10",
            inclusiveTotal: "640",
          },
          nativeCost: null,
        },
      ],
    },
  ]);
  expect(read("turn/completed", completed)).toEqual([]);
});
