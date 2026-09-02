import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs,
  arch: ExecutionEnvironmentPlatformArch,
});

/**
 * Where a new thread runs: the project's current checkout ("local") or a
 * fresh git worktree ("worktree"). Lives here (not settings.ts) so
 * orchestration contracts can reference it without an import cycle.
 */
export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

/** Legacy server-update methods remain decodable for older wire peers. */
export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "respawn"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  repositoryIdentity: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  connectionProbe: Schema.optionalKey(Schema.Boolean),
  /** Missing on older servers, which still accept inline image attachments. */
  attachmentUploads: Schema.optionalKey(Schema.Boolean),
  /** Missing on servers that only accept image attachments. */
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** Server accepts the stacked commit/push/PR action. Absent on servers from
      before the capability existed, which all accept it, so only an explicit
      false hides the control. */
  vcsStackedActions: Schema.optionalKey(Schema.Boolean),
  /** Server accepts worktree-backed threads. Absent on older servers, which
      allow worktrees, so only an explicit false from a Zerops server hides
      the client option; the server-side policy remains the enforcement. */
  worktreesAllowed: Schema.optionalKey(Schema.Boolean),
  /** Server understands thread.settle / thread.unsettle commands. Absent on
      pre-settlement servers, so clients treat missing as unsupported and
      never send the commands under version skew. */
  threadSettlement: Schema.optionalKey(Schema.Boolean),
  /** Server understands thread.snooze / thread.unsnooze commands. Same
      version-skew contract as threadSettlement. */
  threadSnooze: Schema.optionalKey(Schema.Boolean),
  /** Server understands thread.pin / thread.unpin commands. Same
      version-skew contract as threadSettlement. */
  threadPinning: Schema.optionalKey(Schema.Boolean),
  /** Server understands thread.pin.reorder (and orderKey on thread.pin).
      Same version-skew contract as threadSettlement. */
  threadPinReorder: Schema.optionalKey(Schema.Boolean),
  /** Server understands regenerateTitle on thread.meta.update. Absent on
      older servers, so clients hide the action instead of sending it. */
  threadTitleRegeneration: Schema.optionalKey(Schema.Boolean),
  /** Server persists a pull request reference on thread.meta.update. */
  threadPullRequestLinking: Schema.optionalKey(Schema.Boolean),
  /** Agent-activity publishes (push notifications and Live Activities)
      currently leave this environment: the publish opt-in is enabled and the
      relay link credentials exist. Clients skip seeding a Live Activity when
      this is false — no update would ever repaint it. Absent on older
      servers, which may still publish, so only an explicit false skips. */
  agentActivityPublishing: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  capabilities: ExecutionEnvironmentCapabilities,
  /** The public path prefix this server is published under (`/mate`), absent at
      an origin root and on older servers. A client that loaded the app from a
      different prefix is talking to a server that answers but is not the one it
      thinks — the SPA catch-all makes that silent, so the prefix is stated. */
  basePath: Schema.optionalKey(Schema.String),
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const EnvironmentConnectionState = Schema.Literals([
  "connecting",
  "connected",
  "disconnected",
  "error",
]);
export type EnvironmentConnectionState = typeof EnvironmentConnectionState.Type;

export const RepositoryIdentityLocator = Schema.Struct({
  source: Schema.Literal("git-remote"),
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type RepositoryIdentityLocator = typeof RepositoryIdentityLocator.Type;

export const RepositoryIdentity = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  locator: RepositoryIdentityLocator,
  rootPath: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  owner: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

export const ScopedProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type ScopedProjectRef = typeof ScopedProjectRef.Type;

export const ScopedThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadRef = typeof ScopedThreadRef.Type;

export const ScopedThreadSessionRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadSessionRef = typeof ScopedThreadSessionRef.Type;
