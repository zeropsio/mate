import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  type AntigravitySettings,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderAuthStatus,
  type ServerProviderModel,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { compareSemverVersions } from "@t3tools/shared/semver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcess } from "effect/process";
import type * as EffectAcpSchema from "effect-acp/compat";

import type { AcpSessionRuntimeStartResult } from "../acp/AcpSessionRuntime.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const EMPTY_MODEL_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const MAX_WORKSPACE_SNAPSHOTS = 32;
/** The first agy with `agy acp`. */
const MINIMUM_AGY_VERSION = "1.5.0";
const VERSION_PROBE_TIMEOUT = "10 seconds";
/** `agy models` asks Google before it answers. */
const AUTH_PROBE_TIMEOUT = "30 seconds";
const MISSING_MESSAGE = "Antigravity (`agy`) is not installed or not on PATH.";
const SIGN_IN_MESSAGE = "Sign in with Google to use Antigravity.";
const AUTH_UNCHECKED_MESSAGE =
  "Antigravity is installed. Google account access is not checked yet.";
const GOOGLE_ACCOUNT = {
  status: "authenticated",
  type: "oauth-personal",
  label: "Google account",
} satisfies ServerProviderAuth;

/** What `agy --version` and `agy models` say about the agy this instance runs. */
export type AntigravityCliStatus =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unusable"; readonly version: string | null; readonly message: string }
  | {
      readonly _tag: "Installed";
      readonly version: string;
      readonly auth: ServerProviderAuthStatus;
    };

/**
 * `agy models`' answer about the Google login. Signed out it prints "Error: Please sign in to view
 * available models." and exits 1 (measured, agy 1.5.13); signed in it lists the account's models
 * after "Fetching available models...". Anything else is no answer.
 */
export function parseAgyModelsAuth(output: string, code: number | null): ServerProviderAuthStatus {
  if (/please\s+sign\s+in/i.test(output)) return "unauthenticated";
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^fetching\s+available\s+models/i.test(line));
  return code !== 0 || lines.length === 0 || lines.some((line) => /^error\b/i.test(line))
    ? "unknown"
    : "authenticated";
}

const runAgy = (binaryPath: string, args: ReadonlyArray<string>, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const command = binaryPath || "agy";
    const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

/** Installed means agy runs and is new enough for `agy acp`; neither command starts the agent. */
export const probeAntigravityCli = Effect.fn("probeAntigravityCli")(function* (
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
) {
  const versionResult = yield* runAgy(binaryPath, ["--version"], environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT),
    Effect.result,
  );
  if (Result.isFailure(versionResult)) {
    return isCommandMissingCause(versionResult.failure)
      ? ({ _tag: "Missing" } satisfies AntigravityCliStatus)
      : ({
          _tag: "Unusable",
          version: null,
          message: "Antigravity could not run `agy --version`.",
        } satisfies AntigravityCliStatus);
  }
  if (Option.isNone(versionResult.success)) {
    return {
      _tag: "Unusable",
      version: null,
      message: `Antigravity did not answer \`agy --version\` within ${VERSION_PROBE_TIMEOUT}.`,
    } satisfies AntigravityCliStatus;
  }
  const output = versionResult.success.value;
  const version = parseGenericCliVersion(`${output.stdout}\n${output.stderr}`);
  if (output.code !== 0 || version === null) {
    return {
      _tag: "Unusable",
      version,
      message: "Antigravity could not run `agy --version`.",
    } satisfies AntigravityCliStatus;
  }
  if (compareSemverVersions(version, MINIMUM_AGY_VERSION) < 0) {
    return {
      _tag: "Unusable",
      version,
      message: `Antigravity needs agy ${MINIMUM_AGY_VERSION} or newer (found ${version}). Run \`agy update\` on this environment.`,
    } satisfies AntigravityCliStatus;
  }
  const models = yield* runAgy(binaryPath, ["models"], environment).pipe(
    Effect.timeoutOption(AUTH_PROBE_TIMEOUT),
    Effect.orElseSucceed(() => Option.none()),
  );
  return {
    _tag: "Installed",
    version,
    auth: Option.match(models, {
      onNone: (): ServerProviderAuthStatus => "unknown",
      onSome: (result) => parseAgyModelsAuth(`${result.stdout}\n${result.stderr}`, result.code),
    }),
  } satisfies AntigravityCliStatus;
});

