/**
 * The main-process half of the native Zerops sign-in, in the system browser
 * (never the app window — only two origins are ever allowed in-window, and
 * `github.com` is not one of them), in one of two modes by the launch
 * settings (`DesktopZeropsSignInConfig`):
 *
 * - the hand-over (the default): opens the platform's authorize URL and
 *   waits on a loopback callback for the credential to come back;
 * - device login: starts a request on the API, pushes its user code to the
 *   renderer, opens its consent page and polls until the person decides.
 *
 * Never log, span-annotate, or error-payload the delivered fragment, the
 * session, the poll secret or anything parsed out of them — they carry or
 * mint a bearer token.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type {
  DesktopZeropsSignInInput,
  DesktopZeropsSignInProgress,
  DesktopZeropsSignInResult,
} from "@t3tools/contracts";
import {
  checkZeropsDeviceLogin,
  pollZeropsDeviceLogin,
  startZeropsDeviceLogin,
  ZeropsDeviceLoginRefused,
  zeropsDeviceLoginUrl,
} from "@t3tools/client-runtime/zerops/deviceLogin";
import { buildZeropsAuthorizeUrl } from "@t3tools/client-runtime/zerops/handover";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import { DesktopZeropsSignInConfig } from "../app/DesktopConfig.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import { startZeropsCallbackServer, type ZeropsCallbackServer } from "./zeropsCallbackServer.ts";

const SIGN_IN_TIMEOUT = "5 minutes";

/** The platform's API, which device login starts and polls on. */
const ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

/** The device login's outside world: the network and the clock. Injectable for tests. */
export interface DeviceLoginIo {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** Resolves after `ms`, or at once on abort. */
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly nowMs: () => number;
}

/** Words for a device login that could not start or finish; never a token, only the platform's. */
function deviceLoginFailure(cause: unknown): DesktopZeropsSignInResult {
  return {
    kind: "failed",
    message:
      cause instanceof ZeropsDeviceLoginRefused
        ? cause.message
        : "Zerops could not be reached. Check your connection and try again.",
  };
}

const { logInfo, logWarning } = makeComponentLogger("desktop-zerops-sign-in");

