import {
  AuthStandardClientScopes,
  AuthSessionState,
  AuthAccessTokenResult,
  AuthPairingCredentialResult,
  AuthWebSocketTicketResult,
  DEFAULT_SERVER_SETTINGS,
  ExecutionEnvironmentDescriptor,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
  OrchestrationThread,
  OrchestrationThreadShell,
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
  VcsStatusResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { WebSocket } from "ws";
import type { HttpHandler } from "../harness/http.ts";
import { MateEngineFake } from "./mateEngine.ts";

const encodeVcsStatus = Schema.encodeSync(VcsStatusResult);
const checkoutStatus = encodeVcsStatus({
  isRepo: false,
  hasPrimaryRemote: false,
  isDefaultRef: true,
  refName: null,
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
});

const decodeExecutionEnvironmentDescriptor = Schema.decodeUnknownSync(
  ExecutionEnvironmentDescriptor,
);
const decodeOrchestrationThread = Schema.decodeUnknownSync(OrchestrationThread);
const decodeServerConfig = Schema.decodeUnknownSync(ServerConfig);
const encodeServerSettings = Schema.encodeSync(ServerSettings);
const decodeOrchestrationThreadShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeOrchestrationShellSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);
const encodeExecutionEnvironmentDescriptor = Schema.encodeSync(ExecutionEnvironmentDescriptor);
const encodeOrchestrationShellSnapshot = Schema.encodeSync(OrchestrationShellSnapshot);
const encodeServerConfigStreamEvent = Schema.encodeSync(ServerConfigStreamEvent);
const encodeUnknownOrchestrationShellStreamItem = Schema.encodeUnknownSync(
  OrchestrationShellStreamItem,
);
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
const encodeSessionState = Schema.encodeSync(AuthSessionState);
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
  readonly subscriptions = new Map<WebSocket, Map<string, RpcRequest>>();
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly config: ServerConfig;
  thread: OrchestrationThread;
  sequence = 1;
  readonly unknownMethods = new Set<string>();
  /** Its conversation, on its engine: every Mate serves the engine. */
  readonly engine: MateEngineFake;
  /** The conversation as its wire holds it: what a journey waits on for a person's message. */
  conversation: { waitForMessage(text: string): Promise<void> };
  readonly projectId: string;
  readonly name: string;
  /** Its attention's incarnation and revision, and what it says beyond its one chat. */
  attentionIncarnation: string;
  attentionRevision = 0;
  /** How many times it restarted: each restart is its next epoch, a new incarnation. */
  private restarts = 0;
  /** Its attention as the run before the last restart left it. */
  private runBefore: MateAttention | undefined;
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
      serverVersion: "0.16.0",
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
    });
    this.engine = new MateEngineFake(this).install();
    this.conversation = this.engine;
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
        epoch: this.restarts + 1,
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
  /** Its server restarted: its attention goes on in the next epoch, a new incarnation from revision 0. */
  restart(): void {
    this.runBefore = this.attention();
    this.restarts += 1;
    this.attentionIncarnation = `fake-${this.projectId}:${this.restarts}`;
    this.attentionRevision = 0;
  }
  /**
   * A word of the run before its last restart, said late — after a partition, that run never
   * killed — at a revision past where it stopped.
   */
  lateFromRunBefore(says: MateFake["attentionSays"]): MateAttention {
    const before = this.runBefore!;
    return decodeMateAttention({
      ...before,
      source: { ...before.source, revision: before.source.revision + 1 },
      ...says,
    });
  }
  handle: HttpHandler = (request) => {
    const path = request.url.pathname.replace(/^\/mate/u, "");
    if (path === "/api/auth/session") {
      if (request.method === "OPTIONS") return { status: 204 };
      return {
        body: encodeSessionState({
          authenticated: true,
          auth: this.config.auth,
          scopes: AuthStandardClientScopes,
          sessionMethod: "bearer-access-token",
        }),
      };
    }
    if (path === "/.well-known/t3/environment")
      return { body: encodeExecutionEnvironmentDescriptor(this.descriptor) };
    if (path === "/api/auth/zerops-throwaway") return { body: pairingBody };
    if (path === "/oauth/token") return { body: tokenBody };
    if (path === "/api/auth/websocket-ticket") return { body: ticketBody };
    if (path === "/api/orchestration/shell")
      return { body: encodeOrchestrationShellSnapshot(this.shell()) };
    return undefined;
  };

  chunk(socket: WebSocket, id: string, values: unknown[]) {
    socket.send(JSON.stringify({ _tag: "Chunk", requestId: id, values }));
  }
  reply(socket: WebSocket, id: string, value: unknown) {
    socket.send(JSON.stringify({ _tag: "Exit", requestId: id, exit: { _tag: "Success", value } }));
  }
  /**
   * The person said `text` (a seeded message: its id and command are the caller's words): one
   * exchange of its engine's conversation, and the attention that follows it.
   */
  message(_messageId: string, text: string, _commandId: string) {
    this.engine.personTurn(text);
    this.publishAttention();
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
        else if (tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
          this.subscriptions.get(socket)!.set(id, request);
          // Its thread list changes on no V1 event: a resumed read is caught up at once.
          const values =
            payload.afterSequence === undefined
              ? [{ kind: "snapshot", snapshot: this.shell() }]
              : [];
          this.chunk(
            socket,
            id,
            [...values, { kind: "synchronized" }].map((item) =>
              encodeUnknownOrchestrationShellStreamItem(item),
            ),
          );
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
        else if (tag === WS_METHODS.vcsRefreshStatus)
          // Focus and pending-question actions read the checkout independently of HQ's repository.
          this.reply(socket, id, checkoutStatus);
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
}
