import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { installDesktopIpcHandlers } from "../ipc/DesktopIpcHandlers.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopApplicationMenu from "../window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopLinuxUrlHandler from "./DesktopLinuxUrlHandler.ts";
import * as DesktopObservability from "./DesktopObservability.ts";
import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopShellEnvironment from "../shell/DesktopShellEnvironment.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";

const makeDesktopRunId = Crypto.Crypto.pipe(
  Effect.flatMap((crypto) => crypto.randomUUIDv4),
  Effect.map((value) => value.replaceAll("-", "").slice(0, 12)),
);

export class DesktopWebBundleMissingError extends Schema.TaggedErrorClass<DesktopWebBundleMissingError>()(
  "DesktopWebBundleMissingError",
  {},
) {
  override get message(): string {
    return "Could not locate the staged hosted-static web bundle (resources/web/index.html) next to the desktop app.";
  }
}

const { logInfo: logBootstrapInfo } = DesktopObservability.makeComponentLogger("desktop-bootstrap");

const { logInfo: logStartupInfo, logError: logStartupError } =
  DesktopObservability.makeComponentLogger("desktop-startup");

const writeFatalStartupError = (message: string) =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        process.stderr.write(message, () => resolve());
      }),
  );

export const handleFatalStartupError = Effect.fn("desktop.startup.handleFatalStartupError")(
  function* (
    stage: string,
    error: unknown,
  ): Effect.fn.Return<
    void,
    never,
    | DesktopShutdown.DesktopShutdown
    | DesktopState.DesktopState
    | ElectronApp.ElectronApp
    | ElectronDialog.ElectronDialog
  > {
    const shutdown = yield* DesktopShutdown.DesktopShutdown;
    const state = yield* DesktopState.DesktopState;
    const electronApp = yield* ElectronApp.ElectronApp;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const message = error instanceof Error ? error.message : String(error);
    const detail =
      error instanceof Error && typeof error.stack === "string" ? `\n${error.stack}` : "";
    yield* logStartupError("fatal startup error", {
      stage,
      message,
      ...(detail.length > 0 ? { detail } : {}),
    });
    const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
    if ((process.env.T3CODE_SMOKE_CAPTURE?.length ?? 0) > 0) {
      yield* writeFatalStartupError(`fatal startup error (${stage}): ${message}${detail}\n`);
      yield* shutdown.request;
      yield* electronApp.exit(1);
      return;
    }
    if (!wasQuitting) {
      yield* electronDialog.showErrorBox(
        "Zerops Mate failed to start",
        `Stage: ${stage}\n${message}${detail}`,
      );
    }
    yield* shutdown.request;
    yield* electronApp.quit;
  },
);

const fatalStartupCause = <E>(stage: string, cause: Cause.Cause<E>) =>
  handleFatalStartupError(stage, Cause.pretty(cause)).pipe(Effect.andThen(Effect.failCause(cause)));

/**
 * Where the renderer origin's requests come from. Development proxies to the
 * Vite dev server; every other run serves the staged hosted-static web
 * bundle straight off disk — the desktop no longer runs a local backend to
 * point the window at. That bundle is built by
 * `scripts/stage-desktop-web.ts`'s `stageHostedWebBundle` with
 * `VITE_HOSTED_APP_CHANNEL` set to the desktop's own update channel
 * ("latest" or "nightly", see `resolveDesktopUpdateChannel`) and
 * `VITE_HTTP_URL`/`VITE_WS_URL` both empty, so `isHostedStaticApp()`
 * (`apps/web/src/hostedPairing.ts`) is true and `__root.tsx`'s `beforeLoad`
 * takes the `hosted-static` branch before it ever reaches
 * `readPrimaryEnvironmentTarget()` — which would otherwise throw on the
 * non-http `t3code://` origin.
 */
const resolveDesktopProtocolTarget = Effect.fn("desktop.bootstrap.resolveDesktopProtocolTarget")(
  function* (): Effect.fn.Return<
    ElectronProtocol.DesktopProtocolTarget,
    DesktopWebBundleMissingError,
    DesktopEnvironment.DesktopEnvironment | DesktopAssets.DesktopAssets
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.isDevelopment) {
      return {
        _tag: "development",
        devServerUrl: Option.getOrThrow(environment.devServerUrl),
      };
    }

    const assets = yield* DesktopAssets.DesktopAssets;
    const indexPath = yield* assets.resolveResourcePath("web/index.html").pipe(Effect.orDie);
    if (Option.isNone(indexPath)) {
      return yield* new DesktopWebBundleMissingError();
    }

    return { _tag: "static", bundleDir: environment.path.dirname(indexPath.value) };
  },
);

