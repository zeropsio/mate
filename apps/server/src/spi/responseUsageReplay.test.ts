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

describe("usage at the real provider adapter seam", () => {
  it("the recorded Claude stream records final response usage, never its early assistant snapshot", async () => {
    const events = await replayClaude(loadFixture(claudeDir, "user-input-requested"));
    const facts = events.filter((event) => event.type === "response.usage.completed");
    expect(facts.length).toBeGreaterThan(0);
    const first = facts[0]!;
    expect(first.payload.nativeResponseId).toBe("msg_011CeWiapMXCeGdFrPYo51eg");
    expect(first.payload.components.output).toBe("130");
    expect(first.payload.components.uncachedInput).toBe("2");
    expect(first.payload.parentId).toBeNull();
  });

  it("the recorded Codex parent and child lifetime meters create no response facts", async () => {
    const events = await replayCodex(loadFixture(codexDir, "multi-agent-wire"));
    expect(events.filter((event) => event.type === "response.usage.completed")).toEqual([]);
  });

  it("native Codex parent and child completions preserve each response identity on retry", async () => {
    const notifications = [
      {
        method: "rawResponse/completed",
        params: { threadId: "parent", turnId: "parent-turn", responseId: "parent-response", usage },
      },
      {
        method: "rawResponse/completed",
        params: {
          threadId: "child",
          turnId: "child-turn",
          responseId: "child-response",
          usage: { ...usage, outputTokens: 60, totalTokens: 160 },
        },
      },
    ];
    for (const notification of notifications)
      expect(isCodexCompletion(notification.params)).toBe(true);
    const fixture: Fixture = {
      name: "schema-native-responses",
      dir: codexDir,
      meta: { driver: "codex", synthetic: true },
      lines: [...notifications, notifications[1]!].map((message) => ({ kind: "message", message })),
    };
    const facts = (await replayCodex(fixture)).filter(
      (event) => event.type === "response.usage.completed",
    );
    expect(
      facts.map((fact) => [
        fact.payload.nativeThreadId,
        fact.payload.nativeResponseId,
        fact.payload.components.output,
      ]),
    ).toEqual([
      ["parent", "parent-response", "30"],
      ["child", "child-response", "60"],
      ["child", "child-response", "60"],
    ]);
  });
});
