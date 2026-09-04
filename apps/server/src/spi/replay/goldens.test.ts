// @effect-diagnostics nodeBuiltinImport:off
/**
 * Runs every driver's replay/record function and compares its redacted
 * output against the checked-in `<name>.expected.json` next to its
 * fixture. This is the regression gate D4/acceptance describes: a ported
 * driver that changes the normalized output of a recorded stream (or, for
 * the live-driven ACP/OpenCode baselines, the output of the fixed
 * deterministic scenario) fails here, naming the fixture and the first
 * differing event.
 *
 * Set `SPI_UPDATE_GOLDENS=1` to (re)write every golden instead of
 * comparing — state the reason in the commit message.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { SpiEvent, SpiToolCall } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import { extractZeropsEnvelope } from "../../zerops/zeropsEnvelope.ts";
import { applyToolCall } from "../toolCall.ts";
import { replayClaude } from "./claudeReplay.ts";
import { replayCodex } from "./codexReplay.ts";
import {
  recordAntigravityBaseline,
  recordCursorBaseline,
  recordGrokBaseline,
} from "./acpReplay.ts";
import { recordOpenCodeBaseline } from "./openCodeReplay.ts";
import { checkOrUpdateGolden, describeFirstDivergence, expectedPathFor } from "./goldenCheck.ts";
import { loadFixture } from "./loader.ts";
import { redact } from "./redact.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixturesRoot = NodePath.join(__dirname, "../fixtures");

// turnId/itemId/requestId are freshly generated per replay run (crypto
// UUIDs, or a driver-assigned id derived from one) — redact them by value
// so two events sharing a real id keep sharing their redacted placeholder.
const REDACT_IDS = [
  { fields: ["turnId", "providerTurnId"], prefix: "turn" },
  { fields: ["itemId", "providerItemId"], prefix: "item" },
  { fields: ["requestId", "providerRequestId"], prefix: "req" },
];

interface GoldenCase {
  readonly driver: string;
  readonly name: string;
  readonly record: () => Promise<ReadonlyArray<SpiEvent>>;
  readonly timeoutMs: number;
}

// Claude/Codex: replay a static JSONL wire fixture through the ported
// adapter (see claudeReplay.ts / codexReplay.ts for the seam each uses).
// The four Claude fixtures are real recordings (SPI-3,
// apps/server/src/spi/recording/record-claude.mjs, SDK 0.3.250 / CLI
// 2.1.251 / claude-opus-5[1m]); Codex's is the real
// codexMultiAgentWire.json capture converted once to JSONL.
const CLAUDE_FIXTURE_NAMES = [
  "plain-text-turn",
  "zerops-workflow-envelope",
  "user-input-requested",
  "turn-abort-error",
] as const;

const jsonlCases: ReadonlyArray<GoldenCase> = [
  ...CLAUDE_FIXTURE_NAMES.map((name): GoldenCase => ({
    driver: "claude",
    name,
    record: () => replayClaude(loadFixture(NodePath.join(fixturesRoot, "claude"), name)),
    timeoutMs: 20_000,
  })),
  {
    driver: "codex",
    name: "multi-agent-wire",
    record: () =>
      replayCodex(loadFixture(NodePath.join(fixturesRoot, "codex"), "multi-agent-wire")),
    timeoutMs: 20_000,
  },
];

// Cursor/Grok/Antigravity/OpenCode: no static wire capture exists to replay
// from (ACP drivers speak to a real child process, OpenCode to an SDK
// client); each "fixture" carries only meta.json documenting the fixed live
// scenario its record() function drives — see acpReplay.ts / openCodeReplay.ts.
const liveCases: ReadonlyArray<GoldenCase> = [
  { driver: "cursor", name: "hello-baseline", record: recordCursorBaseline, timeoutMs: 30_000 },
  { driver: "grok", name: "hello-baseline", record: recordGrokBaseline, timeoutMs: 30_000 },
  {
    driver: "antigravity",
    name: "hello-baseline",
    record: recordAntigravityBaseline,
    timeoutMs: 30_000,
  },
  { driver: "opencode", name: "hello-baseline", record: recordOpenCodeBaseline, timeoutMs: 15_000 },
];

describe("SPI replay goldens", () => {
  for (const { driver, name, record, timeoutMs } of [...jsonlCases, ...liveCases]) {
    it(
      `${driver}/${name} matches its golden`,
      async () => {
        const dir = NodePath.join(fixturesRoot, driver);
        const events = await record();
        // Goldens capture the enriched bus shape — the SPI boundary
        // consumers actually read (SPI-4) — not the driver's raw output: a
        // regression a driver-shape change causes on `event.toolCall` fails
        // here too, not only downstream in `apps/server/src/zerops/**`.
        const enriched = events.map(applyToolCall);
        const redacted = redact(enriched as ReadonlyArray<Record<string, unknown>>, {
          ids: REDACT_IDS,
        });

        const { updated, expected } = checkOrUpdateGolden(dir, name, redacted);
        if (updated) {
          return;
        }

        const divergence = describeFirstDivergence(`${driver}/${name}`, redacted, expected);
        assert.isUndefined(divergence, divergence);
      },
      timeoutMs,
    );
  }
});

interface McpToolCallItemCompleted {
  readonly type: string;
  readonly toolCall?: SpiToolCall;
  readonly payload: {
    readonly itemType?: string;
    readonly data?: {
      readonly toolName?: string;
      readonly result?: {
        readonly content?: ReadonlyArray<{ readonly text?: string }>;
      };
    };
  };
}

/**
 * Pins a content-level invariant of the checked-in golden itself (not just
 * "replay still matches golden") — the fixture this golden comes from
 * exists specifically to confirm both StateEnvelope wire carriers
 * (docs/spec-mate.md §1) survive the Claude adapter's normalization. SPI-4's
 * enrichment slice reads this exact item.completed/payload.data shape.
 * Reads the checked-in file directly (not a fresh replay) so a
 * SPI_UPDATE_GOLDENS regeneration that quietly loses the envelope content
 * still fails here.
 */
