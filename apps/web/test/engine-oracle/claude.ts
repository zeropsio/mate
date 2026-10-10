/**
 * Claude Code's helpers and background work, as its adapter reports them
 * (`apps/server/src/provider/Layers/ClaudeAdapter.ts`): each event here is the one the adapter
 * offers for the SDK message named beside it, with the payload keys it sets. A helper's own calls
 * carry the launch's `parentToolUseId` and the helper's task id as `agentId` (`:3242`); a task a
 * helper's tool started carries that helper as its owning `agentId` (`task_started`, `:4139`), and
 * every later report of a task repeats its linkage (`taskLinkageFor`, `:1471`).
 */
import * as Effect from "effect/Effect";

import type { EngineWorld } from "../../../server/src/engine/testing/pump/engineWorld.ts";

type Emit = (type: string, fields: Record<string, unknown>) => Effect.Effect<void>;

const emitter =
  (w: EngineWorld): Emit =>
  (type, fields) =>
    w.agent((agent, thread) => agent.emit(type, thread, fields)).pipe(Effect.asVoid);

/** A task's identity as every report of it repeats it (`taskLinkageFor`). */
export interface TaskLinkage {
  readonly taskId: string;
  readonly taskType: "local_bash" | "local_agent";
  readonly title: string;
  readonly toolUseId: string;
  /** The helper whose tool started it. */
  readonly agentId?: string;
}

const linkage = (task: TaskLinkage) => ({
  taskType: task.taskType,
  ...(task.agentId === undefined ? {} : { agentId: task.agentId }),
  title: task.title,
  toolUseId: task.toolUseId,
});

/** Who made a call: the Mate, or a helper by its task id and the launch it runs under. */
export type CallOwner = null | { readonly helper: string; readonly launch: string };

const owned = (owner: CallOwner) =>
  owner === null ? {} : { agentId: owner.helper, parentToolUseId: owner.launch };

/**
 * A call's start (`content_block_start`, `:3263`), and its result (`user` tool_result, `:3530`):
 * the Mate's has an update before its completion, a helper's only its completion (`:3540`).
 */
export const call = (
  w: EngineWorld,
  input: {
    readonly id: string;
    readonly owner: CallOwner;
    readonly tool: "Bash" | "Agent" | "TaskStop";
    readonly args: Record<string, unknown>;
    readonly result: string;
    readonly failed: boolean;
    /** Something said between the start and the result: a task the call started, say. */
    readonly between?: Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    const emit = emitter(w);
    const itemType =
      input.tool === "Bash"
        ? "command_execution"
        : input.tool === "Agent"
          ? "collab_agent_tool_call"
          : "dynamic_tool_call";
    const title =
      input.tool === "Bash"
        ? "Command run"
        : input.tool === "Agent"
          ? "Subagent task"
          : "Tool call";
    const command = input.args.command;
    const detail =
      typeof command === "string"
        ? `${input.tool}: ${command}`
        : input.tool === "Agent"
          ? String(input.args.description)
          : `${input.tool}: ${String(input.args.task_id ?? "")}`;
    const head = { itemType, title, detail, ...owned(input.owner) };
    yield* emit("item.started", {
      itemId: input.id,
      payload: { ...head, status: "inProgress", data: { toolName: input.tool, input: input.args } },
    });
    if (input.between !== undefined) yield* input.between;
    const data = {
      toolName: input.tool,
      input: input.args,
      result: {
        type: "tool_result",
        tool_use_id: input.id,
        content: input.result,
        ...(input.failed ? { is_error: true } : {}),
      },
    };
    if (input.owner === null)
      yield* emit("item.updated", {
        itemId: input.id,
        payload: { ...head, status: input.failed ? "failed" : "inProgress", data },
      });
    yield* emit("item.completed", {
      itemId: input.id,
      payload: { ...head, status: input.failed ? "failed" : "completed", data },
    });
  });

/** `task_started` (`:4206`): a background shell, or a helper launched in the background. */
export const taskStarted = (w: EngineWorld, task: TaskLinkage) =>
  emitter(w)("task.started", {
    payload: { taskId: task.taskId, description: task.title, ...linkage(task) },
  });

/** `task_progress` (`:4243`): what the task runs now, never what it is. */
export const taskProgress = (w: EngineWorld, task: TaskLinkage, now: string) =>
  emitter(w)("task.progress", {
    payload: { taskId: task.taskId, description: now, summary: now, ...linkage(task) },
  });

/** `task_updated` with `killed` (`:4262`): TaskStop's kill, said as `cancelled`. */
export const taskKilled = (w: EngineWorld, task: TaskLinkage) =>
  emitter(w)("task.updated", {
    payload: { taskId: task.taskId, status: "cancelled", ...linkage(task) },
  });

/** `task_notification` (`:4295`): the task's end, with the summary Claude Code writes of it. */
export const taskNotification = (
  w: EngineWorld,
  task: TaskLinkage,
  status: "completed" | "failed" | "stopped",
  summary: string,
) =>
  emitter(w)("task.completed", {
    payload: {
      taskId: task.taskId,
      status,
      summary,
      ...(task.taskType === "local_bash"
        ? { outputFile: `/tmp/claude/${task.taskId}.output` }
        : {}),
      ...linkage(task),
    },
  });
