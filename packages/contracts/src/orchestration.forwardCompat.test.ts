import { describe, expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { OrchestrationShellStreamItem, OrchestrationThread } from "./orchestration.ts";

/** How clients decode: the JSON wire codec over the runtime schema. */
const fromWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownExit(Schema.toCodecJson(schema) as never) as (
    value: unknown,
  ) => Exit.Exit<S["Type"], unknown>;

const encodeShellItem = Schema.encodeUnknownSync(OrchestrationShellStreamItem);
const shellFromWire = fromWire(OrchestrationShellStreamItem);
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

const project = (id: string) => ({
  id,
  title: id,
  workspaceRoot: `/repo/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
});

describe("OrchestrationShellStreamItem from a newer Mate", () => {
  it("delivers the known items on either side of a kind this build does not know", () => {
    const wire = [
      { kind: "project-upserted", sequence: 2, project: project("one") },
      { kind: "project-pinned", sequence: 3, projectId: "one" },
      { kind: "project-upserted", sequence: 4, project: project("two") },
    ];
    const decoded = wire.map((item) => {
      const exit = shellFromWire(item);
      expect(exit._tag).toBe("Success");
      return exit._tag === "Success" ? exit.value : undefined;
    });

    expect(decoded.map((item) => item?.kind)).toEqual([
      "project-upserted",
      "unknown-event",
      "project-upserted",
    ]);
    expect(decoded[1]).toEqual({ kind: "unknown-event", sequence: 3 });
  });

  it.each([
    { case: "with no sequence", item: { kind: "shell-hint" }, decoded: { kind: "unknown-event" } },
    {
      case: "with a sequence",
      item: { kind: "shell-hint", sequence: 9 },
      decoded: { kind: "unknown-event", sequence: 9 },
    },
  ])("decodes an unknown kind $case", (row) => {
    const exit = shellFromWire(row.item);
    expect(exit._tag).toBe("Success");
    if (exit._tag === "Success") expect(exit.value).toEqual(row.decoded);
  });

  it("still fails a known kind with a broken payload", () => {
    expect(shellFromWire({ kind: "project-upserted", sequence: 2 })._tag).toBe("Failure");
  });

  it("never encodes an unknown shell item", () => {
    expect(() => encodeShellItem({ kind: "unknown-event", sequence: 3 })).toThrow();
  });
});