type SessionSetupResult = Pick<
  AcpSessionRuntimeStartResult["sessionSetupResult"],
  "configOptions" | "models"
>;

/** Keep the native model IDs, including model-specific thinking levels. */
export function buildAntigravityModelsFromSession(
  setup: SessionSetupResult,
): ReadonlyArray<ServerProviderModel> {
  const config = setup.configOptions?.find(
    (option) => option.id === "model" || option.category === "model",
  );
  const currentValue =
    config?.type === "select" ? config.currentValue : setup.models?.currentModelId;
  const entries =
    config?.type === "select"
      ? config.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options))
      : config === undefined
        ? (setup.models?.availableModels.map((model) => ({
            value: model.modelId,
            name: model.name,
          })) ?? [])
        : [];
  const seen = new Set<string>();
  return entries.flatMap((entry): ServerProviderModel[] => {
    if (!entry.value.trim() || seen.has(entry.value)) return [];
    seen.add(entry.value);
    return [
      {
        slug: entry.value,
        name: entry.name.trim() ? entry.name : entry.value,
        isCustom: false,
        ...(entry.value === currentValue
          ? { isDefault: true, aliases: [ANTIGRAVITY_DEFAULT_MODEL] }
          : {}),
        capabilities: EMPTY_MODEL_CAPABILITIES,
      },
    ];
  });
}

function nativeCommands(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const seen = new Set<string>();
  return commands.flatMap((command): ServerProviderSlashCommand[] => {
    if (!command.name.trim() || seen.has(command.name)) return [];
    seen.add(command.name);
    const description = command.description.trim();
    const hint = command.input?.hint.trim();
    return [
      {
        name: command.name,
        ...(description ? { description } : {}),
        ...(hint ? { input: { hint } } : {}),
      },
    ];
  });
}

interface AntigravityProviderState {
  readonly draft: ServerProviderDraft;
  readonly authRevision: number;
}

interface AntigravityProviderOptions {
  readonly stampIdentity: (snapshot: ServerProviderDraft) => Effect.Effect<ServerProvider>;
  readonly probe: Effect.Effect<AntigravityCliStatus>;
  /**
   * Reads the account's models from a session of its own and publishes them through
   * `onSessionStarted`, or `onAuthRequired` when agy has no login.
   */
  readonly fetchCatalog: Effect.Effect<void>;
  readonly maintenanceCapabilities?: ProviderMaintenanceCapabilities;
}

/** What only a running, signed-in agy has: its account's models, commands and workspaces. */
const NO_ACCOUNT_METADATA = {
  models: [],
  slashCommands: [],
  skills: [],
  workspaceSnapshots: [],
  supportsTextGeneration: false,
} satisfies Partial<ServerProviderDraft>;

/**
 * The health check runs `agy --version` and `agy models`; it starts a session, to read the
 * account's models, only once agy may be signed in and no models are known.
 */
