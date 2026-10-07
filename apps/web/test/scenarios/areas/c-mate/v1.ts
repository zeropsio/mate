import {
  DispatchResult,
  ORCHESTRATION_WS_METHODS,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { MateFake } from "../../fakes/mate.ts";
import {
  RESPONSE_RECEIVED,
  TARGET_QUESTION,
  type ChatAsk,
  type ChatIntent,
  type ChatWire,
} from "./wire.ts";

const decodeActivity = Schema.decodeUnknownSync(OrchestrationThreadActivity);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);

const AT = "2026-10-05T12:00:00.000Z";
const decodeCommand = Schema.decodeUnknownSync(OrchestrationCommand);
const encodeStream = Schema.encodeSync(OrchestrationThreadStreamItem);
const encodeResult = Schema.encodeSync(DispatchResult);

const asked = (requestId: string): ChatAsk =>
  requestId === "approval-build"
    ? "approval"
    : requestId === "question-target"
      ? "question"
      : "other";

/** The V1 orchestration wire: a thread's messages and activities, commands over dispatchCommand. */
export class V1ChatWire implements ChatWire {
  readonly name = "v1";
  readonly mate: MateFake;
  constructor(mate: MateFake) {
    this.mate = mate;
    mate.rpcHandlers.push((request, socket) => {
      if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return false;
      const command = decodeCommand(request.payload);
      if (
        command.type !== "thread.approval.respond" &&
        command.type !== "thread.user-input.respond"
      )
        return false;
      this.activity(
        command.type === "thread.approval.respond" ? "approval.resolved" : "user-input.resolved",
        RESPONSE_RECEIVED,
        { requestId: command.requestId },
      );
      this.assistantReply(RESPONSE_RECEIVED, command.commandId);
      mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
      return true;
    });
  }

  intents() {
    return this.mate.requests.flatMap((request): ChatIntent[] => {
      if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return [];
      const command = decodeCommand(request.payload);
      if (command.type === "thread.turn.start")
        return [{ kind: "turn", text: command.message.text }];
      if (command.type === "thread.approval.respond")
        return [{ kind: "decision", ask: asked(command.requestId), decision: command.decision }];
      if (command.type === "thread.user-input.respond")
        return [{ kind: "answer", ask: asked(command.requestId), answers: command.answers }];
      return [];
    });
  }

  waitForMessage(text: string) {
    return this.mate.waitForMessage(text);
  }

  history(text: string) {
    this.mate.message("history", text, "seed-history");
  }

  approval() {
    this.activity("approval.requested", "Command approval requested", {
      requestId: "approval-build",
      requestKind: "command",
      detail: "vp run build",
    });
  }

  question() {
    this.activity("user-input.requested", "User input requested", {
      requestId: "question-target",
      questions: [TARGET_QUESTION],
    });
  }

  assistantReply(text: string, commandId: string) {
    const mate = this.mate;
    const message = {
      id: `reply-${++mate.sequence}`,
      role: "assistant",
      text,
      turnId: null,
      streaming: false,
      createdAt: AT,
      updatedAt: AT,
    };
    mate.thread = decodeThread({ ...mate.thread, messages: [...mate.thread.messages, message] });
    const event = decodeEvent({
      sequence: mate.sequence,
      eventId: `event-${mate.sequence}`,
      aggregateKind: "thread",
      aggregateId: mate.thread.id,
      occurredAt: AT,
      commandId,
      causationEventId: null,
      correlationId: commandId,
      metadata: {},
      type: "thread.message-sent",
      payload: { ...message, threadId: mate.thread.id, messageId: message.id },
    });
    mate.events.push(event);
    for (const [socket, subscriptions] of mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeThread)
          mate.chunk(socket, id, [encodeStream({ kind: "event", event })]);
  }

  activity(kind: string, summary: string, payload: Record<string, unknown>) {
    const mate = this.mate;
    const activity = decodeActivity({
      id: `activity-${++mate.sequence}`,
      tone: kind.startsWith("approval.") ? "approval" : "info",
      kind,
      summary,
      payload,
      turnId: null,
      createdAt: AT,
    });
    mate.thread = decodeThread({
      ...mate.thread,
      activities: [...mate.thread.activities, activity],
    });
    const event = decodeEvent({
      sequence: mate.sequence,
      eventId: activity.id,
      aggregateKind: "thread",
      aggregateId: mate.thread.id,
      occurredAt: AT,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "thread.activity-appended",
      payload: { threadId: mate.thread.id, activity },
    });
    mate.events.push(event);
    for (const [socket, subscriptions] of mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeThread)
          mate.chunk(socket, id, [encodeStream({ kind: "event", event })]);
  }
}
