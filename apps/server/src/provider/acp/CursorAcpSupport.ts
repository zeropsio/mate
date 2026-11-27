import {
  type CursorSettings,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import {
  CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
  resolveCursorAcpBaseModelId,
  resolveCursorAcpConfigUpdates,
} from "../Layers/CursorProvider.ts";
import type { AcpSessionMode, AcpSessionModeState } from "./AcpRuntimeModel.ts";
import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type CursorAcpRuntimeCursorSettings = Pick<CursorSettings, "apiEndpoint" | "binaryPath">;

function cursorAcpPermissionArgs(runtimeMode?: RuntimeMode): ReadonlyArray<string> {
  switch (runtimeMode) {
    case "auto":
      return ["--auto-review"];
    case "full-access":
      return ["--force"];
    default:
      return [];
  }
}

export interface CursorAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
  /** A profiled thread's own Cursor folder ({@link buildCursorAcpSpawnInput}). */
  readonly ownSettings?: string;
}

export interface CursorAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-config-option" | "set-model";
  readonly configId?: string;
}

/** Every entry beside the way down from `/` to `root`, as absolute paths. */
const besideTheWayDown = <E>(
  root: string,
  entriesOf: (directory: string) => Effect.Effect<ReadonlyArray<string>, E>,
) => {
  const segments = root.split("/").filter((segment) => segment !== "");
  return Effect.map(
    Effect.forEach(segments, (kept, depth) => {
      const directory = `/${segments.slice(0, depth).join("/")}`;
      return Effect.map(entriesOf(directory), (entries) =>
        entries
          .filter((entry) => entry !== kept)
          .map((entry) => `${directory === "/" ? "" : directory}/${entry}`),
      );
    }),
    (paths) => paths.flat(),
  );
};

const rules = (tool: "Read" | "Write", paths: ReadonlyArray<string>) =>
  paths.flatMap((path) => [`${tool}(${path})`, `${tool}(${path}/**)`]);

/**
 * The settings (`cli-config.json`) of a profiled thread's own Cursor folder: rules that refuse
 * every read beside the way down to `reads` and in its dot-folders, and every write beside the way
 * down to `writes` and into its git internals. Cursor reads, and edits below its working folder,
 * without asking, and a refusal always wins over an allowance, so the rules name every entry
 * beside the way down; Read's rules hold for its search too, and a write to a path no rule names
 * outside its working folder asks (measured, cursor-agent 2026.10.22).
 */
export const cursorOwnSettings = <E>(
  confine: { readonly reads?: string | undefined; readonly writes?: string | undefined },
  entriesOf: (directory: string) => Effect.Effect<ReadonlyArray<string>, E>,
) =>
  Effect.gen(function* () {
    const reads =
      confine.reads === undefined
        ? []
        : [...(yield* besideTheWayDown(confine.reads, entriesOf)), `${confine.reads}/.*`];
    const writes =
      confine.writes === undefined
        ? []
        : [...(yield* besideTheWayDown(confine.writes, entriesOf)), `${confine.writes}/.git`];
    return {
      version: 1,
      permissions: {
        allow: [] as ReadonlyArray<string>,
        deny: [...rules("Read", reads), ...rules("Write", writes)],
      },
    };
  });

/**
 * `ownSettings`: a profiled thread's own Cursor folder ({@link cursorOwnSettings}), with project
 * settings off, so no `.cursor/cli.json` it works below (zcp's lets Zerops tools run unasked) lets
 * a call past the gate.
 */
