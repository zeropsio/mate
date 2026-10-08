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
    expect(facts[0]?.nativeCost).toMatchObject({ amount: "30000000", scale: 9, currency: "USD" });
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
  it.each(["changed-id", "changed-repeat"])("Claude fails fast on %s", (scenario) => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("turn", { model: model(100) }));
    const next =
      scenario === "changed-id"
        ? result("next", { model: model(110) }, 0, "new")
        : result("turn", { model: model(110) });
    expect(() => read(next)).toThrow();
  });
  it("an explicit native conversation reset starts a separately baselined ledger", () => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("turn1", { model: model(100) }));
    read.resetNativeLedger("reset-receipt", "session");
    expect(
      read(result("turn2", { model: model(15) }, 0, "new"))[0]?.models[0]?.components.uncachedInput,
    ).toBe("15");
  });
  it("a new pricing basis retains the 100→230 token delta and .10→.12 reported cost delta", () => {
    const read = makeClaudeTurnUsage(baseline({ model: model(100, 0, 0.1) }, 0.1));
    const fact = read(
      result("turn", { model: { ...model(230, 0, 0.12), costBasis: "managed" } }, 0.12),
    )[0]!;
    expect(fact.models[0]?.components.uncachedInput).toBe("130");
    expect(fact.models[0]?.nativeCost).toMatchObject({
      amount: "20000000",
      scale: 9,
      basis: "managed",
    });
  });
  it("native floating-point USD noise rounds to decimal nanodollars", () => {
    const read = makeClaudeTurnUsage(baseline());
    const fact = read(
      result("turn", { model: model(130, 0, 0.000015000000000000002) }, 0.000015000000000000002),
    )[0]!;
    expect(fact.nativeCost).toMatchObject({ amount: "15000", scale: 9 });
    expect(fact.models[0]?.nativeCost).toMatchObject({ amount: "15000", scale: 9 });
  });
  it("invalid Claude categories and costs stay unknown only until a new trustworthy interval", () => {
    const read = makeClaudeTurnUsage(baseline({ model: model(100, 0, 0.1) }, 0.1));
    const invalid = read(
      result(
        "invalid",
        { model: { ...model(0, 5, 0), inputTokens: "invalid", costUSD: Number.NaN } },
        Number.NaN,
      ),
    )[0]!;
    expect(invalid.models[0]?.components).toMatchObject({ uncachedInput: null, output: "5" });
    expect(invalid.nativeCost).toBeNull();
    expect(invalid.models[0]?.nativeCost).toBeNull();
    const next = read(result("next", { model: model(230, 10, 0.12) }, 0.12))[0]!;
    expect(next.models[0]?.components).toMatchObject({ uncachedInput: null, output: "5" });
    expect(next.nativeCost).toBeNull();
    const recovered = read(result("recovered", { model: model(240, 15, 0.14) }, 0.14))[0]!;
    expect(recovered.models[0]?.components).toMatchObject({ uncachedInput: "10", output: "5" });
    expect(recovered.nativeCost?.amount).toBe("20000000");
  });
  it("an invalid startup cost cannot discard the known native token baseline", () => {
    const read = makeClaudeTurnUsage(
      baseline({ model: { ...model(100), costUSD: "invalid" } }, Number.NaN),
    );
    const fact = read(result("turn", { model: model(230, 0, 0.12) }, 0.12))[0]!;
    expect(fact.models[0]?.components.uncachedInput).toBe("130");
    expect(fact.models[0]?.nativeCost).toBeNull();
    expect(fact.nativeCost).toBeNull();
  });
  it("missing or decreasing cumulative categories do not bridge untrusted Claude intervals", () => {
    const read = makeClaudeTurnUsage(baseline({ model: model(100) }));
    expect(read(result("missing", undefined))).toEqual([]);
    expect(read(result("rebaseline", { model: model(230) }))).toEqual([]);
    expect(
      read(result("known", { model: model(240) }))[0]?.models[0]?.components.uncachedInput,
    ).toBe("10");
    expect(read(result("decreased", { model: model(1) }))).toEqual([]);
    expect(
      read(result("after-decrease", { model: model(6) }))[0]?.models[0]?.components.uncachedInput,
    ).toBe("5");
  });
  it.each([-1, 1.2, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "invalid reported Codex output stays unknown while known categories survive (%s)",
    (outputTokens) => {
      const read = makeCodexTurnUsage();
      const frame = raw("parent", "turn", "response", outputTokens);
      read("rawResponse/completed", { ...frame, usage: { ...frame.usage, totalTokens: 130 } });
      expect(
        read("turn/completed", complete("parent", "turn"))[0]?.models[0]?.components,
      ).toMatchObject({
        output: null,
        uncachedInput: "60",
        cachedInput: "40",
        inclusiveTotal: "130",
      });
    },
  );
  it("native reset receipts cannot recount old sessions or reset twice", () => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("old-turn", { model: model(100) }));
    read.resetNativeLedger("reset", "session");
    expect(() => read(result("old-turn", { model: model(100) }))).toThrow("retired native ledger");
    read(result("new-turn", { model: model(15) }, 0, "actual-new-session"));
    read.resetNativeLedger("reset", "session");
    expect(
      read(result("next", { model: model(20) }, 0, "actual-new-session"))[0]?.models[0]?.components
        .uncachedInput,
    ).toBe("5");
  });
  it("an unchanged Haiku 10 / Opus 100 ledger emits nothing", () => {
    const history = { Haiku: model(10), Opus: model(100) };
    const read = makeClaudeTurnUsage(baseline(history));
    const facts = read(result("zero", history));
    expect(facts).toEqual([]);
    expect(read(result("zero", history))).toEqual([]);
  });
  it("an empty native ledger with a reported zero cost emits nothing", () => {
    const read = makeClaudeTurnUsage(baseline());
    expect(read(result("zero", {}))).toEqual([]);
  });
  it("a zero Codex meter emits nothing and does not block later turns", () => {
    const read = makeCodexTurnUsage();
    const frame = raw("parent", "zero", "zero", 0);
    read("rawResponse/completed", {
      ...frame,
      usage: Object.fromEntries(Object.keys(frame.usage).map((key) => [key, 0])),
    });
    expect(read("turn/completed", complete("parent", "zero"))).toEqual([]);
    read("rawResponse/completed", raw("child", "later", "later", 30));
    expect(
      read("turn/completed", complete("child", "later"))[0]?.models[0]?.components.inclusiveTotal,
    ).toBe("130");
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
    expect(
      read("turn/completed", complete("parent", "turn"))[0]?.models[0]?.components.inclusiveTotal,
    ).toBe("130");
    read("rawResponse/completed", raw("child", "later", "later", 30));
    expect(
      read("turn/completed", complete("child", "later"))[0]?.models[0]?.components.inclusiveTotal,
    ).toBe("130");
  });
  it("rejected Claude identities do not disable later native facts", () => {
    const read = makeClaudeTurnUsage(baseline());
    read(result("first", { model: model(100) }));
    expect(() => read(result("first", { model: model(110) }))).toThrow("changed usage");
    expect(
      read(result("later", { model: model(130) }))[0]?.models[0]?.components.uncachedInput,
    ).toBe("30");
    expect(() => read(result("new-session", { model: model(100) }, 0, "new-session"))).toThrow(
      "new baseline",
    );
    expect(
      read(result("next", { model: model(130) }, 0, "new-session"))[0]?.models[0]?.components
        .uncachedInput,
    ).toBe("30");
  });
});
