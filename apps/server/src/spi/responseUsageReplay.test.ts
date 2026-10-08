// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as CodexSchema from "effect-codex-app-server/schema";
import { replayClaude } from "./replay/claudeReplay.ts";
import { replayCodex } from "./replay/codexReplay.ts";
import { loadFixture } from "./replay/loader.ts";
import type { Fixture } from "./replay/types.ts";

const claudeDir = NodeURL.fileURLToPath(new URL("./fixtures/claude", import.meta.url));
const codexDir = NodeURL.fileURLToPath(new URL("./fixtures/codex", import.meta.url));
const isCodexCompletion = Schema.is(CodexSchema.V2RawResponseCompletedNotification);
const usage = {
  inputTokens: 100,
  cachedInputTokens: 40,
  cacheWriteInputTokens: 0,
  outputTokens: 30,
  reasoningOutputTokens: 10,
  totalTokens: 130,
};

describe("turn usage at the real provider adapter seam", () => {
  it("recorded Claude final result counts the main loop and auxiliary model once", async () => {
    // Fresh baseline is a constructed control reply; the result itself is a real recording.
    const events = await replayClaude(loadFixture(claudeDir, "plain-text-turn"));
    const facts = events.filter((event) => event.type === "turn.usage.completed");
    expect(facts).toHaveLength(1);
    const first = facts[0]!;
    expect(first.payload.nativeTurnId).toBe("65b01284-77e6-4fbd-aeb1-12cfa1d48259");
    expect(
      first.payload.models.map((line) => [
        line.model,
        [
          line.components.uncachedInput,
          line.components.cachedInput,
          line.components.cacheCreation,
          line.components.output,
        ]
          .reduce((sum, value) => sum + BigInt(value ?? 0), 0n)
          .toString(),
      ]),
    ).toEqual([
      ["claude-haiku-4-5-20251001", "909"],
      ["claude-opus-5[1m]", "21460"],
    ]);
    expect(first.payload.parentId).toBeNull();
  });
  it("the real Codex multi-agent capture only contains counters, so no exact turn fact is invented", async () => {
    const events = await replayCodex(loadFixture(codexDir, "multi-agent-wire"));
    expect(events.filter((event) => event.type === "turn.usage.completed")).toEqual([]);
  });
  it("constructed native Codex response frames aggregate separately at parent and child completion", async () => {
    const response = (
      threadId: string,
      turnId: string,
      responseId: string,
      outputTokens: number,
    ) => ({
      method: "rawResponse/completed",
      params: {
        threadId,
        turnId,
        responseId,
        ...(threadId === "child" ? { parentThreadId: "parent" } : {}),
        usage: { ...usage, outputTokens, totalTokens: 100 + outputTokens },
      },
    });
    const frames = [
      response("parent", "pturn", "p1", 30),
      response("child", "cturn", "c1", 60),
      response("parent", "pturn", "p2", 3),
      response("child", "cturn", "c2", 5),
    ];
    for (const frame of frames) expect(isCodexCompletion(frame.params)).toBe(true);
    const done = (threadId: string, id: string) => ({
      method: "turn/completed",
      params: { threadId, turn: { id, items: [], status: "completed", error: null } },
    });
    const fixture: Fixture = {
      name: "constructed-native-turns",
      dir: codexDir,
      meta: { driver: "codex", synthetic: true },
      lines: [
        ...frames,
        frames[1]!,
        done("child", "cturn"),
        done("parent", "pturn"),
        done("child", "cturn"),
      ].map((message) => ({ kind: "message", message })),
    };
    const facts = (await replayCodex(fixture)).filter(
      (event) => event.type === "turn.usage.completed",
    );
    expect(
      facts.map((fact) => [
        fact.payload.nativeThreadId,
        fact.payload.nativeTurnId,
        fact.payload.models[0]?.components.output,
      ]),
    ).toEqual([
      ["child", "cturn", "65"],
      ["parent", "pturn", "33"],
    ]);
  });
});
