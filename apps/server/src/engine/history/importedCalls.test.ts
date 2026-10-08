/**
 * A call the history import brought over reads as the same call made live on the engine: each
 * driver's call-heavy turn, recorded through its real adapter, once through the bridge's fold and
 * once as V1 stored it and the import maps it.
 */
import {
  ConversationId,
  type ItemBody,
  type OrchestrationThreadActivity,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";

import { runtimeEventToActivities } from "../../orchestration/Layers/ProviderRuntimeIngestion.ts";
import type { BridgeDriver } from "../bridge/spi3.ts";
import { makeTranslator } from "../bridge/translate.ts";
import { makeToCore } from "../pump/toCore.ts";
import { recordCallHeavy, type Recording } from "../testing/bridge/callHeavy.ts";
import { planOf, recordsOf, type V1ActivityHead, type V1Bodies } from "./v1.ts";

type CallBody = Extract<ItemBody, { kind: "call" }>;

/** Each call's record as it closed live, in the order the calls opened. */
function liveCalls(driver: BridgeDriver, recording: Recording): ReadonlyArray<CallBody> {
  const translator = makeTranslator({ driver, threadId: recording.threadId });
  const toCore = makeToCore();
  const closed = new Map<string, CallBody>();
  for (const input of recording.log)
    for (const signal of translator.step(input))
      for (const one of toCore.step(signal, 0).signals)
        if (one.kind === "item-closed" && one.body.kind === "call") closed.set(one.key, one.body);
  return [...closed.values()];
}

const TURN = "turn-1";

/** The same calls as V1 stored them, then brought over by the import. */
function importedCalls(recording: Recording): ReadonlyArray<CallBody> {
  const activities = recording.log.flatMap((input) =>
    input.kind === "event"
      ? runtimeEventToActivities(input.event as ProviderRuntimeEvent).filter((activity) =>
          activity.kind.startsWith("tool."),
        )
      : [],
  ) as ReadonlyArray<OrchestrationThreadActivity>;
  const heads: ReadonlyArray<V1ActivityHead> = activities.map((activity, sequence) => {
    const payload = activity.payload as {
      readonly toolCallId?: unknown;
      readonly data?: { readonly toolCallId?: unknown };
    };
    const callId = payload.toolCallId ?? payload.data?.toolCallId;
    return {
      id: activity.id,
      kind: activity.kind,
      summary: activity.summary,
      turnId: TURN,
      callId: typeof callId === "string" ? callId : null,
      taskId: null,
      createdAt: activity.createdAt,
      sequence,
      payload: null,
    };
  });
  const first = heads.map((head) => head.createdAt).toSorted()[0]!;
  const plan = planOf({
    turns: [
      {
        key: TURN,
        turnId: TURN,
        pendingMessageId: null,
        state: "completed",
        requestedAt: first,
        startedAt: first,
        completedAt: heads
          .map((head) => head.createdAt)
          .toSorted()
          .at(-1)!,
      },
    ],
    messages: [],
    activities: heads,
  });
  const bodies: V1Bodies = {
    messages: new Map(),
    activities: new Map(
      activities.map((activity) => [
        activity.id,
        { kind: activity.kind, summary: activity.summary, payload: activity.payload },
      ]),
    ),
  };
  return recordsOf(
    ConversationId.make("conversation-ada"),
    plan,
    0,
    plan.entries.length,
    bodies,
  ).records.flatMap((record) =>
    record._tag === "ItemImported" && record.body.kind === "call" ? [record.body] : [],
  );
}

/** What a call's row reads: its step, its input line, its facts and its result. */
const readsAs = (body: CallBody) => {
  const { images: _images, imagesDropped: _dropped, ...result } = body.result ?? {};
  return {
    step: body.step,
    input: body.input,
    shows: body.shows,
    result: body.result === undefined ? undefined : result,
  };
};

const DRIVERS: ReadonlyArray<BridgeDriver> = [
  "claudeAgent",
  "codex",
  "opencode",
  "cursor",
  "grok",
  "antigravity",
];

describe("a call the history import brought over", () => {
  it.each(
    Array.from(DRIVERS, (driver) => ({
      title: `${driver} [recorded]: a command, a read, an edit and a deploy read as the same calls made live`,
      driver,
    })),
  )("$title", { timeout: 30_000 }, async ({ driver }) => {
    const recording = await recordCallHeavy(driver);
    const live = liveCalls(driver, recording);
    const imported = importedCalls(recording);
    assert.strictEqual(imported.length, live.length);
    imported.forEach((call, n) => {
      assert.deepStrictEqual(readsAs(call), readsAs(live[n]!), `${live[n]!.tool.name}`);
    });
  });
});
