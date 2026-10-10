import {
  DispatchResult,
  ProjectSearchEntriesResult,
  ZeropsLifecycle,
  ReviewDiffPreviewInput,
  ReviewDiffPreviewResult,
  ClientOrchestrationCommand,
  ATTACHMENT_UPLOAD_URL_TTL_MS,
  OrchestrationThreadDetailPage,
  ZeropsBrowserStreamEvent,
  OrchestrationThreadShell,
  OrchestrationThreadDetailSnapshot,
  OrchestrationShellStreamItem,
  ServerConfigStreamEvent,
  ServerProviderUpdatedPayload,
  ThreadUsagePause,
  McpServersList,
  McpServerSetEnabledInput,
  OrchestrationCheckpointSummary,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  CrewSnapshot,
  CrewTask,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  CrewCommand,
  CrewCommandResult,
  CrewFiles,
  ZeropsDataConsoleRequest,
  ZeropsDataConsoleResponse,
  ZeropsDataConsoleSessionEvent,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  ThreadFileWritesInput,
  ThreadFileWritesResult,
  ORCHESTRATION_WS_METHODS,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationThread,
  OrchestrationThreadStreamItem,
  WS_METHODS,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentLoginCancelInput,
  ZeropsAgentLoginStartInput,
  ZeropsAgentLoginStartResult,
} from "@t3tools/contracts";
import * as NodeEvents from "node:events";
import type { WebSocket } from "ws";
import { deadline } from "../../harness/http.ts";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import type { MateFake } from "../../fakes/mate.ts";
import { definePerson, projectRoles } from "../../fakes/zeropsWorld.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import * as Effect from "effect/Effect";
import { enrollMate } from "../../../../../hq/test/harness/runningCore.ts";
import { reportConversation } from "../b-menu/fake.ts";
import { V1ChatWire } from "./v1.ts";
import type { ChatIntent, ChatWire } from "./wire.ts";
import { EngineChatWire } from "./engine.ts";
import { inject } from "vite-plus/test";

const wireEncodeSearchEntries = Schema.encodeSync(ProjectSearchEntriesResult);

const wireDecodeLoginStart = Schema.decodeUnknownSync(ZeropsAgentLoginStartInput);
const wireEncodeLoginStartResult = Schema.encodeSync(ZeropsAgentLoginStartResult);
const wireDecodeZeropsLifecycle = Schema.decodeUnknownSync(ZeropsLifecycle);
const wireEncodeZeropsLifecycle = Schema.encodeSync(ZeropsLifecycle);
const wireDecodeAssetCreateUrlInput = Schema.decodeUnknownSync(AssetCreateUrlInput);
const wireDecodeAttachmentCreateUploadUrlInput = Schema.decodeUnknownSync(
  AttachmentCreateUploadUrlInput,
);
const wireDecodeClientOrchestrationCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const wireDecodeCrewCommand = Schema.decodeUnknownSync(CrewCommand);
const wireDecodeCrewSnapshot = Schema.decodeUnknownSync(CrewSnapshot);
const wireDecodeCrewTask = Schema.decodeUnknownSync(CrewTask);
const wireDecodeMcpServerSetEnabledInput = Schema.decodeUnknownSync(McpServerSetEnabledInput);
const wireDecodeMcpServersList = Schema.decodeUnknownSync(McpServersList);
const wireDecodeOrchestrationCheckpointSummary = Schema.decodeUnknownSync(
  OrchestrationCheckpointSummary,
);
const wireDecodeOrchestrationGetTurnDiffInput = Schema.decodeUnknownSync(
  OrchestrationGetTurnDiffInput,
);
const wireDecodeOrchestrationShellStreamItem = Schema.decodeUnknownSync(
  OrchestrationShellStreamItem,
);
const wireDecodeOrchestrationThread = Schema.decodeUnknownSync(OrchestrationThread);
const wireDecodeOrchestrationThreadDetailSnapshot = Schema.decodeUnknownSync(
  OrchestrationThreadDetailSnapshot,
);
const wireDecodeOrchestrationThreadShell = Schema.decodeUnknownSync(OrchestrationThreadShell);
const wireDecodeReviewDiffPreviewInput = Schema.decodeUnknownSync(ReviewDiffPreviewInput);
const wireDecodeReviewDiffPreviewResult = Schema.decodeUnknownSync(ReviewDiffPreviewResult);
const wireDecodeServerProviderUpdatedPayload = Schema.decodeUnknownSync(
  ServerProviderUpdatedPayload,
);
const wireDecodeThreadFileWritesInput = Schema.decodeUnknownSync(ThreadFileWritesInput);
const wireDecodeZeropsAgentAuthSnapshot = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
const wireDecodeZeropsAgentLoginCancelInput = Schema.decodeUnknownSync(ZeropsAgentLoginCancelInput);
const wireDecodeZeropsDataConsoleRequest = Schema.decodeUnknownSync(ZeropsDataConsoleRequest);
const wireDecodeZeropsDataConsoleResponse = Schema.decodeUnknownSync(ZeropsDataConsoleResponse);
const wireEncodeAssetCreateUrlResult = Schema.encodeSync(AssetCreateUrlResult);
const wireEncodeAttachmentCreateUploadUrlResult = Schema.encodeSync(
  AttachmentCreateUploadUrlResult,
);
const wireEncodeCrewCommandResult = Schema.encodeSync(CrewCommandResult);
const wireEncodeCrewFiles = Schema.encodeSync(CrewFiles);
const wireEncodeCrewSnapshot = Schema.encodeSync(CrewSnapshot);
const wireEncodeDispatchResult = Schema.encodeSync(DispatchResult);
const wireEncodeMcpServersList = Schema.encodeSync(McpServersList);
const wireEncodeOrchestrationGetTurnDiffResult = Schema.encodeSync(OrchestrationGetTurnDiffResult);
const wireEncodeOrchestrationShellStreamItem = Schema.encodeSync(OrchestrationShellStreamItem);
const wireEncodeOrchestrationThreadDetailSnapshot = Schema.encodeSync(
  OrchestrationThreadDetailSnapshot,
);
const wireEncodeOrchestrationThreadStreamItem = Schema.encodeSync(OrchestrationThreadStreamItem);
const wireEncodeReviewDiffPreviewResult = Schema.encodeSync(ReviewDiffPreviewResult);
const wireEncodeServerConfigStreamEvent = Schema.encodeSync(ServerConfigStreamEvent);
const wireEncodeThreadFileWritesResult = Schema.encodeSync(ThreadFileWritesResult);
const wireEncodeZeropsAgentAuthSnapshot = Schema.encodeSync(ZeropsAgentAuthSnapshot);
const wireEncodeZeropsBrowserStreamEvent = Schema.encodeSync(ZeropsBrowserStreamEvent);
const wireEncodeZeropsDataConsoleResponse = Schema.encodeSync(ZeropsDataConsoleResponse);
const wireEncodeZeropsDataConsoleSessionEvent = Schema.encodeSync(ZeropsDataConsoleSessionEvent);

