import { assert, describe, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import type * as Electron from "electron";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopZeropsSignIn from "./DesktopZeropsSignIn.ts";
import type { ZeropsCallbackServer } from "./zeropsCallbackServer.ts";

function fakeCallbackServer() {
  const closeCalls: number[] = [];
  let deliver: ((fragment: string) => void) | undefined;
  const start = (onFragment: (fragment: string) => void): Promise<ZeropsCallbackServer> => {
    deliver = onFragment;
    return Promise.resolve({
      port: 4242,
      address: "127.0.0.1",
      close: () => {
        closeCalls.push(1);
      },
    });
  };
  return {
    start,
    closeCalls,
    deliver: (fragment: string) => deliver?.(fragment),
  };
}

function makeFakeWindow(): Electron.BrowserWindow {
  return new NodeEvents.EventEmitter() as unknown as Electron.BrowserWindow;
}

function testLayer(input: {
  readonly startCallbackServer: DesktopZeropsSignIn.StartZeropsCallbackServer;
  readonly openedUrls: string[];
  readonly mainWindow?: Electron.BrowserWindow;
}) {
  const electronShellLayer = Layer.succeed(ElectronShell.ElectronShell, {
    openExternal: (url) =>
      Effect.sync(() => {
        input.openedUrls.push(String(url));
        return true;
      }),
    copyText: () => Effect.void,
  } satisfies ElectronShell.ElectronShell["Service"]);

  const electronWindowLayer = Layer.succeed(ElectronWindow.ElectronWindow, {
    create: () => Effect.die("not used"),
    main: Effect.succeed(Option.fromNullishOr(input.mainWindow)),
    currentMainOrFirst: Effect.succeed(Option.fromNullishOr(input.mainWindow)),
    focusedMainOrFirst: Effect.succeed(Option.fromNullishOr(input.mainWindow)),
    setMain: () => Effect.void,
    clearMain: () => Effect.void,
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll: Effect.void,
    syncAllAppearance: (sync) => sync(input.mainWindow ?? makeFakeWindow()),
  } satisfies ElectronWindow.ElectronWindow["Service"]);

  return DesktopZeropsSignIn.layer(input.startCallbackServer).pipe(
    Layer.provide(Layer.mergeAll(electronShellLayer, electronWindowLayer)),
  );
}

describe("DesktopZeropsSignIn", () => {
  it.effect("opens the authorize url with the loopback port from the callback server", () => {
    const fake = fakeCallbackServer();
    const openedUrls: string[] = [];

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      assert.equal(openedUrls.length, 1);
      const url = new URL(openedUrls[0]!);
      assert.equal(url.hostname, "app.zerops.io");
      assert.equal(url.searchParams.get("app"), "zerops-code");
      assert.equal(url.searchParams.get("state"), "nonce-1");
      assert.equal(url.searchParams.get("port"), "4242");
      assert.isNull(url.searchParams.get("intent"));

      fake.deliver("#token=rt-1&state=nonce-1");
      const result = yield* Fiber.join(fiber);
      assert.deepEqual(result, { kind: "callback", fragment: "#token=rt-1&state=nonce-1" });
      assert.deepEqual(fake.closeCalls, [1]);
    }).pipe(Effect.provide(testLayer({ startCallbackServer: fake.start, openedUrls })));
  });

  it.effect("carries the register intent through to the authorize url", () => {
    const fake = fakeCallbackServer();
    const openedUrls: string[] = [];

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(
        signIn.signIn({ state: "nonce-1", intent: "register" }),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;

      const url = new URL(openedUrls[0]!);
      assert.equal(url.searchParams.get("intent"), "register");

      fake.deliver("#token=rt-1&state=nonce-1");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(testLayer({ startCallbackServer: fake.start, openedUrls })));
  });

  it.effect("resolves cancelled after the five-minute timeout, and closes the server", () => {
    const fake = fakeCallbackServer();
    const openedUrls: string[] = [];

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      yield* TestClock.adjust("5 minutes");
      const result = yield* Fiber.join(fiber);

      assert.deepEqual(result, { kind: "cancelled" });
      assert.deepEqual(fake.closeCalls, [1]);
    }).pipe(Effect.provide(testLayer({ startCallbackServer: fake.start, openedUrls })));
  });

  it.effect("resolves cancelled when the window closes before the browser comes back", () => {
    const fake = fakeCallbackServer();
    const openedUrls: string[] = [];
    const mainWindow = makeFakeWindow();

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      (mainWindow as unknown as NodeEvents.EventEmitter).emit("closed");
      const result = yield* Fiber.join(fiber);

      assert.deepEqual(result, { kind: "cancelled" });
      assert.deepEqual(fake.closeCalls, [1]);
    }).pipe(Effect.provide(testLayer({ startCallbackServer: fake.start, openedUrls, mainWindow })));
  });

  it.effect("does not reopen a window listener once the callback already delivered", () => {
    const fake = fakeCallbackServer();
    const openedUrls: string[] = [];
    const mainWindow = makeFakeWindow();

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      fake.deliver("#token=rt-1&state=nonce-1");
      const result = yield* Fiber.join(fiber);
      // Cleanup removed the "closed" listener; a late close is a no-op.
      (mainWindow as unknown as NodeEvents.EventEmitter).emit("closed");

      assert.deepEqual(result, { kind: "callback", fragment: "#token=rt-1&state=nonce-1" });
      assert.equal((mainWindow as unknown as NodeEvents.EventEmitter).listenerCount("closed"), 0);
    }).pipe(Effect.provide(testLayer({ startCallbackServer: fake.start, openedUrls, mainWindow })));
  });

  it.effect("fails when the loopback listener cannot start, without opening a browser", () => {
    const openedUrls: string[] = [];

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const error = yield* signIn.signIn({ state: "nonce-1" }).pipe(Effect.flip);

      assert.instanceOf(error, DesktopZeropsSignIn.DesktopZeropsSignInError);
      assert.equal(error.reason, "listen-failed");
      assert.deepEqual(openedUrls, []);
    }).pipe(
      Effect.provide(
        testLayer({
          startCallbackServer: () => Promise.reject(new Error("EADDRINUSE")),
          openedUrls,
        }),
      ),
    );
  });
});
