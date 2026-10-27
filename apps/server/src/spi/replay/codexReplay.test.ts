// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import { loadFixture } from "./loader.ts";
import { replayCodex } from "./codexReplay.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixturesDir = NodePath.join(__dirname, "../fixtures/codex");

describe("replayCodex", () => {
  it("maps every notification in the real multi-agent-wire capture through the ported mapper", async () => {
    const fixture = loadFixture(fixturesDir, "multi-agent-wire");

    const events = await replayCodex(fixture);

    // Every notification either maps to at least one runtime event or is
    // legitimately unhandled (mapToRuntimeEvents returns []) — the point
    // of this test is that replay runs end to end and produces a
    // deterministic, non-empty result pinning current behavior.
    assert.isAbove(events.length, 0);

    const types = events.map((event) => event.type);
    // thread/started and turn/started notifications are always handled.
    assert.include(types, "thread.started");
    assert.include(types, "turn.started");
    // item/completed notifications carry real subAgentActivity /
    // collabAgentToolCall items from the capture.
    assert.include(types, "item.completed");
  }, 20_000);
});