const decodeAuth = wireDecodeZeropsAgentAuthSnapshot;
const decodeThread = wireDecodeOrchestrationThread;

const AT = "2026-10-05T12:00:00.000Z";
const decodeCommand = wireDecodeClientOrchestrationCommand;
const encodeStream = wireEncodeOrchestrationThreadStreamItem;
const encodeResult = wireEncodeDispatchResult;
const encodeAuth = wireEncodeZeropsAgentAuthSnapshot;

/** Provider-side facts and response receipts, all outside the client. */
export class ChatDriver {
  crew: CrewSnapshot | null = null;
  crewRefusal: string | null = null;
  lifecycle: ZeropsLifecycle;
  revertRefusal: string | null = null;
  responseRefusal: string | null = null;
  readonly mcpActions: McpServerSetEnabledInput[] = [];
  mcp = wireDecodeMcpServersList({
    agents: ["codex"],
    servers: [
      {
        name: "inspector",
        transport: { type: "stdio", command: "inspect", args: [] },
        managed: false,
        agents: [
          { driver: "codex", state: "connected", tools: [{ name: "read_orders", readOnly: true }] },
        ],
      },
    ],
  });
  readonly diffs: OrchestrationGetTurnDiffInput[] = [];
  readonly crewCommands: CrewCommand[] = [];
  readonly otherThreads = new Map<string, OrchestrationThread>();
  database: ZeropsDataConsoleResponse = wireDecodeZeropsDataConsoleResponse({
    kind: "services",
    project: { id: "fixture", name: "fixture" },
    allowWrites: false,
    services: [],
  });
  holdReplay = false;
  page: OrchestrationThreadDetailPage | undefined;
  readonly pages = new Map<string, () => Promise<OrchestrationThreadDetailSnapshot>>();
  readonly heldData = new Map<string, (reply: () => void) => void>();
  readonly databaseReplies = new Map<string, ZeropsDataConsoleResponse>();
  readonly commands: ClientOrchestrationCommand[] = [];
  private readonly receipts = new NodeEvents.EventEmitter();
  private readonly replay = new Map<WebSocket, string>();
  usagePause: ThreadUsagePause | null = null;
  turnRefusal: string | null = null;
  turnAdmissionRefusal: import("@t3tools/contracts").AgentAdmissionRefusal | undefined;
  readonly assets = new Map<string, { bytes: Buffer; mimeType: string }>();
  readonly writes = new Map<string, ReadonlyArray<import("@t3tools/contracts").FileWrite>>();
  readonly http: string[] = [];
  ownership: "project-token" | "owner" | "colleague" | "unrecorded" = "project-token";
  signerOffboarded = false;
  authSnapshot: ZeropsAgentAuthSnapshot | null = null;
  readonly startedLogins: ZeropsAgentLoginStartInput[] = [];
  readonly cancelledLogins: ZeropsAgentLoginCancelInput[] = [];
  readonly mate: MateFake;
  /** The V1 thread the area's richer fixtures write to. */
  readonly v1: V1ChatWire;
  /** The conversation the journeys arrange and read through, on whichever wire the Mate speaks. */
  readonly wire: ChatWire;
  constructor(mate: MateFake, wire?: ChatWire) {
    this.mate = mate;
    this.v1 = new V1ChatWire(mate);
    this.v1.writeRun = (turnId, state) => this.run(turnId, state);
    this.wire = wire ?? this.v1;
    mate.conversation = this.wire;
    if (wire instanceof EngineChatWire)
      // The Mate refuses the caller before its engine sees the call, as it refuses a V1 command.
      wire.engine.authorization = (op) =>
        op === "answer" ? this.responseRefusal : op === "send" ? this.turnRefusal : null;
    this.lifecycle = wireDecodeZeropsLifecycle({ threadId: mate.thread.id, recentTools: [] });
    Object.assign(mate.config, { threadSnapshotPagination: true });
    Object.assign(mate.config.environment.capabilities, {
      threadSnapshotPagination: true,
      attachmentUploads: true,
      questionAttachments: true,
      fileAttachments: { maxUploadBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES },
    });
    Object.assign(mate.descriptor.capabilities!, {
      threadSnapshotPagination: true,
      attachmentUploads: true,
      questionAttachments: true,
      fileAttachments: { maxUploadBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES },
    });
    const originalSnapshot = mate.snapshot.bind(mate);
    const originalShellSnapshot = mate.shell.bind(mate);
    mate.shell = () => ({
      ...originalShellSnapshot(),
      threads: [
        mate.shellThread(),
        ...[...this.otherThreads.values()].map((thread) =>
          wireDecodeOrchestrationThreadShell({
            ...thread,
            latestUserMessageAt: null,
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            hasActionableProposedPlan: false,
          }),
        ),
      ],
    });
    const originalShell = mate.shellThread.bind(mate);
    mate.shellThread = () => ({ ...originalShell(), usagePause: this.usagePause });
    const original = mate.handle;
    mate.handle = (request) => {
      this.http.push(`${request.method} ${request.url.pathname}${request.url.search}`);
      const path = request.url.pathname.replace(/^\/mate/u, "");
      if (path.startsWith("/api/orchestration/threads/")) {
        const threadId = path.split("/").at(-1)!;
        const thread = this.otherThreads.get(threadId);
        const cursor = request.url.searchParams.get("beforeCursor");
        if (this.pages.has(cursor ?? ""))
          return this.pages.get(cursor ?? "")!().then((snapshot) => ({
            body: wireEncodeOrchestrationThreadDetailSnapshot(snapshot),
          }));
        return {
          body: wireEncodeOrchestrationThreadDetailSnapshot(
            thread
              ? {
                  snapshotSequence: mate.sequence,
                  thread,
                }
              : {
                  ...originalSnapshot(),
                  ...(this.page ? { page: { ...this.page, snapshotSequence: mate.sequence } } : {}),
                },
          ),
        };
      }
      if (path.startsWith("/api/chat-assets/")) {
        if (request.method === "OPTIONS") return { status: 204 };
        const id = path.split("/").at(-1)!;
        if (request.method === "POST") {
          this.assets.set(id, {
            bytes: request.rawBody ?? Buffer.alloc(0),
            mimeType: String(request.headers["content-type"]),
          });
          return { body: { ok: true } };
        }
        const asset = this.assets.get(id);
        return asset
          ? { bytes: asset.bytes, headers: { "content-type": asset.mimeType } }
          : { status: 404, body: { message: "Recorded image bytes are unavailable" } };
      }
      return original(request);
    };
    mate.rpcHandlers.push((request, socket) => {
      if (request.tag === WS_METHODS.projectsSearchEntries) {
        mate.reply(socket, request.id, wireEncodeSearchEntries({ entries: [], truncated: false }));
        return true;
      }
      if (request.tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [
          wireEncodeOrchestrationShellStreamItem({ kind: "snapshot", snapshot: mate.shell() }),
          wireEncodeOrchestrationShellStreamItem({ kind: "synchronized" }),
        ]);
        return true;
      }
      if (request.tag === WS_METHODS.zeropsAgentLoginStart) {
        this.startedLogins.push(wireDecodeLoginStart(request.payload));
        mate.reply(socket, request.id, wireEncodeLoginStartResult({ terminalId: "login-claude" }));
        return true;
      }
      if (request.tag === WS_METHODS.zeropsAgentLoginCancel) {
        this.cancelledLogins.push(wireDecodeZeropsAgentLoginCancelInput(request.payload));
        this.receipts.emit("wire");
        mate.reply(socket, request.id, undefined);
        return true;
      }
      if (request.tag === WS_METHODS.subscribeZeropsCrew && this.crew) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [wireEncodeCrewSnapshot(this.crew)]);
        return true;
      }
      if (request.tag === WS_METHODS.zeropsCrewCommand) {
        this.crewCommands.push(wireDecodeCrewCommand(request.payload));
        this.receipts.emit("wire");
        if (this.crewRefusal) {
          socket.send(
            JSON.stringify({
              _tag: "Exit",
              requestId: request.id,
              exit: {
                _tag: "Failure",
                cause: [
                  {
                    _tag: "Fail",
                    error: {
                      _tag: "CrewCommandError",
                      reason: "not-allowed",
                      detail: this.crewRefusal,
                    },
                  },
                ],
              },
            }),
          );
          return true;
        }
        mate.reply(socket, request.id, wireEncodeCrewCommandResult({ _tag: "done" }));
        return true;
      }
      if (request.tag === WS_METHODS.zeropsCrewFilesGet) {
        mate.reply(
          socket,
          request.id,
          wireEncodeCrewFiles({
            files: [
              {
                path: "crew.yaml",
                content:
                  "name: Inspection crew\nbriefTitle: Inspect safely\nmembers:\n  - handle: scout\n    displayName: Scout\n    kind: reader\n    login: codex\n    model: gpt-5.4\n    effort: high\n    tint: sky\n",
              },
              { path: "brief.md", content: "# Inspect safely\nRead the project." },
              { path: "jobs/scout.md", content: "Read the schema without changes." },
            ],
          }),
        );
        return true;
      }
      if (request.tag === WS_METHODS.subscribeZeropsLifecycle) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [wireEncodeZeropsLifecycle(this.lifecycle)]);
        return true;
      }
      if (request.tag === WS_METHODS.subscribeZeropsBrowserStream) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [{ type: "state", status: "no-browser" }]);
        this.receipts.emit("browser-subscription");
        return true;
      }
      if (request.tag === WS_METHODS.subscribeZeropsDataConsole) {
        mate.chunk(socket, request.id, [
          wireEncodeZeropsDataConsoleSessionEvent({ status: "ready", allowWrites: false }),
        ]);
        return true;
      }
      if (request.tag === WS_METHODS.zeropsDataConsoleCall) {
        const input = wireDecodeZeropsDataConsoleRequest(request.payload);
        const key =
          input.kind === "tree"
            ? `${input.kind}:${input.path.service}:${input.path.segments.join("/")}`
            : input.kind;
        const reply = () =>
          mate.reply(
            socket,
            request.id,
            wireEncodeZeropsDataConsoleResponse(this.databaseReplies.get(key) ?? this.database),
          );
        const hold = this.heldData.get(key);
        if (hold) hold(reply);
        else reply();
        return true;
      }
      if (
        request.tag === ORCHESTRATION_WS_METHODS.subscribeThread &&
        this.otherThreads.has(String(request.payload.threadId))
      ) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [
          encodeStream({
            kind: "snapshot",
            snapshot: {
              snapshotSequence: mate.sequence,
              thread: this.otherThreads.get(String(request.payload.threadId))!,
            },
          }),
          encodeStream({ kind: "synchronized" }),
        ]);
        return true;
      }
      if (request.tag === WS_METHODS.attachmentsCreateUploadUrl) {
        wireDecodeAttachmentCreateUploadUrlInput(request.payload);
        const attachmentId = `asset-${mate.requests.length}`;
        mate.reply(
          socket,
          request.id,
          wireEncodeAttachmentCreateUploadUrlResult({
            attachmentId,
            relativeUrl: `/api/chat-assets/${attachmentId}`,
            expiresAt: Date.now() + ATTACHMENT_UPLOAD_URL_TTL_MS,
          }),
        );
        return true;
      }
      if (request.tag === WS_METHODS.assetsCreateUrl) {
        const { resource } = wireDecodeAssetCreateUrlInput(request.payload);
        const id =
          resource._tag === "attachment"
            ? resource.attachmentId
            : resource._tag === "project-favicon"
              ? resource.path
              : resource.path;
        mate.reply(
          socket,
          request.id,
          wireEncodeAssetCreateUrlResult({
            relativeUrl: `/api/chat-assets/${id}`,
            expiresAt: Date.now() + ATTACHMENT_UPLOAD_URL_TTL_MS,
          }),
        );
        return true;
      }
      if (request.tag === WS_METHODS.attachmentsDelete) {
        mate.reply(socket, request.id, undefined);
        return true;
      }
      if (request.tag === WS_METHODS.threadsFileWrites) {
        const input = wireDecodeThreadFileWritesInput(request.payload);
        mate.reply(
          socket,
          request.id,
          wireEncodeThreadFileWritesResult({
            calls: input.toolCallIds.map((toolCallId) => ({
              toolCallId,
              writes: this.writes.get(toolCallId) ?? [],
            })),
          }),
        );
        return true;
      }
      if (request.tag === WS_METHODS.mcpServersList) {
        mate.reply(socket, request.id, wireEncodeMcpServersList(this.mcp));
        return true;
      }
      if (request.tag === WS_METHODS.mcpServersSetEnabled) {
        const input = wireDecodeMcpServerSetEnabledInput(request.payload);
        this.mcpActions.push(input);
        this.mcp = {
          ...this.mcp,
          servers: this.mcp.servers.map((server) =>
            server.name !== input.name
              ? server
              : {
                  ...server,
                  agents: server.agents.map((agent) => ({
                    ...agent,
                    state: input.enabled ? ("connected" as const) : ("disabled" as const),
                  })),
                },
          ),
        };
        mate.reply(socket, request.id, wireEncodeMcpServersList(this.mcp));
        return true;
      }
      if (request.tag === WS_METHODS.reviewGetDiffPreview) {
        const input = wireDecodeReviewDiffPreviewInput(request.payload);
        mate.reply(
          socket,
          request.id,
          wireEncodeReviewDiffPreviewResult(
            wireDecodeReviewDiffPreviewResult({
              cwd: input.cwd,
              generatedAt: DateTime.makeUnsafe(AT),
              sources: [],
            }),
          ),
        );
        return true;
      }
      if (request.tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
        const input = wireDecodeOrchestrationGetTurnDiffInput(request.payload);
        this.diffs.push(input);
        mate.reply(
          socket,
          request.id,
          wireEncodeOrchestrationGetTurnDiffResult({
            ...input,
            diff: "diff --git a/appdev/summary.txt b/appdev/summary.txt\n--- a/appdev/summary.txt\n+++ b/appdev/summary.txt\n@@ -1 +1 @@\n-Old order total\n+Recorded order total\n",
            coverage: "partial",
            roots: [
              { rootId: "app-root", label: "appdev", pathPrefix: "appdev/", status: "available" },
            ],
          }),
        );
        return true;
      }
      if (request.tag === WS_METHODS.subscribeServerConfig) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [
          wireEncodeServerConfigStreamEvent({
            version: 1,
            type: "snapshot",
            config: mate.config,
          }),
        ]);
        return true;
      }
      if (request.tag === ORCHESTRATION_WS_METHODS.subscribeThread && this.holdReplay) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        this.replay.set(socket, request.id);
        this.receipts.emit("wire");
        return true;
      }
      if (request.tag === ORCHESTRATION_WS_METHODS.subscribeThread) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [
          encodeStream({ kind: "snapshot", snapshot: mate.snapshot() }),
          encodeStream({ kind: "synchronized" }),
        ]);
        return true;
      }
      if (request.tag === WS_METHODS.subscribeZeropsAgentAuth) {
        mate.subscriptions.get(socket)!.set(request.id, request);
        mate.chunk(socket, request.id, [encodeAuth(this.auth())]);
        return true;
      }
      if (request.tag !== ORCHESTRATION_WS_METHODS.dispatchCommand) return false;
      const command = decodeCommand(request.payload);
      this.commands.push(command);
      this.receipts.emit("wire");
      if (command.type === "thread.conversation.revert" && this.revertRefusal) {
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: request.id,
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: { _tag: "OrchestrationDispatchCommandError", message: this.revertRefusal },
                },
              ],
            },
          }),
        );
        return true;
      }
      const authorizationRefusal =
        command.type === "thread.turn.start"
          ? this.turnRefusal
          : command.type === "thread.user-input.respond"
            ? this.responseRefusal
            : null;
      if (authorizationRefusal) {
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: request.id,
            exit: {
              _tag: "Failure",
              cause: [
                {
                  _tag: "Fail",
                  error: {
                    ...(command.type === "thread.turn.start" &&
                    this.turnAdmissionRefusal !== undefined
                      ? {
                          _tag: "OrchestrationDispatchCommandError",
                          agentAdmission: this.turnAdmissionRefusal,
                        }
                      : {
                          _tag: "EnvironmentAuthorizationError",
                          requiredScope: "orchestration:operate",
                        }),
                    message: authorizationRefusal,
                  },
                },
              ],
            },
          }),
        );
        return true;
      }
      if (command.type === "thread.turn.start" && mate.acceptMessages) {
        this.v1.live = true;
        const attachments = command.message.attachments.map((attachment, index) => {
          if (!("dataUrl" in attachment)) return attachment;
          const id = `${command.message.messageId}-${index}`;
          this.assets.set(id, {
            bytes: Buffer.from(attachment.dataUrl.split(",")[1]!, "base64"),
            mimeType: attachment.mimeType,
          });
          return {
            type: attachment.type,
            id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          };
        });
        if (command.modelSelection)
          mate.thread = decodeThread({ ...mate.thread, modelSelection: command.modelSelection });
        this.message(
          command.message.messageId,
          "user",
          command.message.text,
          null,
          { attachments },
          command.commandId,
        );
        this.shell();
        mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
        return true;
      }
      if (command.type === "thread.archive" || command.type === "thread.unarchive") {
        const at = this.at();
        const archived = command.type === "thread.archive";
        mate.thread = decodeThread({
          ...mate.thread,
          archivedAt: archived ? at : null,
          updatedAt: at,
        });
        this.event(
          archived ? "thread.archived" : "thread.unarchived",
          {
            threadId: mate.thread.id,
            updatedAt: at,
            ...(archived ? { archivedAt: at } : {}),
          },
          command.commandId,
        );
        this.shell();
        mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
        return true;
      }
      if (command.type === "thread.usage-auto-resume.set") {
        if (this.usagePause) this.usagePause = { ...this.usagePause, autoResume: command.enabled };
        this.event("thread.usage-auto-resume-set", {
          threadId: mate.thread.id,
          usageAutoResumeDisabledAt: command.enabled ? null : this.at(),
        });
        this.shell();
        mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
        return true;
      }
      if (
        command.type !== "thread.approval.respond" &&
        command.type !== "thread.user-input.respond"
      )
        return false;
      this.v1.respond(command);
      mate.reply(socket, request.id, encodeResult({ sequence: mate.sequence }));
      return true;
    });
  }

  /** The endpoint has received the page read; the server chooses when its snapshot arrives. */
  holdPage(cursor: string, snapshot: OrchestrationThreadDetailSnapshot) {
    let arrived!: () => void;
    let release!: (snapshot: OrchestrationThreadDetailSnapshot) => void;
    const requested = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const response = new Promise<OrchestrationThreadDetailSnapshot>((resolve) => {
      release = resolve;
    });
    this.pages.set(cursor, () => {
      arrived();
      return response;
    });
    return {
      requested: () =>
        deadline(requested, "Older page requested").catch((cause) => {
          throw new Error(`Older page not requested: ${this.http.join(" | ")}`, { cause });
        }),
      release: () => release(snapshot),
    };
  }

  async browserSubscribed() {
    const subscribed = () =>
      [...this.mate.subscriptions.values()].some((requests) =>
        [...requests.values()].some(
          (request) => request.tag === WS_METHODS.subscribeZeropsBrowserStream,
        ),
      );
    if (subscribed()) return;
    let received = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          received = resolve;
          this.receipts.once("browser-subscription", received);
        }),
        "Browser stream subscription",
        8000,
      );
    } finally {
      this.receipts.off("browser-subscription", received);
    }
  }

  browser(event: ZeropsBrowserStreamEvent) {
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsBrowserStream)
          this.mate.chunk(socket, id, [wireEncodeZeropsBrowserStreamEvent(event)]);
  }

  holdDataReply(key: string) {
    let received!: () => void;
    const requested = new Promise<void>((resolve) => {
      received = resolve;
    });
    const replies: Array<() => void> = [];
    this.heldData.set(key, (reply) => {
      replies.push(reply);
      received();
    });
    return {
      requested: () => deadline(requested, `Data request ${key}`),
      release: () => {
        this.heldData.delete(key);
        for (const reply of replies) reply();
      },
    };
  }

  databaseCatalog() {
    this.database = wireDecodeZeropsDataConsoleResponse({
      kind: "services",
      project: { id: "Ada", name: "Ada" },
      allowWrites: false,
      services: [
        {
          hostname: "ordersdb",
          type: "postgresql@16",
          family: "postgres",
          support: "supported",
          status: "ACTIVE",
          actions: [{ id: "readTable", enabled: true, readOnly: true, reason: "" }],
        },
      ],
    });
    this.databaseReplies.set(
      "tree:ordersdb:",
      wireDecodeZeropsDataConsoleResponse({
        kind: "tree",
        nextCursor: "",
        nodes: [
          {
            name: "orders",
            kind: "tabular",
            path: { service: "ordersdb", segments: ["public", "orders"] },
            hasChildren: false,
          },
        ],
      }),
    );
    this.databaseReplies.set(
      "table",
      wireDecodeZeropsDataConsoleResponse({
        kind: "table",
        page: {
          columns: [
            {
              name: "order_id",
              dataType: "uuid",
              pk: true,
              editable: false,
              reason: "Read-only schema",
              sortable: true,
              sortReason: "",
            },
          ],
          rows: [],
          nextCursor: "",
          rowKeyCols: ["order_id"],
          bestEffort: false,
          numbered: false,
        },
      }),
    );
  }

  checkpoint(turnId: string) {
    const summary = wireDecodeOrchestrationCheckpointSummary({
      turnId,
      checkpointTurnCount: 1,
      checkpointRef: "refs/mate/checkpoints/one",
      status: "ready",
      files: [{ path: "appdev/summary.txt", kind: "modified", additions: 1, deletions: 1 }],
      assistantMessageId: null,
      completedAt: this.at(),
      history: {
        runId: turnId,
        coverage: "partial",
        semantics: "observed-workspace",
        representation: "git-normalized",
        policyVersion: "1",
        roots: [
          {
            root: {
              rootId: "app-root",
              label: "appdev",
              remotePath: "/appdev",
              pathPrefix: "appdev/",
            },
            before: {
              status: "captured",
              oid: "before-app",
              ref: "refs/mate/before",
              startedAt: AT,
              completedAt: AT,
            },
            after: {
              status: "captured",
              oid: "after-app",
              ref: "refs/mate/after",
              startedAt: AT,
              completedAt: AT,
            },
          },
          {
            root: {
              rootId: "api-root",
              label: "apidev",
              remotePath: "/apidev",
              pathPrefix: "apidev/",
            },
            before: {
              status: "captured",
              oid: "before-api",
              ref: "refs/mate/before-api",
              startedAt: AT,
              completedAt: AT,
            },
            after: {
              status: "refused",
              reason: "apidev could not be captured; retry that repository",
            },
          },
        ],
      },
    });
    this.snapshot({ checkpoints: [summary] });
  }

  seedCrew() {
    const thread = decodeThread({
      ...this.mate.thread,
      id: "crew-scout",
      title: "Scout's inspection",
      crew: { crew: "inspection", crewmate: "scout", stint: 1 },
      messages: [
        {
          id: "scout-history",
          role: "assistant",
          text: "Scout has its own conversation",
          turnId: null,
          streaming: false,
          createdAt: AT,
          updatedAt: AT,
        },
      ],
      activities: [
        {
          id: "job-saved",
          kind: "crew.seam",
          summary: "Scout's job changed — from its next message",
          tone: "info",
          turnId: null,
          createdAt: "2026-10-05T12:00:01.000Z",
          payload: { seam: "saved", apply: "nextTurn" },
        },
      ],
    });
    this.otherThreads.set(thread.id, thread);
    this.crew = wireDecodeCrewSnapshot({
      status: "applied",
      seq: 1,
      crew: {
        name: "Inspection crew",
        briefTitle: "Inspect safely",
        briefVersion: 1,
        briefExcerpt: "Read the project.",
      },
      crewmates: [
        {
          handle: "scout",
          displayName: "Scout",
          tint: "sky",
          kind: "reader",
          jobFirstLine: "Read the schema without changes.",
          jobVersion: 1,
          promptVersions: { running: { brief: 1, job: 1 }, current: { brief: 1, job: 1 } },
          login: { id: "codex", label: "Codex", agent: "codex" },
          model: "gpt-5.4",
          effort: "high",
          readOnly: true,
          host: null,
          currentThreadId: thread.id,
          stints: [
            {
              stint: 1,
              threadId: thread.id,
              state: "open",
              reason: null,
              lastCompactSummary: null,
              startedAt: AT,
              retiredAt: null,
            },
          ],
          context: null,
          compactions: 0,
          memory: { entries: 0, unfiled: 0 },
          openTaskId: null,
          queuedTaskIds: [],
          lane: null,
          app: null,
        },
      ],
      hosts: [],
      board: {
        tasks: [
          wireDecodeCrewTask({
            id: "orders-task",
            number: 7,
            title: "Inspect the order schema",
            owner: "scout",
            state: "landed",
            source: "you",
            createdBy: "owner",
            createdAt: AT,
            dependsOn: [],
            fresh: false,
            brief: "Check the order IDs.",
            doneWhen: "The keys are documented.",
            attempts: 1,
            reason: null,
            question: null,
            waitingOn: [],
            diffStat: { insertions: 2, deletions: 0 },
            report: "The order IDs are documented.",
            check: null,
            review: null,
            landedCommit: "orders-commit",
            landedAt: AT,
            delivered: false,
          }),
        ],
      },
      run: null,
      attention: [],
      devHosts: [],
      landedNotDelivered: 0,
      lastError: null,
    });
  }

  /** Only the transport drops; the conversation record remains the server's. */
  disconnect() {
    for (const socket of this.mate.subscriptions.keys()) socket.close(1012, "Source restarted");
  }

  claudeLoginFacts(phase: "signed-out" | "signing-in" | "ready") {
    const codex = this.auth().agents.find((agent) => agent.agentId === "codex")!;
    this.authSnapshot = decodeAuth({
      available: true,
      agents: [
        codex,
        {
          agentId: "claude-code",
          credPresent: phase === "ready",
          flagOAuth: phase === "ready",
          flagToken: false,
          providerAuth: phase === "ready" ? "authenticated" : "unauthenticated",
          state: phase === "ready" ? "authorized" : "not-authorized",
          ...(phase === "ready" ? { authorizedBy: { subject: "owner" } } : {}),
          ...(phase === "signing-in"
            ? {
                login: {
                  phase: "awaiting-browser",
                  terminalId: "login-claude",
                  startedAt: DateTime.makeUnsafe(AT),
                },
              }
            : {}),
        },
      ],
    });
    const codexProvider = this.mate.config.providers.find(
      (provider) => provider.driver === "codex",
    )!;
    this.providers(
      wireDecodeServerProviderUpdatedPayload({
        providers: [
          codexProvider,
          {
            instanceId: "claudeAgent",
            driver: "claudeAgent",
            enabled: true,
            installed: true,
            version: "2.1.0",
            status: "ready",
            auth: { status: phase === "ready" ? "authenticated" : "unauthenticated" },
            checkedAt: AT,
            requiresNewThreadForModelChange: true,
            setup: { canAuthenticate: true, canInstall: false },
            models: [
              {
                slug: "sonnet",
                name: "Claude Sonnet",
                isCustom: false,
                isDefault: true,
                capabilities: null,
              },
            ],
          },
        ],
      }).providers,
    );
    this.publishAuth();
  }

  async waitForLoginCancel() {
    if (this.cancelledLogins.length) return this.cancelledLogins.at(-1)!;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (this.cancelledLogins.length) resolve();
          };
          this.receipts.on("wire", listener);
        }),
        "Agent login cancellation",
      );
      return this.cancelledLogins.at(-1)!;
    } finally {
      this.receipts.off("wire", listener);
    }
  }

  async waitForCrewMessage() {
    return this.waitForCrewCommand("message");
  }

  async waitForCrewCommand(tag: CrewCommand["_tag"] = "message") {
    const found = () => this.crewCommands.findLast((command) => command._tag === tag);
    if (found()) return found()!;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (found()) resolve();
          };
          this.receipts.on("wire", listener);
        }),
        `Crew command ${tag}`,
        8000,
      );
      return found()!;
    } finally {
      this.receipts.off("wire", listener);
    }
  }

  effortCatalog() {
    this.providers(
      wireDecodeServerProviderUpdatedPayload({
        providers: [
          {
            ...this.mate.config.providers[0],
            models: [
              {
                slug: "gpt-5.4",
                name: "GPT-5.4",
                isCustom: false,
                isDefault: true,
                capabilities: {
                  optionDescriptors: [
                    {
                      id: "reasoningEffort",
                      label: "Reasoning effort",
                      type: "select",
                      options: [
                        { id: "medium", label: "Medium" },
                        { id: "high", label: "High" },
                        { id: "xhigh", label: "Extra High", isDefault: true },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      }).providers,
    );
  }

  async waitForCommand(type: OrchestrationCommand["type"], count = 1) {
    const found = () => this.commands.filter((command) => command.type === type);
    if (found().length >= count) return found().at(-1)!;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (found().length >= count) resolve();
          };
          this.receipts.on("wire", listener);
        }),
        `Mate command ${type}`,
        8000,
      );
      return found().at(-1)!;
    } finally {
      this.receipts.off("wire", listener);
    }
  }

  async replaySubscribed() {
    if (this.replay.size) return;
    let listener = () => {};
    try {
      await deadline(
        new Promise<void>((resolve) => {
          listener = () => {
            if (this.replay.size) resolve();
          };
          this.receipts.on("wire", listener);
        }),
        "Mate replay subscribed",
        8000,
      );
    } finally {
      this.receipts.off("wire", listener);
    }
  }

  replayEvents(events = this.mate.events) {
    for (const [socket, id] of this.replay)
      this.mate.chunk(
        socket,
        id,
        events.map((event) => encodeStream({ kind: "event", event })),
      );
  }

  ready() {
    this.holdReplay = false;
    for (const [socket, id] of this.replay)
      this.mate.chunk(socket, id, [encodeStream({ kind: "synchronized" })]);
    this.replay.clear();
  }

  snapshot(patch: Partial<OrchestrationThread> = {}) {
    const mate = this.mate;
    mate.thread = decodeThread({ ...mate.thread, ...patch });
    const snapshot = wireDecodeOrchestrationThreadDetailSnapshot({
      snapshotSequence: ++mate.sequence,
      thread: mate.thread,
    });
    for (const [socket, subscriptions] of mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (
          request.tag === ORCHESTRATION_WS_METHODS.subscribeThread &&
          request.payload.threadId === mate.thread.id
        )
          mate.chunk(socket, id, [encodeStream({ kind: "snapshot", snapshot })]);
    this.shell();
  }

  /** The endpoint replaces its authoritative thread collection, including the named primary. */
  threadCollection(primary: OrchestrationThread, others: ReadonlyArray<OrchestrationThread>) {
    this.mate.thread = decodeThread(primary);
    this.otherThreads.clear();
    for (const thread of others) this.otherThreads.set(String(thread.id), decodeThread(thread));
    this.mate.sequence += 1;
    const item = wireEncodeOrchestrationShellStreamItem({
      kind: "snapshot",
      snapshot: this.mate.shell(),
    });
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeShell)
          this.mate.chunk(socket, id, [item]);
  }

  shell() {
    const mate = this.mate;
    const thread = { ...mate.shellThread(), usagePause: this.usagePause };
    const item = wireDecodeOrchestrationShellStreamItem({
      kind: "thread-upserted",
      sequence: mate.sequence,
      thread,
    });
    for (const [socket, subscriptions] of mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === ORCHESTRATION_WS_METHODS.subscribeShell)
          mate.chunk(socket, id, [wireEncodeOrchestrationShellStreamItem(item)]);
  }

  event(
    type: OrchestrationEvent["type"],
    payload: Record<string, unknown>,
    commandId: string | null = null,
  ) {
    return this.v1.event(type, payload, commandId);
  }

  at() {
    return this.v1.at();
  }

  message(...args: Parameters<V1ChatWire["message"]>) {
    this.v1.message(...args);
  }

  run(
    turnId: string,
    state: "running" | "completed" | "error" | "interrupted",
    lastError: string | null = null,
    assistantMessageId: string | null = null,
  ) {
    if (this.wire !== this.v1) return this.wire.run(turnId, state);
    this.v1.live = true;
    const at = this.at();
    const previous =
      this.mate.thread.latestTurn?.turnId === turnId ? this.mate.thread.latestTurn : null;
    this.snapshot({
      latestTurn: {
        turnId,
        state,
        requestedAt: previous?.requestedAt ?? at,
        startedAt: previous?.startedAt ?? at,
        completedAt: state === "running" ? null : at,
        assistantMessageId,
      },
      session: {
        threadId: this.mate.thread.id,
        status: state === "completed" ? "ready" : state,
        providerName: "codex",
        providerInstanceId: "codex",
        runtimeMode: "full-access",
        activeTurnId: state === "running" ? turnId : null,
        lastError,
        updatedAt: at,
      },
    } as Partial<OrchestrationThread>);
  }

  tool(
    callId: string,
    kind: "tool.started" | "tool.updated" | "tool.completed",
    data: Record<string, unknown>,
    turnId = "run-one",
    extra: Record<string, unknown> = {},
  ) {
    // `summary` is the activity's own (V1's title for the call), never its payload's.
    const { summary, ...payload } = extra;
    this.activity(
      kind,
      String(summary ?? data.toolName ?? "Tool"),
      {
        toolCallId: callId,
        itemType: "command_execution",
        status: kind === "tool.completed" ? "completed" : "inProgress",
        data,
        ...payload,
      },
      turnId,
    );
  }

  publishLifecycle() {
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsLifecycle)
          this.mate.chunk(socket, id, [wireEncodeZeropsLifecycle(this.lifecycle)]);
  }

  publishAuth() {
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeZeropsAgentAuth)
          this.mate.chunk(socket, id, [encodeAuth(this.auth())]);
  }

  providers(providers: typeof this.mate.config.providers) {
    Object.assign(this.mate.config, { providers });
    const event: ServerConfigStreamEvent = {
      version: 1,
      type: "snapshot",
      config: this.mate.config,
    };
    for (const [socket, subscriptions] of this.mate.subscriptions)
      for (const [id, request] of subscriptions)
        if (request.tag === WS_METHODS.subscribeServerConfig)
          this.mate.chunk(socket, id, [wireEncodeServerConfigStreamEvent(event)]);
  }

  sentTurnCount() {
    return this.wire.intents().filter((intent) => intent.kind === "turn").length;
  }

  doorCount() {
    return this.http.filter((path) => path === "POST /mate/api/auth/zerops-throwaway").length;
  }

  commandDecisions() {
    return this.wire
      .intents()
      .flatMap((intent) =>
        intent.kind !== "decision"
          ? []
          : [
              intent.decision === "accept"
                ? "approved"
                : intent.decision === "decline"
                  ? "declined"
                  : intent.decision,
            ],
      );
  }

  /** The runtime modes the Mate applied, in order, on whichever wire it speaks. */
  accessModes() {
    return this.wire
      .intents()
      .flatMap((intent) => (intent.kind === "access" ? [intent.runtimeMode] : []));
  }

  /** Settles with the message the Mate received reading `text`, on whichever wire it speaks. */
  async waitForTurn(text: string) {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      return await deadline(
        new Promise<Extract<ChatIntent, { kind: "turn" }>>((resolve) => {
          const check = () => {
            const found = this.wire
              .intents()
              .findLast((intent) => intent.kind === "turn" && intent.text === text);
            if (found?.kind === "turn") resolve(found);
          };
          check();
          timer = setInterval(check, 25);
        }),
        `Mate received "${text}"`,
        8000,
      );
    } finally {
      clearInterval(timer);
    }
  }

  /** Settles with the answer the Mate applied to `requestId`, on whichever wire it speaks. */
  async waitForAnswer(requestId: string) {
    const applied = () =>
      this.wire
        .intents()
        .findLast((intent) => intent.kind === "answer" && intent.requestId === requestId);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      return await deadline(
        new Promise<Extract<ChatIntent, { kind: "answer" }>>((resolve) => {
          const check = () => {
            const found = applied();
            if (found?.kind === "answer") resolve(found);
          };
          check();
          timer = setInterval(check, 25);
        }),
        `Mate applied an answer to ${requestId}`,
        8000,
      );
    } finally {
      clearInterval(timer);
    }
  }

  receivedStagingAnswer() {
    return this.wire
      .intents()
      .some(
        (intent) =>
          intent.kind === "answer" &&
          intent.ask === "question" &&
          intent.answers.target === "stage",
      );
  }

  responseCount() {
    return this.wire
      .intents()
      .filter((intent) => intent.kind === "decision" || intent.kind === "answer").length;
  }

  /** A recorded login expires at its provider; ownership and conversation remain unchanged. */
  expireLogin() {
    this.authSnapshot = decodeAuth({
      available: true,
      agents: this.auth().agents.map((agent) => ({ ...agent, providerAuth: "unauthenticated" })),
    });
    this.providers(
      this.mate.config.providers.map((provider) => ({
        ...provider,
        auth: { status: "unauthenticated" },
      })),
    );
    this.publishAuth();
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
    if (this.authSnapshot) return this.authSnapshot;
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

  history(text = "The existing conversation is still here", turnId: string | null = null) {
    this.wire.history(text, turnId);
  }

  exchange(question: string, answer: string) {
    this.wire.exchange(question, answer);
  }

  skewClock(ms: number) {
    this.wire.skewClock(ms);
  }

  reply(turnId: string, text: string) {
    this.wire.reply(turnId, text);
  }

  approval() {
    this.wire.approval();
  }

  question(requestId = "question-target", turnId: string | null = null) {
    this.wire.question(requestId, turnId);
  }

  activity(...args: Parameters<V1ChatWire["activity"]>) {
    this.v1.activity(...args);
  }
}

