import {
  AuthStandardClientScopes,
  AuthAccessTokenResult,
  AuthPairingCredentialResult,
  AuthWebSocketTicketResult,
  DEFAULT_SERVER_SETTINGS,
  DispatchResult,
  ExecutionEnvironmentDescriptor,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThread,
  OrchestrationThreadDetailSnapshot,
  OrchestrationThreadShell,
  OrchestrationThreadStreamItem,
  ServerConfig,
  ServerConfigStreamEvent,
  ServerSettings,
  WS_METHODS,
  ZeropsAgentAuthSnapshot,
  SourceControlDiscoveryResult,
  ServerProviderUpdatedPayload,
  ProjectReadFileResult,
  ORCHESTRATION_WS_METHODS,
  MateAttention,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { WebSocket } from "ws";
import * as NodeEvents from "node:events";
import { deadline, type HttpHandler } from "../harness/http.ts";

const decodeExecutionEnvironmentDescriptor = Schema.decodeUnknownSync(
  ExecutionEnvironmentDescriptor,
);
const decodeOrchestrationThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeServerConfig = Schema.decodeUnknownSync(ServerConfig);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeOrchestrationThreadShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeOrchestrationShellSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);
const decodeOrchestrationThreadDetailSnapshot = Schema.decodeUnknownSync(
  OrchestrationThreadDetailSnapshot,
);
const encodeExecutionEnvironmentDescriptor = Schema.encodeSync(ExecutionEnvironmentDescriptor);
const encodeOrchestrationShellSnapshot = Schema.encodeSync(OrchestrationShellSnapshot);
const encodeOrchestrationThreadDetailSnapshot = Schema.encodeSync(
  OrchestrationThreadDetailSnapshot,
);
const encodeServerConfigStreamEvent = Schema.encodeSync(ServerConfigStreamEvent);
const encodeUnknownOrchestrationShellStreamItem = Schema.encodeUnknownSync(
  OrchestrationShellStreamItem,
);
const encodeUnknownOrchestrationThreadStreamItem = Schema.encodeUnknownSync(
  OrchestrationThreadStreamItem,
);
const decodeOrchestrationCommand = Schema.decodeUnknownSync(OrchestrationCommand);
const encodeDispatchResult = Schema.encodeSync(DispatchResult);
const encodeUnknownZeropsAgentAuthSnapshot = Schema.encodeUnknownSync(ZeropsAgentAuthSnapshot);
const pairingCodec = Schema.toCodecJson(AuthPairingCredentialResult);
const pairingBody = Schema.encodeSync(pairingCodec)(
  Schema.decodeSync(pairingCodec)({
    id: "grant",
    credential: "scenario-grant",
    label: "Scenario Owner",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }),
);
const tokenBody = Schema.encodeSync(AuthAccessTokenResult)(
  Schema.decodeSync(AuthAccessTokenResult)({
    access_token: "scenario-mate-bearer",
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: AuthStandardClientScopes.join(" "),
  }),
);
const ticketCodec = Schema.toCodecJson(AuthWebSocketTicketResult);
const ticketBody = Schema.encodeSync(ticketCodec)(
  Schema.decodeSync(ticketCodec)({
    ticket: "scenario-ticket",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }),
);
const encodeProviders = Schema.encodeSync(ServerProviderUpdatedPayload);
const encodeSourceControl = Schema.encodeSync(SourceControlDiscoveryResult);
const encodeReadFile = Schema.encodeSync(ProjectReadFileResult);
const encodeServerConfig = Schema.encodeSync(ServerConfig);
const decodeOrchestrationEvent = Schema.decodeUnknownSync(OrchestrationEvent);
const encodeOrchestrationThreadStreamItem = Schema.encodeSync(OrchestrationThreadStreamItem);
const encodeOrchestrationShellStreamItem = Schema.encodeSync(OrchestrationShellStreamItem);
const decodeMateAttention = Schema.decodeUnknownSync(MateAttention);
const encodeMateAttention = Schema.encodeSync(MateAttention);