export function buildCursorAcpSpawnInput(
  cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
  ownSettings?: string,
): AcpSessionRuntime.AcpSpawnInput {
  const env =
    ownSettings === undefined ? environment : { ...environment, CURSOR_CONFIG_DIR: ownSettings };
  return {
    command: cursorSettings?.binaryPath || "cursor-agent",
    args: [
      ...(cursorSettings?.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
      ...cursorAcpPermissionArgs(runtimeMode),
      ...(ownSettings === undefined ? [] : ["--disable-project-configs"]),
      "acp",
    ],
    cwd,
    ...(env ? { env } : {}),
  };
}

const ACP_PLAN_MODE_ALIASES = ["plan", "architect"];
const ACP_IMPLEMENT_MODE_ALIASES = ["code", "agent", "default", "chat", "implement"];
const ACP_APPROVAL_MODE_ALIASES = ["ask"];

function normalizeModeSearchText(mode: AcpSessionMode): string {
  return [mode.id, mode.name, mode.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findModeByAliases(
  modes: ReadonlyArray<AcpSessionMode>,
  aliases: ReadonlyArray<string>,
): AcpSessionMode | undefined {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find((mode) => {
      const id = mode.id.toLowerCase();
      const name = mode.name.toLowerCase();
      return id === alias || name === alias;
    });
    if (exact) {
      return exact;
    }
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalizeModeSearchText(mode).includes(alias));
    if (partial) {
      return partial;
    }
  }
  return undefined;
}

function isPlanMode(mode: AcpSessionMode): boolean {
  return findModeByAliases([mode], ACP_PLAN_MODE_ALIASES) !== undefined;
}

/**
 * The mode a Cursor session runs in. Cursor's ask mode is its read-only one ("Q&A mode - no edits
 * or command execution", measured, cursor-agent 2026.10.22): a supervised thread runs in it,
 * except a profiled thread that changes files (`writes`), which runs in agent mode and is held
 * by its own settings ({@link cursorOwnSettings}) and the gate.
 */
export function resolveCursorModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly writes: boolean;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modeState = input.modeState;
  if (!modeState) {
    return undefined;
  }

  if (input.interactionMode === "plan") {
    return findModeByAliases(modeState.availableModes, ACP_PLAN_MODE_ALIASES)?.id;
  }

  if (input.runtimeMode === "approval-required" && !input.writes) {
    return (
      findModeByAliases(modeState.availableModes, ACP_APPROVAL_MODE_ALIASES)?.id ??
      findModeByAliases(modeState.availableModes, ACP_IMPLEMENT_MODE_ALIASES)?.id ??
      modeState.availableModes.find((mode) => !isPlanMode(mode))?.id ??
      modeState.currentModeId
    );
  }

  return (
    findModeByAliases(modeState.availableModes, ACP_IMPLEMENT_MODE_ALIASES)?.id ??
    findModeByAliases(modeState.availableModes, ACP_APPROVAL_MODE_ALIASES)?.id ??
    modeState.availableModes.find((mode) => !isPlanMode(mode))?.id ??
    modeState.currentModeId
  );
}

export const makeCursorAcpRuntime = (
  input: CursorAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  SecureRandom.SecureRandom | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildCursorAcpSpawnInput(
          input.cursorSettings,
          input.cwd,
          input.environment,
          input.runtimeMode,
          input.ownSettings,
        ),
        authMethodId: "cursor_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

interface CursorAcpModelSelectionRuntime {
  readonly getConfigOptions: AcpSessionRuntime.AcpSessionRuntime["Service"]["getConfigOptions"];
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
}

export function applyCursorAcpModelSelection<E>(input: {
  readonly runtime: CursorAcpModelSelectionRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (context: CursorAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    yield* input.runtime.setModel(resolveCursorAcpBaseModelId(input.model)).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          step: "set-model",
        }),
      ),
    );

    const configUpdates = resolveCursorAcpConfigUpdates(
      yield* input.runtime.getConfigOptions,
      input.selections,
    );
    for (const update of configUpdates) {
      yield* input.runtime.setConfigOption(update.configId, update.value).pipe(
        Effect.mapError((cause) =>
          input.mapError({
            cause,
            step: "set-config-option",
            configId: update.configId,
          }),
        ),
      );
    }
  });
}