declare module "vite-plus/test" {
  interface ProvidedContext {
    /** Which wire the area's Mates speak: V1 unless a project says the engine's. */
    mateWire?: "v1" | "engine";
  }
}

const chats = new WeakMap<MateFake, ChatDriver>();
const installChat =
  (wire: () => "v1" | "engine" | undefined): ScenarioExtension =>
  (drivers) => {
    drivers.onMate.push((mate) => {
      if (wire() !== "engine") return void chats.set(mate, new ChatDriver(mate));
      const engine = new EngineChatWire(mate);
      chats.set(mate, new ChatDriver(mate, engine));
      engine.install();
    });
  };
export const installArea: ScenarioExtension = installChat(() => inject("mateWire"));
/** The area with its Mates on the engine's wire, whichever project the journey runs in. */
export const installEngineArea: ScenarioExtension = installChat(() => "engine");
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

/** HQ records the birth ask and zcp enrolls the container, through their public endpoints. */
export const standUpBirth = Effect.fn(function* (drivers: ScenarioDrivers, name: string) {
  const created = yield* drivers.core.call("POST", "/api/mates", {
    session: drivers.owner,
    body: { projectId: name, face: "face-1", standUp: true },
  });
  if (created.status !== 201)
    return yield* Effect.die(new Error(`Birth refused: ${created.status}`));
  const credential = yield* enrollMate(drivers.core.call, drivers.core.fake, name);
  const response = yield* drivers.core.call("POST", "/api/mate/link-ticket", {
    headers: { authorization: `Mate ${credential}` },
  });
  const { ticket } = response.body as { ticket: string };
  const link = yield* drivers.core.socket(`/api/mate/link?ticket=${ticket}`);
  drivers.links.set(name, link);
  yield* link.next("state");
  yield* reportConversation(drivers, name, {
    latestUserMessageAt: null,
    latestUserMessagePreview: null,
  });
});