export class DesktopZeropsSignInError extends Schema.TaggedError<DesktopZeropsSignInError>()(
  "DesktopZeropsSignInError",
  {
    reason: Schema.Literal("listen-failed"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Zerops sign-in could not start a local callback listener.";
  }
}

export class DesktopZeropsSignIn extends Context.Service<
  DesktopZeropsSignIn,
  {
    readonly signIn: (
      input: DesktopZeropsSignInInput,
    ) => Effect.Effect<DesktopZeropsSignInResult, DesktopZeropsSignInError>;
  }
>()("@t3tools/desktop/zerops/DesktopZeropsSignIn") {}

export type StartZeropsCallbackServer = typeof startZeropsCallbackServer;

export const make = (
  startCallbackServer: StartZeropsCallbackServer = startZeropsCallbackServer,
  deviceLoginIoOverride?: DeviceLoginIo,
) =>
  Effect.gen(function* () {
    const config = yield* DesktopZeropsSignInConfig;
    const electronShell = yield* ElectronShell.ElectronShell;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const context = yield* Effect.context<
      ElectronShell.ElectronShell | ElectronWindow.ElectronWindow
    >();
    // Native callbacks (the callback server's delivery, the window "closed"
    // event) settle the deferred from outside any Effect fiber, so they need
    // their own entry point back in rather than the ambient one a `yield*`
    // would use.
    const runFork = Effect.runForkWith(context);
    const runPromise = Effect.runPromiseWith(context);
    const runSync = Effect.runSyncWith(context);
    const deviceLoginIo: DeviceLoginIo = deviceLoginIoOverride ?? {
      // @effect-diagnostics-next-line globalFetch:off - The platform-free device-login client takes a fetch, and Node's own is the one in this process.
      fetch: (url, init) => fetch(url, init),
      wait: (ms, signal) =>
        runPromise(Effect.sleep(ms), { signal }).then(
          () => undefined,
          () => undefined,
        ),
      nowMs: () => runSync(Clock.currentTimeMillis),
    };

    const handOver = Effect.fn("desktop.zerops.handOver")(function* (
      input: DesktopZeropsSignInInput,
    ) {
      const outcome = yield* Deferred.make<DesktopZeropsSignInResult>();
      const currentWindow = yield* electronWindow.currentMainOrFirst;

      const server: ZeropsCallbackServer = yield* Effect.tryPromise({
        try: () =>
          startCallbackServer((fragment) => {
            runFork(Deferred.succeed(outcome, { kind: "callback", fragment }));
          }),
        catch: (cause) => new DesktopZeropsSignInError({ reason: "listen-failed", cause }),
      });

      yield* logInfo("zerops sign-in listening for the platform callback", {
        port: server.port,
      });

      const authorizeUrl = buildZeropsAuthorizeUrl({
        nonce: input.state,
        origin: `http://localhost:${server.port}`,
        path: "",
        ...(input.intent === undefined ? {} : { intent: input.intent }),
      });
      const opened = yield* electronShell.openExternal(authorizeUrl);
      if (!opened) {
        yield* logWarning("zerops sign-in could not open the system browser");
        yield* Deferred.succeed(outcome, { kind: "cancelled" });
      }

      const timeoutFiber = yield* Effect.sleep(SIGN_IN_TIMEOUT).pipe(
        Effect.andThen(Deferred.succeed(outcome, { kind: "cancelled" } as const)),
        Effect.forkChild({ startImmediately: true }),
      );

      const onWindowClosed = () => {
        runFork(Deferred.succeed(outcome, { kind: "cancelled" }));
      };
      if (Option.isSome(currentWindow)) {
        currentWindow.value.once("closed", onWindowClosed);
      }

      return yield* Deferred.await(outcome).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            server.close();
            if (Option.isSome(currentWindow)) {
              currentWindow.value.removeListener("closed", onWindowClosed);
            }
          }).pipe(Effect.andThen(Fiber.interrupt(timeoutFiber))),
        ),
      );
    });

    // One device login at a time: a newer attempt (the renderer's Cancel, then Continue again)
    // ends the one still polling, which answers `cancelled` to a renderer no longer listening.
    let currentDeviceLogin: AbortController | null = null;

    const deviceLogin = Effect.fn("desktop.zerops.deviceLogin")(function* (
      input: DesktopZeropsSignInInput,
    ) {
      currentDeviceLogin?.abort();
      const attempt = new AbortController();
      currentDeviceLogin = attempt;
      const currentWindow = Option.getOrUndefined(yield* electronWindow.currentMainOrFirst);

      // Coming back to the window is the moment to ask: the person most likely just decided.
      let wakeNow: (() => void) | null = null;
      const onWindowFocus = () => wakeNow?.();
      const onWindowClosed = () => attempt.abort();
      currentWindow?.once("closed", onWindowClosed);
      currentWindow?.on("focus", onWindowFocus);

      const io: DeviceLoginIo = {
        ...deviceLoginIo,
        fetch: (url, init) => deviceLoginIo.fetch(url, { ...init, signal: attempt.signal }),
        wait: (ms, signal) => {
          const early = new AbortController();
          wakeNow = () => early.abort();
          return deviceLoginIo
            .wait(ms, AbortSignal.any([signal, early.signal]))
            .finally(() => (wakeNow = null));
        },
      };

      // A failure settles the attempt: cancelled once it was ended, the platform's words otherwise.
      const settledBy = (cause: unknown): DesktopZeropsSignInResult =>
        attempt.signal.aborted ? { kind: "cancelled" } : deviceLoginFailure(cause);

      const run = Effect.gen(function* () {
        const request = yield* Effect.tryPromise({
          try: () =>
            startZeropsDeviceLogin({
              fetch: io.fetch,
              apiBase: ZEROPS_API_BASE,
              appCode: config.loginAppCode,
              kind: "login",
              nowMs: io.nowMs(),
            }),
          catch: settledBy,
        });
        const consentUrl = yield* Effect.try({
          try: () =>
            zeropsDeviceLoginUrl({
              verificationUrl: request.verificationUrl,
              ...(Option.isSome(config.consentOrigin)
                ? { consentOrigin: config.consentOrigin.value }
                : {}),
              ...(input.intent === undefined ? {} : { intent: input.intent }),
            }),
          catch: settledBy,
        });
        if (attempt.signal.aborted) return { kind: "cancelled" } as const;

        const progress: DesktopZeropsSignInProgress = {
          state: input.state,
          userCode: request.userCode,
        };
        yield* electronWindow.sendAll(IpcChannels.ZEROPS_SIGN_IN_PROGRESS_CHANNEL, progress);
        if (!(yield* electronShell.openExternal(consentUrl))) {
          yield* logWarning("zerops sign-in could not open the system browser");
          return { kind: "cancelled" } as const;
        }

        const outcome = yield* Effect.tryPromise({
          try: (signal) =>
            pollZeropsDeviceLogin({
              request,
              check: () =>
                checkZeropsDeviceLogin({ fetch: io.fetch, apiBase: ZEROPS_API_BASE, request }),
              wait: io.wait,
              nowMs: io.nowMs,
              signal: AbortSignal.any([signal, attempt.signal]),
            }),
          catch: settledBy,
        });
        yield* logInfo("zerops device login settled", { outcome: outcome.kind });
        if (outcome.kind !== "approved") return { kind: outcome.kind };
        // A login's approval always carries its session; `checkZeropsDeviceLogin` refuses one
        // without.
        return outcome.session === null
          ? deviceLoginFailure(null)
          : ({ kind: "session", session: outcome.session } as const);
      });

      return yield* run.pipe(
        Effect.catch((settled) => Effect.succeed(settled)),
        Effect.ensuring(
          Effect.sync(() => {
            if (currentDeviceLogin === attempt) currentDeviceLogin = null;
            attempt.abort();
            currentWindow?.removeListener("closed", onWindowClosed);
            currentWindow?.removeListener("focus", onWindowFocus);
          }),
        ),
      );
    });

    const signIn = (input: DesktopZeropsSignInInput) =>
      config.mode === "device-login" ? deviceLogin(input) : handOver(input);

    return DesktopZeropsSignIn.of({ signIn });
  });

export const layer = (
  startCallbackServer?: StartZeropsCallbackServer,
  deviceLoginIo?: DeviceLoginIo,
) => Layer.effect(DesktopZeropsSignIn, make(startCallbackServer, deviceLoginIo));