export const makeAntigravityProvider = Effect.fn("makeAntigravityProvider")(function* (
  settings: AntigravitySettings,
  options: AntigravityProviderOptions,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const initialDraft = {
    ...buildServerProvider({
      presentation: { displayName: "Antigravity", showInteractionModeToggle: false },
      enabled: settings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "Checking Antigravity availability."
          : "Antigravity is disabled in settings.",
      },
    }),
    supportsConversationRollback: false,
    supportsTextGeneration: false,
    workspaceSnapshots: [],
  } satisfies ServerProviderDraft;
  const metadata = yield* SubscriptionRef.make<AntigravityProviderState>({
    draft: initialDraft,
    authRevision: 0,
  });
  // Skills the driver discovered on disk per workspace. Session callbacks
  // rewrite the workspace entry with native commands and must keep these, or
  // the registry drops the suggestions and never re-reads the workspace.
  const discoveredSkills = new Map<string, ServerProvider["skills"]>();
  const getSnapshot = SubscriptionRef.get(metadata).pipe(
    Effect.flatMap((state) => options.stampIdentity(state.draft)),
  );

  const checkProvider = Effect.fn("checkAntigravityProvider")(function* () {
    if (!settings.enabled) return yield* getSnapshot;
    const before = yield* SubscriptionRef.get(metadata);
    const cli = yield* options.probe;
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    let applied = false;
    const next = yield* SubscriptionRef.updateAndGet(metadata, (state) => {
      if (state.authRevision !== before.authRevision) return state;
      applied = true;
      const { message: _previousMessage, ...draft } = state.draft;
      if (cli._tag !== "Installed") {
        const missing = cli._tag === "Missing";
        return {
          ...state,
          draft: {
            ...draft,
            ...(missing ? NO_ACCOUNT_METADATA : {}),
            installed: !missing,
            version: missing ? null : (cli.version ?? draft.version),
            status: "error",
            checkedAt: updatedAt,
            message: missing ? MISSING_MESSAGE : cli.message,
          },
        } satisfies AntigravityProviderState;
      }
      // `agy models` decides when it answers; otherwise the last session's answer stands.
      const signedOut = cli.auth === "unauthenticated";
      const signedIn =
        cli.auth === "authenticated" || (!signedOut && draft.auth.status === "authenticated");
      return {
        authRevision:
          cli.auth !== "unknown" && cli.auth !== draft.auth.status
            ? state.authRevision + 1
            : state.authRevision,
        draft: {
          ...draft,
          ...(signedOut ? { ...NO_ACCOUNT_METADATA, auth: { status: "unauthenticated" } } : {}),
          ...(cli.auth === "authenticated" ? { auth: GOOGLE_ACCOUNT } : {}),
          installed: true,
          version: cli.version,
          status: signedIn ? "ready" : "warning",
          checkedAt: updatedAt,
          supportsTextGeneration: signedIn,
          ...(signedIn
            ? {}
            : {
                message:
                  signedOut || draft.auth.status === "unauthenticated"
                    ? SIGN_IN_MESSAGE
                    : AUTH_UNCHECKED_MESSAGE,
              }),
        },
      } satisfies AntigravityProviderState;
    });
    if (!applied || cli._tag !== "Installed") return yield* getSnapshot;
    if (cli.auth === "unauthenticated") discoveredSkills.clear();
    else if (next.draft.models.length === 0) yield* options.fetchCatalog;
    return yield* getSnapshot;
  });

  const maintenanceCapabilities =
    options.maintenanceCapabilities ??
    makeManualOnlyProviderMaintenanceCapabilities({
      provider: ProviderDriverKind.make("antigravity"),
      packageName: null,
    });
  const managed = yield* makeManagedServerProvider({
    resolveMaintenance: () => Effect.succeed(maintenanceCapabilities),
    getSettings: Effect.succeed(settings),
    streamSettings: Stream.empty,
    haveSettingsChanged: () => false,
    initialSnapshot: () => getSnapshot,
    checkProvider: checkProvider(),
    enrichSnapshot: ({ publishSnapshot }) =>
      SubscriptionRef.changes(metadata).pipe(
        Stream.runForEach((state) =>
          options.stampIdentity(state.draft).pipe(Effect.flatMap(publishSnapshot)),
        ),
      ),
  });

  const onSessionStarted = Effect.fn("AntigravityProvider.onSessionStarted")(function* (
    started: AcpSessionRuntimeStartResult,
    cwd?: string,
  ) {
    const before = yield* SubscriptionRef.get(metadata);
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* SubscriptionRef.update(metadata, (state) => {
      if (
        state.authRevision !== before.authRevision &&
        state.draft.auth.status === "unauthenticated"
      ) {
        return state;
      }
      const { message: _previousMessage, ...draft } = state.draft;
      const workspaces = draft.workspaceSnapshots ?? [];
      const workspace = cwd ? workspaces.find((entry) => entry.cwd === cwd) : undefined;
      return {
        authRevision: state.authRevision + 1,
        draft: {
          ...draft,
          installed: true,
          status: settings.enabled ? "ready" : "disabled",
          auth: GOOGLE_ACCOUNT,
          checkedAt: updatedAt,
          models: buildAntigravityModelsFromSession(started.sessionSetupResult),
          supportsTextGeneration: true,
          ...(cwd
            ? {
                workspaceSnapshots: [
                  ...workspaces.filter((entry) => entry.cwd !== cwd),
                  {
                    cwd,
                    checkedAt: updatedAt,
                    slashCommands: workspace?.slashCommands ?? draft.slashCommands,
                    skills: workspace?.skills ?? discoveredSkills.get(cwd) ?? [],
                  },
                ].slice(-MAX_WORKSPACE_SNAPSHOTS),
              }
            : {}),
        },
      } satisfies AntigravityProviderState;
    });
  });

  const onConfigOptionsUpdated = Effect.fn("AntigravityProvider.onConfigOptionsUpdated")(function* (
    configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  ) {
    const models = buildAntigravityModelsFromSession({ configOptions });
    yield* SubscriptionRef.update(metadata, (state) => {
      if (state.draft.auth.status !== "authenticated") return state;
      return { ...state, draft: { ...state.draft, models } };
    });
  });

  const onAvailableCommands = Effect.fn("AntigravityProvider.onAvailableCommands")(function* (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd?: string,
  ) {
    const slashCommands = nativeCommands(commands);
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* SubscriptionRef.update(metadata, (state) => {
      if (state.draft.auth.status === "unauthenticated") return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          slashCommands,
          ...(cwd
            ? {
                workspaceSnapshots: [
                  ...(state.draft.workspaceSnapshots ?? []).filter((entry) => entry.cwd !== cwd),
                  {
                    cwd,
                    checkedAt: updatedAt,
                    slashCommands,
                    skills:
                      state.draft.workspaceSnapshots?.find((entry) => entry.cwd === cwd)?.skills ??
                      discoveredSkills.get(cwd) ??
                      [],
                  },
                ].slice(-MAX_WORKSPACE_SNAPSHOTS),
              }
            : {}),
        },
      };
    });
  });

  const clearAccountMetadata = Effect.fn("AntigravityProvider.clearAccountMetadata")(function* () {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* SubscriptionRef.update(
      metadata,
      (state) =>
        ({
          authRevision: state.authRevision + 1,
          draft: {
            ...state.draft,
            ...NO_ACCOUNT_METADATA,
            auth: { status: "unauthenticated" },
            status: settings.enabled ? "warning" : "disabled",
            message: SIGN_IN_MESSAGE,
            checkedAt: updatedAt,
          },
        }) satisfies AntigravityProviderState,
    );
    discoveredSkills.clear();
  });

  const snapshotForCwd = Effect.fn("AntigravityProvider.snapshotForCwd")(function* (
    cwd: string,
    skills?: ServerProvider["skills"],
  ) {
    if (skills) {
      discoveredSkills.set(cwd, skills);
      // A rescan replaces the stored entry's skills. Session callbacks and
      // health checks republish that entry, so it must not keep old ones.
      yield* SubscriptionRef.update(metadata, (state) =>
        state.draft.workspaceSnapshots?.some((entry) => entry.cwd === cwd)
          ? {
              ...state,
              draft: {
                ...state.draft,
                workspaceSnapshots: state.draft.workspaceSnapshots.map((entry) =>
                  entry.cwd === cwd ? { ...entry, skills } : entry,
                ),
              },
            }
          : state,
      );
    }
    const snapshot = yield* getSnapshot;
    const workspace = snapshot.workspaceSnapshots?.find((entry) => entry.cwd === cwd);
    const resolvedSkills = skills ?? workspace?.skills ?? discoveredSkills.get(cwd) ?? [];
    return workspace
      ? { ...snapshot, slashCommands: workspace.slashCommands, skills: resolvedSkills }
      : { ...snapshot, skills: resolvedSkills };
  });

  return {
    snapshot: { ...managed, getSnapshot },
    onSessionStarted,
    onConfigOptionsUpdated,
    onAvailableCommands,
    onSignedOut: clearAccountMetadata(),
    onAuthRequired: clearAccountMetadata(),
    snapshotForCwd,
  };
});