/** A platform search/realtime row: key and redaction, never a client vault projection. */
export function vaultKey(drivers: ScenarioDrivers, key: string, at: string) {
  const project = drivers.zerops.rows("project").find((row) => row.id === "Ada")!;
  const rows = Array.isArray(project.envList) ? project.envList : [];
  drivers.zerops.put("project", {
    ...project,
    envList: [
      ...rows.filter((row) => row.key !== key),
      {
        id: `vault-${key}`,
        clientId: "ORG",
        projectId: "Ada",
        key,
        content: "<redacted>",
        type: "USER",
        editable: true,
        sensitive: true,
        internal: false,
        created: at,
        lastUpdate: at,
      },
    ],
  });
}

/** The platform accepts/refuses the person's env write; only accepted writes publish a row. */
export function vaultWrites(drivers: ScenarioDrivers) {
  const writes: Array<{ key: string; content: string }> = [];
  const control = { refuse: false, writes };
  drivers.zerops.handlers.push((request) => {
    if (request.method !== "POST" || !request.url.pathname.endsWith("/project/Ada/env")) return;
    if (control.refuse)
      return {
        status: 403,
        body: { code: "insufficientPermissions", message: "This vault is read-only" },
      };
    const key = String(request.body.key);
    writes.push({ key, content: String(request.body.content) });
    vaultKey(drivers, key, "2026-10-07T12:00:00.000Z");
    return { body: {} };
  });
  return control;
}

