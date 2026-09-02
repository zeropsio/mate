/**
 * The main-process half of the native Zerops sign-in hand-over: opens the
 * platform's authorize URL in the system browser (never the app window —
 * only two origins are ever allowed in-window, and `github.com` is not one
 * of them) and waits on a loopback callback for the credential to come back.
 *
 * Never log, span-annotate, or error-payload the delivered fragment or
 * anything parsed out of it — it carries the personal access token.
 */
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { DesktopZeropsSignInInput, DesktopZeropsSignInResult } from "@t3tools/contracts";
import { buildZeropsAuthorizeUrl } from "@t3tools/client-runtime/zerops/handover";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import { startZeropsCallbackServer, type ZeropsCallbackServer } from "./zeropsCallbackServer.ts";

const SIGN_IN_TIMEOUT = "5 minutes";

const { logInfo, logWarning } = makeComponentLogger("desktop-zerops-sign-in");

export class DesktopZeropsSignInError extends Schema.TaggedErrorClass<DesktopZeropsSignInError>()(
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

export const make = (startCallbackServer: StartZeropsCallbackServer = startZeropsCallbackServer) =>
  Effect.gen(function* () {
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

    const signIn = Effect.fn("desktop.zerops.signIn")(function* (input: DesktopZeropsSignInInput) {
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
        state: input.state,
        loopbackPort: server.port,
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

    return DesktopZeropsSignIn.of({ signIn });
  });

export const layer = (startCallbackServer?: StartZeropsCallbackServer) =>
  Layer.effect(DesktopZeropsSignIn, make(startCallbackServer));
