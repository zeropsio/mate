/**
 * Builders for timeline entries in conversation tests: a message, a tool call,
 * an operation, a landing — each with only what a test needs to say.
 */
import { MessageId, TurnId } from "@t3tools/contracts";
import type { ChangeLandedEvent } from "@t3tools/client-runtime/zerops";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";

export const at = (minute: number, second = 0) =>
  new Date(Date.UTC(2026, 8, 24, 20, minute, second)).toISOString();

export const turn = (id: string) => TurnId.make(id);

export function user(id: string, minute: number, text = `message ${id}`): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: at(minute),
    message: {
      id: MessageId.make(id),
      role: "user",
      text,
      turnId: null,
      createdAt: at(minute),
      updatedAt: at(minute),
      streaming: false,
    },
  };
}

export function assistant(
  id: string,
  turnId: string,
  minute: number,
  text = `note ${id}`,
  options: { streaming?: boolean; second?: number } = {},
): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: at(minute, options.second ?? 0),
    message: {
      id: MessageId.make(id),
      role: "assistant",
      text,
      turnId: TurnId.make(turnId),
      createdAt: at(minute, options.second ?? 0),
      updatedAt: at(minute, (options.second ?? 0) + 1),
      streaming: options.streaming ?? false,
    },
  };
}

export function reasoning(id: string, turnId: string, minute: number): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt: at(minute),
    message: {
      id: MessageId.make(id),
      role: "reasoning",
      text: "thinking about it",
      turnId: TurnId.make(turnId),
      createdAt: at(minute),
      updatedAt: at(minute),
      streaming: false,
    },
  };
}

export function tool(
  id: string,
  turnId: string,
  minute: number,
  overrides: Partial<WorkLogEntry> = {},
): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: at(minute),
    entry: {
      id,
      createdAt: at(minute),
      turnId: TurnId.make(turnId),
      label: "Ran command",
      tone: "tool",
      command: "pnpm test",
      toolCallId: `call-${id}`,
      toolLifecycleStatus: "completed",
      sourceActivityKind: "tool.completed",
      ...overrides,
    },
  };
}

export function operation(
  id: string,
  turnId: string,
  minute: number,
  overrides: Partial<ZeropsOperation> & Pick<ZeropsOperation, "kind">,
): TimelineEntry {
  const op: ZeropsOperation = {
    key: `op:${id}`,
    phase: "done",
    anchorAt: at(minute),
    anchorActivityId: `activity-${id}`,
    settledAt: at(minute, 30),
    turnId,
    subject: "appdev",
    kicker: "Deploy · appdev",
    voice: "Deploying to appdev",
    voiceSource: "mate",
    statusWord: "Deployed",
    steps: [],
    links: [],
    callIds: [`call-${id}`],
    target: { hostname: overrides.subject ?? "appdev" },
    hasResult: true,
    ...overrides,
  };
  return { id, kind: "operation", createdAt: at(minute), operation: op };
}

export function landed(id: string, minute: number, number = 17): TimelineEntry {
  const event: ChangeLandedEvent = {
    key: `landed:${id}`,
    repository: "titandev",
    number,
    title: "Draw distance",
    line: `titandev #${number}`,
    landedAt: at(minute),
  };
  return { id, kind: "change-landed", createdAt: at(minute), event };
}
