import {
  ClientOrchestrationCommand,
  ORCHESTRATION_WS_METHODS,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadStreamItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { MateFake } from "../../fakes/mate.ts";
import {
  RESPONSE_RECEIVED,
  effortOf,
  TARGET_QUESTION,
  type ChatAsk,
  type ChatIntent,
  type ChatWire,
} from "./wire.ts";

const decodeActivity = Schema.decodeUnknownSync(OrchestrationThreadActivity);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const decodeMessage = Schema.decodeUnknownSync(OrchestrationMessage);
const decodeCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const encodeStream = Schema.encodeSync(OrchestrationThreadStreamItem);

const AT = "2026-10-05T12:00:00.000Z";

type ResponseCommand = Extract<
  ClientOrchestrationCommand,
  { type: "thread.approval.respond" | "thread.user-input.respond" }
>;

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
  /** Once a run is live, events carry wall-clock times instead of the fixed seed time. */
  live = false;
  private readonly questionTurns = new Map<string, string | null>();
  private readonly applied = new Set<string>();
  constructor(mate: MateFake) {
    this.mate = mate;
  }

  /** Every turn the client dispatched, and every response the Mate accepted, in wire order. */
  intents() {
    return this.mate.requests.flatMap((request): ChatIntent[] => {
      if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return [];
      const command = decodeCommand(request.payload);
      if (command.type === "thread.turn.start") {
        const effort = effortOf(command.modelSelection?.options);
        return [
          {
            kind: "turn",
            text: command.message.text,
            ...(effort === undefined ? {} : { effort }),
            ...(command.interactionMode === "plan" ? { plan: true as const } : {}),
          },
        ];
      }
      if (command.type === "thread.runtime-mode.set")
        return [{ kind: "access", runtimeMode: command.runtimeMode }];
      if (!this.applied.has(command.commandId)) return [];
      if (command.type === "thread.approval.respond")
        return [{ kind: "decision", ask: asked(command.requestId), decision: command.decision }];
      if (command.type === "thread.user-input.respond")
        return [
          {
            kind: "answer",
            ask: asked(command.requestId),
            requestId: command.requestId,
            answers: command.answers,
            ...(command.attachmentsByQuestionId === undefined
              ? {}
              : { attachmentsByQuestionId: command.attachmentsByQuestionId }),
          },
        ];
      return [];
    });
  }

  waitForMessage(text: string) {
    return this.mate.waitForMessage(text);
  }

  history(text: string, turnId: string | null = null) {
    this.message("history", "user", text, turnId);
  }

  reply(turnId: string, text: string) {
    this.message(`reply-${turnId}`, "assistant", text, turnId);
  }

  private exchanges = 0;
  exchange(question: string, answer: string) {
    this.exchanges += 1;
    this.message(`exchange-${this.exchanges}-ask`, "user", question);
    this.message(`exchange-${this.exchanges}-answer`, "assistant", answer);
  }

  approval() {
    this.activity("approval.requested", "Command approval requested", {
      requestId: "approval-build",
      requestKind: "command",
      detail: "vp run build",
    });
  }

  /** Writes a run as the thread's latest turn and session: the area's driver owns the thread. */
  writeRun: (turnId: string, state: "running" | "completed" | "error" | "interrupted") => void =
    () => {
      throw new Error("V1's runs are written by the area's driver");
    };

  run(turnId: string, state: "running" | "completed" | "error" | "interrupted") {
    this.writeRun(turnId, state);
  }

  question(requestId = "question-target", turnId: string | null = null) {
    this.questionTurns.set(requestId, turnId);
    this.activity(
      "user-input.requested",
      "User input requested",
      { requestId, questions: [TARGET_QUESTION] },
      turnId,
    );
  }

  /** The Mate accepts the person's response: the ask resolves and the agent acknowledges it. */
  respond(command: ResponseCommand) {
    this.applied.add(command.commandId);
    const turnId = this.questionTurns.get(String(command.requestId)) ?? null;
    this.activity(
      command.type === "thread.approval.respond" ? "approval.resolved" : "user-input.resolved",
      RESPONSE_RECEIVED,
      {
        requestId: command.requestId,
        ...(command.type === "thread.user-input.respond"
          ? {
              answers: command.answers,
              attachmentsByQuestionId: command.attachmentsByQuestionId,
            }
          : {}),
      },
      turnId,
    );
    if (
      command.type === "thread.user-input.respond" &&
      command.attachmentsByQuestionId &&
      Object.keys(command.attachmentsByQuestionId).length > 0
    )
      this.activity(
        "user-input.answer-submitted",
        "Question answer submitted",
        {
          requestId: command.requestId,
          answers: command.answers,
          questionTextById: { target: TARGET_QUESTION.question },
          attachmentsByQuestionId: command.attachmentsByQuestionId,
          detail: Object.values(command.attachmentsByQuestionId)
            .flat()
            .map((file) => file.name)
            .join("\n"),
        },
        turnId,
      );
    this.assistantReply(RESPONSE_RECEIVED, command.commandId);
  }

  event(
    type: OrchestrationEvent["type"],
    payload: Record<string, unknown>,
    commandId: string | null = null,
  ) {
    const mate = this.mate;
    const event = decodeEvent({
      sequence: ++mate.sequence,
      eventId: `event-${mate.sequence}`,
      aggregateKind: "thread",
      aggregateId: mate.thread.id,
      occurredAt: this.at(),
      commandId,
      causationEventId: null,
      correlationId: commandId,
      metadata: {},
      type,
      payload,
    });
    mate.events.push(event);
    for (const [socket, subscriptions] of mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (
          request.tag === ORCHESTRATION_WS_METHODS.subscribeThread &&
          request.payload.threadId === mate.thread.id
        )
          mate.chunk(socket, id, [encodeStream({ kind: "event", event })]);
    return event;
  }

  at() {
    return this.live
      ? new Date().toISOString()
      : new Date(Date.parse(AT) + this.mate.sequence).toISOString();
  }

  message(
    id: string,
    role: OrchestrationMessage["role"],
    text: string,
    turnId: string | null = null,
    extra: Partial<OrchestrationMessage> = {},
    commandId: string | null = null,
  ) {
    const message = decodeMessage({
      id,
      role,
      text,
      turnId,
      streaming: false,
      createdAt: this.at(),
      updatedAt: this.at(),
      ...extra,
    });
    this.mate.thread = decodeThread({
      ...this.mate.thread,
      messages: [...this.mate.thread.messages.filter((row) => row.id !== message.id), message],
    });
    this.event(
      "thread.message-sent",
      { ...message, messageId: id, threadId: this.mate.thread.id },
      commandId,
    );
  }

  assistantReply(text: string, commandId: string) {
    this.message(
      `reply-${commandId}`,
      "assistant",
      text,
      this.mate.thread.latestTurn?.turnId ?? null,
    );
  }

  activity(
    kind: string,
    summary: string,
    payload: Record<string, unknown>,
    turnId: string | null = null,
  ) {
    const mate = this.mate;
    const activity = decodeActivity({
      id: `activity-${++mate.sequence}`,
      tone: kind.startsWith("approval.")
        ? "approval"
        : kind.startsWith("tool.")
          ? "tool"
          : kind === "runtime.error"
            ? "error"
            : "info",
      kind,
      summary,
      payload,
      turnId,
      createdAt: this.at(),
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
        if (
          request.tag === ORCHESTRATION_WS_METHODS.subscribeThread &&
          request.payload.threadId === mate.thread.id
        )
          mate.chunk(socket, id, [encodeStream({ kind: "event", event })]);
  }
}