const bootstrap = Effect.gen(function* () {
  const state = yield* DesktopState.DesktopState;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
  yield* logBootstrapInfo("bootstrap start");

  const target = yield* resolveDesktopProtocolTarget();
  yield* electronProtocol.registerDesktopProtocol({
    scheme: ElectronProtocol.getDesktopScheme(environment.isDevelopment),
    target,
  });
  yield* logBootstrapInfo("bootstrap registered renderer protocol", { target: target._tag });

  yield* installDesktopIpcHandlers();
  yield* logBootstrapInfo("bootstrap ipc handlers registered");

  if (!(yield* Ref.get(state.quitting))) {
    yield* desktopWindow.createMain;
  }
}).pipe(Effect.withSpan("desktop.bootstrap"));

const startup = Effect.gen(function* () {
  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const applicationMenu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
  const electronApp = yield* ElectronApp.ElectronApp;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const linuxUrlHandler = yield* DesktopLinuxUrlHandler.DesktopLinuxUrlHandler;
  const shellEnvironment = yield* DesktopShellEnvironment.DesktopShellEnvironment;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const preReadyElectronOptions = yield* DesktopPreReadyPlatform.DesktopPreReadyElectronOptions;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;

  yield* shellEnvironment.installIntoProcess;
  const hasCommandLinePasswordStore =
    preReadyElectronOptions.linuxPasswordStoreCommandLine !== null;
  const linuxElectronOptions =
    environment.platform === "linux" && !hasCommandLinePasswordStore
      ? DesktopPreReadyPlatform.resolveEarlyLinuxElectronOptionsFromProcess()
      : preReadyElectronOptions.linux;
  if (linuxElectronOptions !== null && !hasCommandLinePasswordStore) {
    if (
      linuxElectronOptions.passwordStore !== null ||
      preReadyElectronOptions.linux?.passwordStore !== null
    ) {
      yield* electronApp.removeCommandLineSwitch("password-store");
    }
    if (linuxElectronOptions.passwordStore !== null) {
      yield* electronApp.appendCommandLineSwitch(
        "password-store",
        linuxElectronOptions.passwordStore,
      );
    }
  }
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  yield* electronApp.setPath("userData", userDataPath);
  yield* logStartupInfo("runtime logging configured", { logDir: environment.logDir });
  yield* desktopSettings.load;

  if (linuxElectronOptions !== null) {
    yield* logStartupInfo("linux password store configured", {
      passwordStore: hasCommandLinePasswordStore
        ? "command-line"
        : (linuxElectronOptions.passwordStore ?? "electron-default"),
      xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP ?? null,
      xdgSessionDesktop: process.env.XDG_SESSION_DESKTOP ?? null,
    });
  }

  yield* appIdentity.configure;
  yield* lifecycle.register;

  yield* electronApp.whenReady.pipe(
    Effect.withSpan("desktop.electron.whenReady"),
    Effect.catchCause((cause) => fatalStartupCause("whenReady", cause)),
  );
  yield* logStartupInfo("app ready");
  if (environment.platform === "linux") {
    const selectedBackend = yield* safeStorage.selectedStorageBackend;
    yield* logStartupInfo("safe storage ready", {
      backend: Option.getOrElse(selectedBackend, () => "unknown"),
    });
  }
  yield* appIdentity.configure;
  yield* applicationMenu.configure;
  yield* updates.configure;
  yield* linuxUrlHandler.register;
  yield* bootstrap.pipe(Effect.catchCause((cause) => fatalStartupCause("bootstrap", cause)));
}).pipe(Effect.withSpan("desktop.startup"));

const scopedProgram = Effect.scoped(
  Effect.gen(function* () {
    const runId = yield* makeDesktopRunId;
    yield* Effect.annotateLogsScoped({ scope: "desktop", runId });
    yield* Effect.annotateCurrentSpan({ scope: "desktop", runId });

    const shutdown = yield* DesktopShutdown.DesktopShutdown;

    yield* Effect.addFinalizer(() => shutdown.markComplete);

    yield* startup;
    yield* shutdown.awaitRequest;
  }),
);

export const program = scopedProgram.pipe(Effect.withSpan("desktop.app"));
