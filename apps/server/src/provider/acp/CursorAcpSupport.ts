import {
  type CursorSettings,
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
  /** A read-only thread's own Cursor folder ({@link buildCursorAcpSpawnInput}). */
  readonly readOnlySettings?: string;
}

export interface CursorAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly step: "set-config-option" | "set-model";
  readonly configId?: string;
}

/**
 * The settings (`cli-config.json`) of a read-only thread's own Cursor folder: rules that refuse
 * every read beside the way down to `root` and in `root`'s dot-folders. Cursor reads without
 * asking, its ask mode included, and a refusal always wins over an allowance, so the rules name
 * every entry beside the way down; Read's rules hold for its search too (measured, cursor-agent
 * 2026.10.22).
 */
export const cursorReadOnlySettings = <E>(
  root: string,
  entriesOf: (directory: string) => Effect.Effect<ReadonlyArray<string>, E>,
) =>
  Effect.gen(function* () {
    const segments = root.split("/").filter((segment) => segment !== "");
    const beside = yield* Effect.forEach(segments, (kept, depth) => {
      const directory = `/${segments.slice(0, depth).join("/")}`;
      return Effect.map(entriesOf(directory), (entries) =>
        entries
          .filter((entry) => entry !== kept)
          .map((entry) => `${directory === "/" ? "" : directory}/${entry}`),
      );
    });
    return {
      version: 1,
      permissions: {
        allow: [] as ReadonlyArray<string>,
        deny: [...beside.flat(), `${root}/.*`].flatMap((path) => [
          `Read(${path})`,
          `Read(${path}/**)`,
        ]),
      },
    };
  });

/**
 * `readOnlySettings`: a read-only thread's own Cursor folder ({@link cursorReadOnlySettings}),
 * with project settings off, so no `.cursor/cli.json` it works below (zcp's lets Zerops tools run
 * unasked) lets a call past the gate.
 */
export function buildCursorAcpSpawnInput(
  cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
  readOnlySettings?: string,
): AcpSessionRuntime.AcpSpawnInput {
  const env =
    readOnlySettings === undefined
      ? environment
      : { ...environment, CURSOR_CONFIG_DIR: readOnlySettings };
  return {
    command: cursorSettings?.binaryPath || "cursor-agent",
    args: [
      ...(cursorSettings?.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
      ...cursorAcpPermissionArgs(runtimeMode),
      ...(readOnlySettings === undefined ? [] : ["--disable-project-configs"]),
      "acp",
    ],
    cwd,
    ...(env ? { env } : {}),
  };
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
          input.readOnlySettings,
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