const AT = "2026-10-05T12:00:00.000Z";
export interface RpcRequest {
  _tag: string;
  id: string;
  tag: string;
  payload: Record<string, unknown>;
}
export type RpcHandler = (request: RpcRequest, socket: WebSocket) => boolean;

/** Contract-checked snapshots, events and receipts. No provider CLI or orchestration decider. */
export class MateFake {
  readonly rpcHandlers: RpcHandler[] = [];
  readonly requests: RpcRequest[] = [];
  readonly events: OrchestrationEvent[] = [];
  readonly shellEvents: {
    kind: "thread-upserted";
    sequence: number;
    thread: OrchestrationThreadShell;
  }[] = [];
  readonly subscriptions = new Map<WebSocket, Map<string, RpcRequest>>();
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly config: ServerConfig;
  thread: OrchestrationThread;
  sequence = 1;
  acceptMessages = true;
  readonly unknownMethods = new Set<string>();
  private readonly receipts = new NodeEvents.EventEmitter();
  readonly projectId: string;
  readonly name: string;
  /** Its attention's incarnation and revision, and what it says beyond its one chat. */
  attentionIncarnation: string;
  attentionRevision = 0;
  /** How many times it restarted: each restart is a new incarnation of its attention. */
  private restarts = 0;
  private attentionSays: Partial<
    Pick<
      MateAttention,
      "mainThreadId" | "lastThreadId" | "working" | "waiting" | "results" | "questions"
    >
  > = {};
  constructor(projectId: string, name: string) {
    this.attentionIncarnation = `fake-${projectId}`;
    this.projectId = projectId;
    this.name = name;
    this.descriptor = decodeExecutionEnvironmentDescriptor({
      environmentId: `env-${projectId}`,
      label: name,
      platform: { os: "linux", arch: "x64" },
      serverVersion: "0.14.11",
      basePath: "/mate",
      capabilities: { repositoryIdentity: true, accountLifecycleVersion: 1, connectionProbe: true },
      zerops: { projectId, identity: "ok" },
    });
    this.thread = decodeOrchestrationThread({
      id: `thread-${projectId}`,
      projectId: "workspace",
      title: `${name} conversation`,
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      latestTurn: null,
      createdAt: AT,
      updatedAt: AT,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    this.config = decodeServerConfig({
      environment: this.descriptor,
      auth: {
        policy: "remote-reachable",
        bootstrapMethods: ["one-time-token"],
        sessionMethods: ["bearer-access-token"],
        sessionCookieName: "scenario_session",
      },
      cwd: "/workspace",
      keybindingsConfigPath: "/workspace/keybindings.json",
      keybindings: [],
      issues: [],
      availableEditors: [],
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          version: "1.0.0",
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: AT,
          models: [
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isDefault: true,
              capabilities: null,
            },
          ],
        },
      ],
      observability: {
        logsDirectoryPath: "/tmp/logs",
        localTracingEnabled: false,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
        otlpLogsEnabled: false,
      },
      settings: encodeServerSettings(DEFAULT_SERVER_SETTINGS),
      shellResumeCompletionMarker: true,
      threadResumeCompletionMarker: true,
    });
  }

  shellThread() {
    return decodeOrchestrationThreadShell({
      ...this.thread,
      latestUserMessageAt: this.thread.messages.at(-1)?.createdAt ?? null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });
  }
  shell() {
    return decodeOrchestrationShellSnapshot({
      snapshotSequence: this.sequence,
      updatedAt: AT,
      projects: [
        {
          id: "workspace",
          title: this.name,
          workspaceRoot: "/workspace",
          defaultModelSelection: null,
          scripts: [],
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      threads: [this.shellThread()],
    });
  }
  /** Its attention now (`subscribeZeropsAttention`): its one chat main and last, unless it said another. */
  attention(): MateAttention {
    return decodeMateAttention({
      source: {
        environmentId: this.descriptor.environmentId,
        incarnation: this.attentionIncarnation,
        revision: this.attentionRevision,
      },
      mainThreadId: this.thread.id,
      lastThreadId: this.thread.id,
      working: 0,
      waiting: 0,
      results: [],
      questions: [],
      truncated: false,
      ...this.attentionSays,
    });
  }
  /** A new revision of its attention, told no page straight: what only its link to HQ carries. */
  reviseAttention(says: MateFake["attentionSays"] = this.attentionSays): MateAttention {
    this.attentionSays = says;
    this.attentionRevision += 1;
    return this.attention();
  }
  /**
   * A new revision of its attention, sent to every page subscribed to it straight; its link to HQ
   * is the area driver's to send it on.
   */
  publishAttention(says: MateFake["attentionSays"] = this.attentionSays): MateAttention {
    const value = this.reviseAttention(says);
    for (const [socket, subscriptions] of this.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsAttention)
          this.chunk(socket, id, [encodeMateAttention(value)]);
    return value;
  }
  /** Its server restarted: its attention goes on, a new incarnation from revision 0. */
  restart(): void {
    this.restarts += 1;
    this.attentionIncarnation = `fake-${this.projectId}:${this.restarts}`;
    this.attentionRevision = 0;
  }
  snapshot() {
    return decodeOrchestrationThreadDetailSnapshot({
      snapshotSequence: this.sequence,
      thread: this.thread,
    });
  }

  handle: HttpHandler = (request) => {
    const path = request.url.pathname.replace(/^\/mate/u, "");
    if (path === "/.well-known/t3/environment")
      return { body: encodeExecutionEnvironmentDescriptor(this.descriptor) };
    if (path === "/api/auth/zerops-throwaway") return { body: pairingBody };
    if (path === "/oauth/token") return { body: tokenBody };
    if (path === "/api/auth/websocket-ticket") return { body: ticketBody };
    if (path === "/api/orchestration/shell")
      return { body: encodeOrchestrationShellSnapshot(this.shell()) };
    if (path.startsWith("/api/orchestration/threads/"))
      return { body: encodeOrchestrationThreadDetailSnapshot(this.snapshot()) };
    return undefined;
  };

  chunk(socket: WebSocket, id: string, values: unknown[]) {
    socket.send(JSON.stringify({ _tag: "Chunk", requestId: id, values }));
  }
  reply(socket: WebSocket, id: string, value: unknown) {
    socket.send(JSON.stringify({ _tag: "Exit", requestId: id, exit: { _tag: "Success", value } }));
  }
  socket = (socket: WebSocket) => {
    this.subscriptions.set(socket, new Map());
    socket.on("close", () => this.subscriptions.delete(socket));
    socket.on("message", (raw) => {
      for (const request of String(raw)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as RpcRequest)) {
        if (request._tag === "Ping") {
          socket.send(JSON.stringify({ _tag: "Pong" }));
          continue;
        }
        if (request._tag === "Interrupt") {
          this.subscriptions.get(socket)?.delete(request.id);
          continue;
        }
        if (request._tag !== "Request") continue;
        this.requests.push(request);
        if (this.rpcHandlers.some((handler) => handler(request, socket))) continue;
        const { tag, id, payload } = request;
        if (tag === WS_METHODS.subscribeServerConfig)
          this.chunk(socket, id, [
            encodeServerConfigStreamEvent({
              version: 1,
              type: "snapshot",
              config: this.config,
            }),
          ]);
        else if (
          tag === ORCHESTRATION_WS_METHODS.subscribeShell ||
          tag === ORCHESTRATION_WS_METHODS.subscribeThread
        ) {
          this.subscriptions.get(socket)!.set(id, request);
          const after = payload.afterSequence as number | undefined;
          if (tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
            const values =
              after === undefined
                ? [{ kind: "snapshot", snapshot: this.shell() }]
                : this.shellEvents.filter((event) => event.sequence > after);
            this.chunk(
              socket,
              id,
              [...values, { kind: "synchronized" }].map((item) =>
                encodeUnknownOrchestrationShellStreamItem(item),
              ),
            );
          } else {
            const values =
              after === undefined
                ? [{ kind: "snapshot", snapshot: this.snapshot() }]
                : this.events
                    .filter((event) => event.sequence > after)
                    .map((event) => ({ kind: "event", event }));
            this.chunk(
              socket,
              id,
              [...values, { kind: "synchronized" }].map((item) =>
                encodeUnknownOrchestrationThreadStreamItem(item),
              ),
            );
          }
        } else if (tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
          const command = decodeOrchestrationCommand(payload);
          if (command.type === "thread.turn.start" && this.acceptMessages) {
            this.message(command.message.messageId, command.message.text, command.commandId);
          }
          this.reply(socket, id, encodeDispatchResult({ sequence: this.sequence }));
        } else if (tag === WS_METHODS.subscribeZeropsAttention) {
          this.subscriptions.get(socket)!.set(id, request);
          this.chunk(socket, id, [encodeMateAttention(this.attention())]);
        } else if (tag === WS_METHODS.subscribeZeropsAgentAuth) {
          this.chunk(socket, id, [
            encodeUnknownZeropsAgentAuthSnapshot({
              available: true,
              agents: [
                {
                  agentId: "codex",
                  credPresent: true,
                  flagOAuth: false,
                  flagToken: true,
                  providerAuth: "authenticated",
                  state: "authorized-token",
                  authorizedBy: { subject: "owner" },
                },
              ],
            }),
          ]);
        } else if (tag === WS_METHODS.serverRefreshProviders)
          this.reply(socket, id, encodeProviders({ providers: this.config.providers }));
        else if (tag === WS_METHODS.serverReportClientActivity) this.reply(socket, id, undefined);
        else if (tag === WS_METHODS.serverProbe) this.reply(socket, id, {});
        else if (tag === WS_METHODS.serverGetSettings) this.reply(socket, id, this.config.settings);
        else if (tag === WS_METHODS.serverGetConfig)
          this.reply(socket, id, encodeServerConfig(this.config));
        else if (tag === WS_METHODS.serverDiscoverSourceControl)
          this.reply(
            socket,
            id,
            encodeSourceControl({ versionControlSystems: [], sourceControlProviders: [] }),
          );
        else if (tag === WS_METHODS.projectsReadFile)
          this.reply(
            socket,
            id,
            encodeReadFile({
              relativePath: String(payload.relativePath ?? "t3.json"),
              contents: "{}",
              byteLength: 2,
              truncated: false,
            }),
          );
        else if (tag.startsWith("subscribe")) this.subscriptions.get(socket)!.set(id, request);
        else {
          this.unknownMethods.add(tag);
          this.reply(socket, id, {});
        }
      }
    });
  };

  async waitForMessage(text: string) {
    if (this.thread.messages.some((message) => message.text === text)) return;
    const check = () => {};
    let listener = check;
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (this.thread.messages.some((message) => message.text === text)) resolve();
          };
          this.receipts.on("message", listener);
        }),
        `Mate accepted message: ${text}`,
      );
    } finally {
      this.receipts.off("message", listener);
    }
  }

  message(messageId: string, text: string, commandId: string) {
    const event = decodeOrchestrationEvent({
      sequence: ++this.sequence,
      eventId: `event-${this.sequence}`,
      aggregateKind: "thread",
      aggregateId: this.thread.id,
      occurredAt: AT,
      commandId,
      causationEventId: null,
      correlationId: commandId,
      metadata: {},
      type: "thread.message-sent",
      payload: {
        threadId: this.thread.id,
        messageId,
        role: "user",
        text,
        turnId: null,
        streaming: false,
        createdAt: AT,
        updatedAt: AT,
      },
    });
    this.events.push(event);
    this.thread = decodeOrchestrationThread({
      ...this.thread,
      messages: [
        ...this.thread.messages,
        {
          id: messageId,
          role: "user",
          text,
          turnId: null,
          streaming: false,
          createdAt: AT,
          updatedAt: AT,
        },
      ],
    });
    this.receipts.emit("message");
    this.publishAttention();
    const shellEvent = {
      kind: "thread-upserted" as const,
      sequence: this.sequence,
      thread: this.shellThread(),
    };
    this.shellEvents.push(shellEvent);
    for (const [socket, subscriptions] of this.subscriptions)
      for (const [id, request] of subscriptions) {
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeThread)
          this.chunk(socket, id, [encodeOrchestrationThreadStreamItem({ kind: "event", event })]);
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeShell)
          this.chunk(socket, id, [encodeOrchestrationShellStreamItem(shellEvent)]);
      }
  }
}
