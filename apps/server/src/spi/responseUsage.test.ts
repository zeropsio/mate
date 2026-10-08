import { describe, expect, it } from "vite-plus/test";
import { makeClaudeTurnUsage, makeCodexTurnUsage } from "./responseUsage.ts";

const model = (input: number, output = 0, costUSD = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  thinkingTokens: 0,
  costUSD,
  costBasis: "list",
});
const baseline = (model_usage: unknown = {}, total_cost_usd = 0) => ({
  session: { model_usage, total_cost_usd },
});
const result = (uuid: string, modelUsage: unknown, total_cost_usd = 0, session_id = "session") => ({
  type: "result",
  session_id,
  uuid,
  modelUsage,
  total_cost_usd,
  usage: { input_tokens: 999999 },
});
const raw = (threadId: string, turnId: string, responseId: string, outputTokens: number) => ({
  threadId,
  turnId,
  responseId,
  parentThreadId: threadId === "child" ? "parent" : null,
  usage: {
    inputTokens: 100,
    cachedInputTokens: 40,
    cacheWriteInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: 100 + outputTokens,
  },
});
const complete = (threadId: string, id: string) => ({
  threadId,
  turn: { id, status: "completed" },
});

describe("completed native turn accounting", () => {
  it("Claude subtracts restored history and includes child models once from the native ledger", () => {
    const read = makeClaudeTurnUsage(baseline({ parent: model(200, 10, 0.1) }, 0.1));
    const facts = read(
      result("turn1", { parent: model(230, 12, 0.11), child: model(50, 5, 0.02) }, 0.13),
    );
    expect(facts[0]?.models.map((line) => [line.model, line.components.uncachedInput])).toEqual([
      ["child", "50"],
      ["parent", "30"],
    ]);
    expect(facts[0]?.nativeCost).toMatchObject({ amount: "3", scale: 2, currency: "USD" });
    expect(
      read(result("turn1", { parent: model(230, 12, 0.11), child: model(50, 5, 0.02) }, 0.13)),
    ).toEqual([]);
    const second = read(
      result("turn2", { parent: model(250, 15, 0.12), child: model(50, 5, 0.02) }, 0.14),
    );
    expect(second[0]?.models.map((line) => line.model)).toEqual(["parent"]);
    expect(second[0]?.models[0]?.components.uncachedInput).toBe("20");
  });
  it("Claude assistant, Task, and main-only usage meters are never added to final ledgers", () => {
    const read = makeClaudeTurnUsage(baseline());
    for (const type of ["assistant", "stream_event", "system"])
      expect(read({ type, session_id: "session", usage: { total_tokens: 270 } })).toEqual([]);
    expect(read(result("turn", { model: model(30) }))[0]?.models[0]?.components.uncachedInput).toBe(
      "30",
    );
  });
  it.each(["changed-id", "lower-counters", "missing-ledger", "changed-repeat"])(
    "Claude fails fast on %s",
    (scenario) => {
      const read = makeClaudeTurnUsage(baseline());
      read(result("turn", { model: model(100) }));
      const next =
        scenario === "changed-id"
          ? result("next", { model: model(110) }, 0, "new")
          : scenario === "lower-counters"
            ? result("next", { model: model(10) })
            : scenario === "missing-ledger"
              ? result("next", undefined)
              : result("turn", { model: model(110) });
      expect(() => read(next)).toThrow();
    },
  );
  it("an explicit native conversation reset starts a separately baselined ledger", () => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("turn1", { model: model(100) }));
    read.resetNativeLedger("reset-receipt", "session");
    expect(
      read(result("turn2", { model: model(15) }, 0, "new"))[0]?.models[0]?.components.uncachedInput,
    ).toBe("15");
  });
  it("Claude refuses to subtract costs with a changed native pricing basis", () => {
    const read = makeClaudeTurnUsage(baseline({ model: model(100, 10, 0.1) }, 0.1));
    expect(() =>
      read(result("turn", { model: { ...model(110, 12, 0.11), costBasis: "managed" } }, 0.11)),
    ).toThrow("cost basis changed");
  });
  it.each([-1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "invalid reported Codex token quantities fail (%s)",
    (outputTokens) => {
      const read = makeCodexTurnUsage();
      expect(() =>
        read("rawResponse/completed", raw("parent", "turn", "response", outputTokens)),
      ).toThrow("Invalid provider token quantity");
    },
  );
  it("native reset receipts cannot recount old sessions or reset twice", () => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("old-turn", { model: model(100) }));
    expect(read.resetNativeLedger("reset", "session")).toBe(true);
    expect(() => read(result("old-turn", { model: model(100) }))).toThrow("retired native ledger");
    read(result("new-turn", { model: model(15) }, 0, "actual-new-session"));
    expect(read.resetNativeLedger("reset", "session")).toBe(false);
    expect(
      read(result("next", { model: model(20) }, 0, "actual-new-session"))[0]?.models[0]?.components
        .uncachedInput,
    ).toBe("5");
  });
  it("an unchanged Haiku 10 / Opus 100 ledger reports a zero turn without model participation", () => {
    const history = { Haiku: model(10), Opus: model(100) };
    const read = makeClaudeTurnUsage(baseline(history));
    const facts = read(result("zero", history));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.models).toEqual([]);
    expect(facts[0]?.nativeCost?.amount).toBe("0");
    expect(read(result("zero", history))).toEqual([]);
  });
  it("an empty native ledger with a reported zero cost still records the completed turn", () => {
    const read = makeClaudeTurnUsage(baseline());
    expect(read(result("zero", {}))).toMatchObject([
      { nativeTurnId: "zero", models: [], nativeCost: { amount: "0" } },
    ]);
  });
  it.each([null, undefined])(
    "Codex optional usage %s does not block a later exact meter",
    (usage) => {
      const read = makeCodexTurnUsage();
      expect(
        read("rawResponse/completed", { ...raw("parent", "empty", "empty", 0), usage }),
      ).toEqual([]);
      expect(read("turn/completed", complete("parent", "empty"))).toEqual([]);
      read("rawResponse/completed", raw("parent", "turn", "response", 30));
      expect(
        read("turn/completed", complete("parent", "turn"))[0]?.models[0]?.components.inclusiveTotal,
      ).toBe("130");
    },
  );
  it.each(["turn/completed", "collabAgent/turnCompleted"])(
    "Codex counts each own response once at %s",
    (method) => {
      const read = makeCodexTurnUsage();
      read("rawResponse/completed", raw("parent", "pturn", "p1", 30));
      read("rawResponse/completed", raw("child", "cturn", "c1", 60));
      read("rawResponse/completed", raw("child", "cturn", "c1", 60));
      read("rawResponse/completed", raw("child", "cturn", "c2", 5));
      for (let i = 0; i < 3; i++)
        read("thread/tokenUsage/updated", { tokenUsage: { total: 999999, last: 270 } });
      const child =
        method === "turn/completed"
          ? complete("child", "cturn")
          : { agentThreadId: "child", turn: { id: "cturn", status: "completed" } };
      const fact = read(method, child)[0]!;
      expect(fact.nativeTurnId).toBe("cturn");
      expect(fact.models[0]?.components).toMatchObject({
        uncachedInput: "120",
        cachedInput: "80",
        output: "65",
        inclusiveTotal: "265",
      });
      expect(fact.parentId).toBe("parent");
      expect(read(method, child)).toEqual([]);
      expect(
        read("turn/completed", complete("parent", "pturn"))[0]?.models[0]?.components.output,
      ).toBe("30");
    },
  );
  it("Codex gives no data when an unsupported resumed turn only supplies counters", () => {
    const read = makeCodexTurnUsage();
    read("thread/tokenUsage/updated", { tokenUsage: { total: 999999, last: 270 } });
    expect(read("turn/completed", complete("resumed", "turn"))).toEqual([]);
  });
  it("Codex conflicting response retries fail instead of inflating a turn", () => {
    const read = makeCodexTurnUsage();
    read("rawResponse/completed", raw("parent", "turn", "response", 30));
    expect(() => read("rawResponse/completed", raw("parent", "turn", "response", 60))).toThrow(
      "changed usage",
    );
  });
});