describe("zerops-workflow-envelope golden content", () => {
  const readGoldenEvents = (): ReadonlyArray<McpToolCallItemCompleted> => {
    const goldenPath = expectedPathFor(
      NodePath.join(fixturesRoot, "claude"),
      "zerops-workflow-envelope",
    );
    return JSON.parse(
      NodeFS.readFileSync(goldenPath, "utf8"),
    ) as ReadonlyArray<McpToolCallItemCompleted>;
  };

  it("carries the StateEnvelope on the wire for both zerops_workflow and zerops_mount", () => {
    const events = readGoldenEvents();

    const toolResultText = (toolName: string): string => {
      const event = events.find(
        (candidate) =>
          candidate.type === "item.completed" &&
          candidate.payload.itemType === "mcp_tool_call" &&
          candidate.payload.data?.toolName === toolName,
      );
      assert.isDefined(event, `expected an item.completed mcp_tool_call event for ${toolName}`);
      const text = event?.payload.data?.result?.content?.[0]?.text;
      assert.isDefined(text, `expected data.result.content[0].text for ${toolName}`);
      return text as string;
    };

    // The fenced ```json zcp-envelope block carrier.
    const workflowText = toolResultText("mcp__zerops__zerops_workflow");
    const envelopeFenceCount = (workflowText.match(/zcp-envelope/g) ?? []).length;
    assert.equal(
      envelopeFenceCount,
      1,
      "zerops_workflow's tool result must carry exactly one fenced zcp-envelope block",
    );

    // The top-level "envelope" JSON key carrier.
    const mountText = toolResultText("mcp__zerops__zerops_mount");
    const mountParsed = JSON.parse(mountText) as Record<string, unknown>;
    assert.property(
      mountParsed,
      "envelope",
      "zerops_mount's tool result must be JSON with a top-level envelope key",
    );
  });

  /**
   * SPI-4: the same two invariant carriers, this time through the enriched
   * `toolCall` view every `apps/server/src/zerops/**` consumer actually
   * reads (never `payload.data`) — a regression the enrichment introduces
   * (dropping `toolCall`, or a `result.text` it can no longer decode an
   * envelope from) fails here even though the raw `payload.data` assertion
   * above still passes.
   */
  it("SPI-4: toolCall is populated for both zerops_workflow and zerops_mount, and each result's text decodes an envelope", () => {
    const events = readGoldenEvents();

    const toolCallFor = (toolName: string): SpiToolCall => {
      const event = events.find(
        (candidate) => candidate.type === "item.completed" && candidate.toolCall?.name === toolName,
      );
      assert.isDefined(event?.toolCall, `expected an item.completed toolCall for ${toolName}`);
      return event!.toolCall!;
    };

    for (const toolName of ["zerops_workflow", "zerops_mount"]) {
      const call = toolCallFor(toolName);
      assert.isDefined(call.result, `${toolName}: toolCall.result should be present`);
      assert.strictEqual(call.result?.failed, false, `${toolName}: toolCall.result.failed`);
      const envelope = extractZeropsEnvelope(call.result?.text ?? "");
      assert.isDefined(envelope, `${toolName}: result.text should decode a zcp envelope`);
    }
  });
});