/** A platform lifecycle answer for this scenario's container; no provider outcome is inferred. */
export function reportContainer(
  drivers: ScenarioDrivers,
  name: string,
  status: string,
  failedRestart = false,
) {
  const service = drivers.zerops.entities.get("service-stack")?.get(`service-${name}`);
  if (!service) throw new Error(`No container for ${name}`);
  if (failedRestart)
    drivers.zerops.put("process", {
      id: `restart-${name}`,
      projectId: name,
      clientId: "ORG",
      serviceStackId: service.id,
      actionName: "stack.restart",
      status: "FAILED",
      created: "2026-10-07T20:00:00Z",
      started: "2026-10-07T20:00:00Z",
      finished: "2026-10-07T20:00:02Z",
      publicMeta: { failReason: "CommandExec: init command failed (exit 23)" },
    });
  drivers.zerops.put("service-stack", { ...service, status });
}

/** Changes only this person's project grant and publishes the platform's filtered membership. */
export function projectGrant(drivers: ScenarioDrivers, name: string, allowed: boolean) {
  const project = drivers.zerops.entities.get("project")?.get(name);
  if (!project) throw new Error(`No project ${name}`);
  definePerson(drivers.zerops.world, "owner", {
    role: "NO_ACCESS",
    grants: allowed ? { [name]: "BASIC_USER" } : {},
  });
  drivers.zerops.put("project", {
    ...project,
    userRoles: projectRoles(drivers.zerops.world, name),
  });
}

export function deleteProjectEvidence(drivers: ScenarioDrivers, name: string) {
  drivers.zerops.remove("project", name);
}
