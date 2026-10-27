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

/**
 * How a new worktree populates git submodules: every nested level, only the
 * ones this repository declares, or not at all.
 */
export const WorktreeSubmodules = Schema.Literals(["recursive", "top-level", "none"]);
export type WorktreeSubmodules = typeof WorktreeSubmodules.Type;
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

/** Legacy server-update methods remain decodable for older wire peers. */
export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "respawn"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

/** The Mate engine's wire protocol this build speaks (`capabilities.mateEngine`). */
export const MATE_ENGINE_PROTOCOL = 1;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  accountLifecycleVersion: Schema.optionalKey(Schema.Literal(1)),
  repositoryIdentity: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** The conversation runs on the Mate engine, speaking this protocol.
      Absent: the orchestration (V1) wire owns the conversation. */
  mateEngine: Schema.optionalKey(Schema.Struct({ protocol: Schema.Int })),
  connectionProbe: Schema.optionalKey(Schema.Boolean),
  /** Missing on older servers, which still accept inline image attachments. */
  attachmentUploads: Schema.optionalKey(Schema.Boolean),
  contentAddressedImages: Schema.optionalKey(Schema.Boolean),
  /** Uploaded files may accompany question answers. */
  questionAttachments: Schema.optionalKey(Schema.Boolean),
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
  /** Server streams quota from configured usage-limit sources. Absent on
      servers from before usage limits shipped, which never emit the events --
      so a client reconnecting to one must drop reported quota rather than
      keep showing a set nothing will ever update. */
  usageLimitSources: Schema.optionalKey(Schema.Boolean),
  /** Server persists custom model rates and applies them to usage summaries. */
  usagePriceOverrides: Schema.optionalKey(Schema.Boolean),
  /** Server persists model mappings and folds mapped usage into the target model. */
  usageModelAliases: Schema.optionalKey(Schema.Boolean),
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
  /** `zerops.mate.update` is offered (spec-mate.md §2.9 MU-2): inside a
      Zerops project with `zcp` on PATH. Absent everywhere else, so a client
      renders the Update verb only where the RPC would actually work. */
  mateUpdate: Schema.optionalKey(Schema.Boolean),
  /** `zerops.mate.checkUpdate` is offered (spec-mate.md §2.9 step 5). Absent
      on servers from before the on-demand check existed, which still offer
      `mateUpdate`; a client never sends the check without this flag. */
  mateUpdateCheck: Schema.optionalKey(Schema.Boolean),
  /** Server hosts the Zerops data console and understands
      `zerops.dataConsole.call`. Absent on older servers, so clients never
      send the call and offer the Data surface as unsupported under version
      skew. */
  dataConsole: Schema.optionalKey(Schema.Boolean),
  /** Server understands `zerops.agentLogin.submitCode`, so the sign-in dialog
      takes Claude's code in a field. Absent on older servers, where the code
      is pasted into the login terminal instead. */
  agentLoginCode: Schema.optionalKey(Schema.Boolean),
  /** Server runs repository clones for new projects in the background and
      streams their progress (`projectClone.*`, `subscribeProjectClones`).
      Absent on older servers, where clients must clone with the blocking
      `sourceControl.cloneRepository` call instead. */
  projectCloneTracking: Schema.optionalKey(Schema.Boolean),
  /** Server understands `zerops.agentLogin.signOut`: inside a Zerops project,
      any client can sign an agent out (cancel its login session, stop its
      live provider sessions, run the CLI's own logout, clear the platform
      flag). Absent everywhere else, so a client offers the action only
      where the RPC would actually work. */
  agentSignOut: Schema.optionalKey(Schema.Boolean),
  /** Server keeps more than the two default logins (crew mode's *Runs on*):
      it lists every login on the agent-auth feed, understands
      `zerops.login.add`/`zerops.login.remove` and a `loginId` on the agent
      login RPCs. Absent on older servers, so a client offers *Add another
      login* only where it would work. */
  mateLogins: Schema.optionalKey(Schema.Boolean),
  /** Server understands `zerops.crew.propose`: the crew setup asks the Mate's agent for a crew
      from the goal. Absent on older servers, so a client says the Mate proposes after its update
      instead of sending a call it would not know. */
  crewProposals: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

/**
 * Whether the Mate's own key currently proves anyone's identity, as of the
 * last own-project read the door or the membership watch actually made
 * (never a probe the descriptor triggers on its own). `"unknown"` before
 * either has run once — briefly at boot, or on a server too old to report
 * this at all (the whole field is optional for exactly that reason).
 */
export const ExecutionEnvironmentZeropsIdentity = Schema.Literals(["unknown", "ok", "failed"]);
export type ExecutionEnvironmentZeropsIdentity = typeof ExecutionEnvironmentZeropsIdentity.Type;

/** Which of the two places the key that read answered with came from. */
export const ExecutionEnvironmentZeropsKeySource = Schema.Literals(["store", "snapshot"]);
export type ExecutionEnvironmentZeropsKeySource = typeof ExecutionEnvironmentZeropsKeySource.Type;

/**
 * The Zerops project this container belongs to — a fact the env contract
 * already owns (`T3CODE_ZEROPS_PROJECT_ID`, spec-mate.md §2.3) and states
 * non-secretly here. Present only in Zerops mode; absent everywhere else,
 * including on a server too old to have this field at all.
 */
