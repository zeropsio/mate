import {
  DispatchResult,
  ORCHESTRATION_WS_METHODS,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadActivity,
  OrchestrationThreadStreamItem,
  WS_METHODS,
  ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { MateFake } from "../../fakes/mate.ts";
import { definePerson } from "../../fakes/zeropsWorld.ts";
import { deadline } from "../../harness/http.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";

const decodeAuth = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
const decodeActivity = Schema.decodeUnknownSync(OrchestrationThreadActivity);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationEvent);

const AT = "2026-10-05T12:00:00.000Z";
const decodeCommand = Schema.decodeUnknownSync(OrchestrationCommand);
const encodeStream = Schema.encodeSync(OrchestrationThreadStreamItem);
const encodeResult = Schema.encodeSync(DispatchResult);
const encodeAuth = Schema.encodeSync(ZeropsAgentAuthSnapshot);

/** Provider-side facts and response receipts, all outside the client. */
export class ChatDriver {
  readonly http: string[] = [];
  readonly responses: OrchestrationCommand[] = [];
  ownership: "project-token" | "owner" | "colleague" | "unrecorded" = "project-token";
  acceptResponses = true;
  signerOffboarded = false;
  readonly mate: MateFake;
  constructor(mate: MateFake) {
    this.mate = mate;
    const original = mate.handle;
    mate.handle = (request) => {
      this.http.push(`${request.method} ${request.url.pathname}`);
      return original(request);
    };
    mate.rpcHandlers.push((request, socket) => {
      if (request.tag === WS_METHODS.subscribeZeropsAgentAuth) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [encodeAuth(this.auth())]);
        return true;
      }
      if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return false;
      const command = decodeCommand(request.payload);
      if (
        command.type !== "thread.approval.respond" &&
        command.type !== "thread.user-input.respond"
      )
        return false;
      this.responses.push(command);
      if (this.acceptResponses) {
        this.activity(
          command.type === "thread.approval.respond" ? "approval.resolved" : "user-input.resolved",
          "Agent received your response",
          { requestId: command.requestId },
        );
        this.assistantReply("Agent received your response", command.commandId);
      }
      mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
      return true;
    });
  }

  sentTurnCount() {
    return this.mate.requests.filter(
      (request) =>
        request.tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
        request.payload.type === "thread.turn.start",
    ).length;
  }

  doorCount() {
    return this.http.filter((path) => path === "POST /mate/api/auth/zerops-throwaway").length;
  }

  commandDecisions() {
    return this.responses.flatMap((command) =>
      command.type === "thread.approval.respond"
        ? [
            command.decision === "accept"
              ? "approved"
              : command.decision === "decline"
                ? "declined"
                : command.decision,
          ]
        : [],
    );
  }

  receivedStagingAnswer() {
    return this.responses.some(
      (command) =>
        command.type === "thread.user-input.respond" &&
        command.requestId === "question-target" &&
        command.answers.target === "stage",
    );
  }

  responseCount() {
    return this.responses.length;
  }

  offboardSigner() {
    this.signerOffboarded = true;
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsAgentAuth)
          this.mate.chunk(socket, id, [encodeAuth(this.auth())]);
  }

  auth(): ZeropsAgentAuthSnapshot {
    if (this.signerOffboarded)
      return decodeAuth({
        available: true,
        agents: [
          {
            agentId: "codex",
            credPresent: false,
            flagOAuth: false,
            flagToken: false,
            providerAuth: "unauthenticated",
            state: "not-authorized",
            authorizedBy: { subject: "owner" },
          },
        ],
      });
    return decodeAuth({
      available: true,
      agents: [
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: this.ownership !== "project-token",
          flagToken: this.ownership === "project-token",
          providerAuth: "authenticated",
          state: this.ownership === "project-token" ? "authorized-token" : "authorized",
          ...(this.ownership === "unrecorded"
            ? {}
            : {
                authorizedBy: { subject: this.ownership === "colleague" ? "colleague" : "owner" },
              }),
        },
      ],
    });
  }

  history(text = "The existing conversation is still here") {
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
      questions: [
        {
          id: "target",
          header: "Target",
          question: "Which environment should I inspect?",
          options: [
            { label: "Staging", value: "stage", description: "Inspect the staging environment" },
            {
              label: "Production",
              value: "production",
              description: "Inspect the live environment",
            },
          ],
          multiSelect: false,
          allowCustomAnswer: true,
        },
      ],
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

const chats = new WeakMap<MateFake, ChatDriver>();
export const installArea: ScenarioExtension = (drivers) => {
  drivers.onMate.push((mate) => chats.set(mate, new ChatDriver(mate)));
};
export function chatFor(mate: MateFake) {
  const chat = chats.get(mate);
  if (!chat) throw new Error("Install c-mate before creating projects");
  return chat;
}

/** A project grant disappears while its existing platform receiver keeps answering heartbeats. */
export async function revokeProjectAccess(drivers: ScenarioDrivers, name: string) {
  await drivers.zerops.waitForRegistration("project");
  const registration = [...drivers.zerops.subscriptions.values()].find(
    (entry) =>
      entry.kind === "project" && entry.output === "listStream" && entry.apiToken === "personal",
  );
  const socket = registration?.socket;
  if (socket === undefined || socket.readyState !== 1)
    throw new Error("A live personal receiver is required");
  let release = () => {};
  let received = () => {};
  let heartbeat = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = new Promise<void>((resolve) => {
    received = resolve;
  });
  const ping = new Promise<void>((resolve) => {
    heartbeat = resolve;
  });
  const onMessage = (raw: import("ws").RawData) => {
    if ((JSON.parse(String(raw)) as { type?: string }).type === "ping") heartbeat();
  };
  socket.on("message", onMessage);
  drivers.cleanup.push(async () => {
    release();
    socket.off("message", onMessage);
  });
  drivers.zerops.handlers.push(async (request) => {
    if (
      request.method !== "GET" ||
      request.url.pathname !== `/api/rest/public/project/${name}` ||
      request.headers.authorization !== "Bearer personal"
    )
      return undefined;
    received();
    await held;
    return drivers.zerops.error(403, "insufficientPermissions", "Project access was revoked.");
  });
  definePerson(drivers.zerops.world, "owner", { role: "NO_ACCESS", grants: { Bea: "BASIC_USER" } });
  const project = drivers.zerops.entities.get("project")?.get(name);
  if (project === undefined) throw new Error(`No project ${name}`);
  drivers.zerops.put("project", { ...project, userRoles: [] });
  await deadline(read, "read revoked project access");
  return {
    heartbeat: async () => {
      await deadline(ping, "existing platform receiver answered heartbeat");
      if (socket.readyState !== 1)
        throw new Error("Revocation closed the receiver before its REST verdict");
    },
    release,
  };
}
