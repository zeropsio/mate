import { describe, expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { OrchestrationThread, OrchestrationThreadStreamItem } from "./orchestration.ts";

/** How clients decode: the JSON wire codec over the runtime schema. */
const fromWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownExit(Schema.toCodecJson(schema) as never) as (
    value: unknown,
  ) => Exit.Exit<S["Type"], unknown>;

const encodeStreamItem = Schema.encodeUnknownSync(OrchestrationThreadStreamItem);
const encodeThread = Schema.encodeUnknownSync(OrchestrationThread);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const threadFromWire = fromWire(OrchestrationThread);

const activity = (overrides: Record<string, unknown> = {}) => ({
  id: "event-activity-1",
  tone: "tool",
  kind: "tool.updated",
  summary: "Ran a command",
  payload: {},
  turnId: null,
  createdAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
});

const event = (type: string, payload: unknown, sequence = 7) => ({
  kind: "event",
  event: {
    sequence,
    eventId: `event-${sequence}`,
    aggregateKind: "thread",
    aggregateId: "thread-1",
    occurredAt: "2026-10-07T00:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  },
});

describe("OrchestrationThreadStreamItem from a newer Mate", () => {
  const decode = fromWire(OrchestrationThreadStreamItem);

  it.each([
    {
      case: "an event type this build does not know",
      item: event("thread.colour-changed", { threadId: "thread-1", colour: "teal" }),
      eventType: "thread.colour-changed",
    },
    {
      case: "an activity whose tone this build does not know",
      item: event("thread.activity-appended", {
        threadId: "thread-1",
        activity: activity({ tone: "celebration" }),
      }),
      eventType: "thread.activity-appended",
    },
  ])("decodes $case as an unknown event that keeps its sequence", (row) => {
    const exit = decode(row.item);
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") return;
    expect(exit.value).toEqual({ kind: "unknown-event", sequence: 7, eventType: row.eventType });
  });

  it.each([
    {
      case: "a known event with a broken payload",
      item: event("thread.activity-appended", { threadId: "thread-1", activity: { tone: "tool" } }),
    },
    {
      case: "an unknown event without a sequence",
      item: { kind: "event", event: { type: "thread.colour-changed" } },
    },
  ])("still fails $case, so real bugs stay visible", (row) => {
    expect(decode(row.item)._tag).toBe("Failure");
  });

  it("decodes a known event in full", () => {
    const exit = decode(
      event("thread.activity-appended", { threadId: "thread-1", activity: activity() }),
    );
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") return;
    expect(exit.value).toMatchObject({
      kind: "event",
      event: { type: "thread.activity-appended", payload: { activity: { tone: "tool" } } },
    });
  });

  it("never encodes an unknown event", () => {
    expect(() =>
      encodeStreamItem({
        kind: "unknown-event",
        sequence: 7,
        eventType: "thread.colour-changed",
      }),
    ).toThrow();
  });
});

describe("OrchestrationThread from a newer Mate", () => {
  it("drops an activity whose tone this build does not know and keeps the rest", () => {
    const thread = encodeThread(decodeThread(THREAD)) as Record<string, unknown>;
    const exit = threadFromWire({
      ...thread,
      activities: [activity({ id: "kept" }), activity({ id: "dropped", tone: "celebration" })],
    });
    expect(exit._tag).toBe("Success");
    if (exit._tag !== "Success") return;
    expect((exit.value as OrchestrationThread).activities.map((candidate) => candidate.id)).toEqual(
      ["kept"],
    );
  });
});

const THREAD = {
  id: "thread-1",
  projectId: "project-1",
  title: "Thread",
  modelSelection: { instanceId: "codex", model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};