export const ExecutionEnvironmentZerops = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  /** See {@link ExecutionEnvironmentZeropsIdentity}. Never the key itself. */
  identity: Schema.optionalKey(ExecutionEnvironmentZeropsIdentity),
  /** ISO instant of the read {@link identity} reports. Absent before the first one. */
  identityCheckedAt: Schema.optionalKey(TrimmedNonEmptyString),
  /** See {@link ExecutionEnvironmentZeropsKeySource}. Absent before the first read. */
  keySource: Schema.optionalKey(ExecutionEnvironmentZeropsKeySource),
  /** ISO instant this container's env was last captured for that read — today
      the same instant as {@link identityCheckedAt}, since both come off the
      one own-project read; a distinct capture step would diverge them later. */
  envCapturedAt: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ExecutionEnvironmentZerops = typeof ExecutionEnvironmentZerops.Type;

/**
 * What `zcp mate status` last answered, relayed through the descriptor
 * (spec-mate.md §2.9): the one reader of "is there a newer Mate" in the
 * whole product. Absent, never fabricated, when `zcp` cannot be run (MU-3)
 * — a standalone server or one outside a Zerops project.
 */
/** The container's zcp as zcp reads itself (`zcp mate status --json`'s `zcp`). */
export const ExecutionEnvironmentZcp = Schema.Struct({
  installed: TrimmedNonEmptyString,
  /** Empty when zcp has no release evidence. */
  latest: Schema.String,
  behind: Schema.Boolean,
});

export const ExecutionEnvironmentUpdate = Schema.Struct({
  installed: TrimmedNonEmptyString,
  /** Empty when zcp has no manifest evidence; availability is unknown. */
  latest: Schema.String,
  available: Schema.Boolean,
  checkedAt: TrimmedNonEmptyString,
  automatic: Schema.optionalKey(
    Schema.Struct({
      protocol: Schema.Literal(1),
      rollbackCompatible: Schema.Boolean,
      phase: Schema.Literals([
        "idle",
        "staging",
        "draining",
        "switching",
        "verifying",
        "updated",
        "postponed",
        "failed",
      ]),
      runningVersion: TrimmedNonEmptyString,
      failedVersion: Schema.optionalKey(TrimmedNonEmptyString),
    }),
  ),
  /** The container's zcp, as zcp reads itself; absent when zcp does not say (an older zcp). */
  zcp: Schema.optionalKey(ExecutionEnvironmentZcp),
  /**
   * Only a container restart gets this Mate current (zcp behind, or a mate without updater
   * protocol 1): its Update restarts the container once the Mate is idle. `phase` is that
   * restart's progress, recorded by the server; absent while none was asked for.
   */
  restart: Schema.optionalKey(
    Schema.Struct({
      needed: Schema.Boolean,
      /** zcp's one line saying why. */
      why: Schema.optionalKey(Schema.String),
      phase: Schema.optionalKey(Schema.Literals(["draining", "restarting", "postponed"])),
      /** Why a postponed restart did not happen, in zcp's words or the server's. */
      reason: Schema.optionalKey(Schema.String),
      /** Which restart the phase is about: a press settles on its own attempt, never an older one. */
      attempt: Schema.optionalKey(Schema.String),
      /** When that restart was asked for, by the server's clock (ISO 8601). */
      startedAt: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type ExecutionEnvironmentUpdate = typeof ExecutionEnvironmentUpdate.Type;

export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  /** This server process, a new value at every start: the same version on another boot is a
      restart that kept it, so a client can tell an update that did not take from a server not
      restarted yet. Absent from older servers. */
  bootId: Schema.optionalKey(TrimmedNonEmptyString),
  capabilities: ExecutionEnvironmentCapabilities,
  /** The public path prefix this server is published under (`/mate`), absent at
      an origin root and on older servers. A client that loaded the app from a
      different prefix is talking to a server that answers but is not the one it
      thinks — the SPA catch-all makes that silent, so the prefix is stated. */
  basePath: Schema.optionalKey(Schema.String),
  /** See {@link ExecutionEnvironmentZerops}. */
  zerops: Schema.optionalKey(ExecutionEnvironmentZerops),
  /** See {@link ExecutionEnvironmentUpdate}. */
  update: Schema.optionalKey(ExecutionEnvironmentUpdate),
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const RepositoryIdentityLocator = Schema.Struct({
  source: Schema.Literal("git-remote"),
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type RepositoryIdentityLocator = typeof RepositoryIdentityLocator.Type;

/**
 * The checkout's own remote when it names a different repository than the canonical one, such as
 * a fork that tracks its upstream. Clients group and label by it so a fork stays distinct from the
 * repository it forked, while pull request features keep the canonical identity.
 */
export const RepositoryOrigin = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RepositoryOrigin = typeof RepositoryOrigin.Type;

export const RepositoryIdentity = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  locator: RepositoryIdentityLocator,
  /** Repository browser URL resolved from the server's configured hosting account. */
  webUrl: Schema.optionalKey(TrimmedNonEmptyString),
  rootPath: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  owner: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString),
  origin: Schema.optionalKey(RepositoryOrigin),
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

/** Key clients group checkouts by: a fork's own remote, otherwise the canonical repository. */
export function repositoryGroupingKeyOf(identity: RepositoryIdentity): string {
  return identity.origin?.canonicalKey ?? identity.canonicalKey;
}

/** Label clients show for a checkout's repository, matching `repositoryGroupingKeyOf`. */
export function repositoryGroupingDisplayNameOf(identity: RepositoryIdentity): string | undefined {
  return identity.origin
    ? (identity.origin.displayName ?? identity.origin.canonicalKey)
    : identity.displayName;
}

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
