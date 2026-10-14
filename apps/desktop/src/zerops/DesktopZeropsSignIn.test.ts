import { assert, describe, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import type { DesktopZeropsSignInResult } from "@t3tools/contracts";
import type * as Electron from "electron";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as IpcChannels from "../ipc/channels.ts";
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
  readonly env?: Readonly<Record<string, string>>;
  readonly deviceLoginIo?: DesktopZeropsSignIn.DeviceLoginIo;
  readonly sent?: Array<{ readonly channel: string; readonly args: readonly unknown[] }>;
  readonly opens?: boolean;
}) {
  const electronShellLayer = Layer.succeed(ElectronShell.ElectronShell, {
    openExternal: (url) =>
      Effect.sync(() => {
        input.openedUrls.push(String(url));
        return input.opens ?? true;
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
    sendAll: (channel, ...args) =>
      Effect.sync(() => {
        input.sent?.push({ channel, args });
      }),
    destroyAll: Effect.void,
    syncAllAppearance: (sync) => sync(input.mainWindow ?? makeFakeWindow()),
  } satisfies ElectronWindow.ElectronWindow["Service"]);

  return DesktopZeropsSignIn.layer(input.startCallbackServer, input.deviceLoginIo).pipe(
    Layer.provide(
      Layer.mergeAll(
        electronShellLayer,
        electronWindowLayer,
        DesktopConfig.layerTest(input.env ?? {}),
      ),
    ),
  );
}

const DEVICE_LOGIN = { VITE_ZEROPS_SIGN_IN: "device-login" } as const;
const VERIFICATION_URL = "https://app.zerops.io/device-login?code=ABCD-EFGH";

interface FakeApiRequest {
  readonly url: string;
  readonly body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The Zerops API's two device-login calls: `start` answers the request, each `check` takes the
 * next scripted answer (the last one repeats). `waited` settles once the poll first waits, by
 * which time the consent page is open.
 */
function fakeDeviceLoginApi(input: {
  readonly start?: () => Response;
  readonly checks?: ReadonlyArray<() => Response>;
  /** A wait that only an abort ends: the request stays pending until the test acts. */
  readonly holdWaits?: boolean;
}) {
  const requests: FakeApiRequest[] = [];
  let checkIndex = 0;
  let markWaited: () => void = () => undefined;
  const waited = new Promise<void>((resolve) => {
    markWaited = resolve;
  });
  const io: DesktopZeropsSignIn.DeviceLoginIo = {
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      if (url.endsWith("/auth/device-login")) {
        return (
          input.start?.() ??
          json(200, {
            requestId: "req-1",
            pollSecret: "secret-1",
            userCode: "ABCD-EFGH",
            verificationUrl: VERIFICATION_URL,
            expiresIn: 300,
            interval: 3,
          })
        );
      }
      const checks = input.checks ?? [() => json(200, { status: "PENDING" })];
      const answer = checks[Math.min(checkIndex, checks.length - 1)]!;
      checkIndex += 1;
      return answer();
    },
    wait: (_ms, signal) => {
      markWaited();
      if (input.holdWaits !== true) return Promise.resolve();
      return new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    nowMs: () => 0,
  };
  return { io, requests, waited };
}

const APPROVED = () =>
  json(200, {
    status: "APPROVED",
    auth: {
      auth: {
        accessToken: "at-1",
        refreshToken: "rt-1",
        expiresAt: "2026-10-14T12:00:00Z",
        userId: "user-1",
        tokenType: "Bearer",
      },
      user: { id: "user-1" },
    },
  });

describe("DesktopZeropsSignIn", () => {
  it.effect("opens the authorize url naming the callback server's loopback origin", () => {
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
      assert.equal(url.searchParams.get("origin"), "http://localhost:4242");
      assert.equal(url.searchParams.get("path"), "");
      assert.equal(url.searchParams.get("state"), "nonce-1");
      assert.isNull(url.searchParams.get("nonce"));
      assert.isNull(url.searchParams.get("port"));
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

  it.effect("keeps the hand-over by default: no device-login request is started", () => {
    const fake = fakeCallbackServer();
    const api = fakeDeviceLoginApi({});
    const openedUrls: string[] = [];

    return Effect.gen(function* () {
      const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
      const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
        startImmediately: true,
      });
      yield* Effect.yieldNow;

      assert.equal(new URL(openedUrls[0]!).searchParams.get("state"), "nonce-1");
      fake.deliver("#token=rt-1&state=nonce-1");
      yield* Fiber.join(fiber);
      assert.deepEqual(api.requests, []);
    }).pipe(
      Effect.provide(
        testLayer({ startCallbackServer: fake.start, openedUrls, deviceLoginIo: api.io }),
      ),
    );
  });

  describe("device login", () => {
    it.effect(
      "starts a request for the mate app, pushes its user code, opens the consent page in the system browser, polls, and answers the approved session",
      () => {
        const fake = fakeCallbackServer();
        const api = fakeDeviceLoginApi({
          checks: [() => json(200, { status: "PENDING" }), APPROVED],
        });
        const openedUrls: string[] = [];
        const sent: Array<{ readonly channel: string; readonly args: readonly unknown[] }> = [];

        return Effect.gen(function* () {
          const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
          const result = yield* signIn.signIn({ state: "nonce-1" });

          assert.deepEqual(result, {
            kind: "session",
            session: {
              accessToken: "at-1",
              refreshToken: "rt-1",
              expiresAt: "2026-10-14T12:00:00Z",
              userId: "user-1",
              tokenType: "Bearer",
            },
          });
          assert.deepEqual(api.requests[0], {
            url: "https://api.app-prg1.zerops.io/api/rest/public/auth/device-login",
            body: { appCode: "mate" },
          });
          assert.deepEqual(
            api.requests.slice(1).map((request) => request.body),
            [
              { requestId: "req-1", pollSecret: "secret-1" },
              { requestId: "req-1", pollSecret: "secret-1" },
            ],
          );
          assert.deepEqual(openedUrls, [VERIFICATION_URL]);
          assert.isNull(new URL(openedUrls[0]!).searchParams.get("display"));
          assert.deepEqual(sent, [
            {
              channel: IpcChannels.ZEROPS_SIGN_IN_PROGRESS_CHANNEL,
              args: [{ state: "nonce-1", userCode: "ABCD-EFGH" }],
            },
          ]);
          assert.deepEqual(fake.closeCalls, []);
        }).pipe(
          Effect.provide(
            testLayer({
              startCallbackServer: fake.start,
              openedUrls,
              sent,
              env: DEVICE_LOGIN,
              deviceLoginIo: api.io,
            }),
          ),
        );
      },
    );

    it.effect(
      "takes the consent origin, the app code and the register intent from the launch settings",
      () => {
        const api = fakeDeviceLoginApi({ checks: [APPROVED] });
        const openedUrls: string[] = [];

        return Effect.gen(function* () {
          const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
          yield* signIn.signIn({ state: "nonce-1", intent: "register" });

          assert.deepEqual(api.requests[0]?.body, { appCode: "mate-dev" });
          const url = new URL(openedUrls[0]!);
          assert.equal(url.origin, "http://localhost:5555");
          assert.equal(url.pathname, "/device-login");
          assert.equal(url.searchParams.get("code"), "ABCD-EFGH");
          assert.equal(url.searchParams.get("intent"), "register");
          assert.isNull(url.searchParams.get("display"));
        }).pipe(
          Effect.provide(
            testLayer({
              startCallbackServer: fakeCallbackServer().start,
              openedUrls,
              env: {
                ...DEVICE_LOGIN,
                VITE_ZEROPS_CONSENT_ORIGIN: "http://localhost:5555",
                VITE_ZEROPS_LOGIN_APP_CODE: "mate-dev",
              },
              deviceLoginIo: api.io,
            }),
          ),
        );
      },
    );

    it.effect.each<{
      readonly title: string;
      readonly checks: ReadonlyArray<() => Response>;
      readonly expected: DesktopZeropsSignInResult;
    }>([
      {
        title: "answers denied when the person denies on the consent page",
        checks: [() => json(200, { status: "DENIED" })],
        expected: { kind: "denied" },
      },
      {
        title: "answers expired once the platform no longer knows the request",
        checks: [() => json(200, { status: "PENDING" }), () => json(404, {})],
        expected: { kind: "expired" },
      },
      {
        title: "answers the platform's words when it refuses a check",
        checks: [() => json(403, { error: { code: "forbidden", message: "Not yours." } })],
        expected: { kind: "failed", message: "Not yours." },
      },
    ])("$title", ({ checks, expected }) => {
      const api = fakeDeviceLoginApi({ checks });

      return Effect.gen(function* () {
        const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
        assert.deepEqual(yield* signIn.signIn({ state: "nonce-1" }), expected);
      }).pipe(
        Effect.provide(
          testLayer({
            startCallbackServer: fakeCallbackServer().start,
            openedUrls: [],
            env: DEVICE_LOGIN,
            deviceLoginIo: api.io,
          }),
        ),
      );
    });

    it.effect(
      "answers the platform's words, opening nothing, when it will not start a request",
      () => {
        const api = fakeDeviceLoginApi({
          start: () => json(400, { error: { code: "unknownApp", message: "Unknown app." } }),
        });
        const openedUrls: string[] = [];

        return Effect.gen(function* () {
          const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
          assert.deepEqual(yield* signIn.signIn({ state: "nonce-1" }), {
            kind: "failed",
            message: "Unknown app.",
          });
          assert.deepEqual(openedUrls, []);
        }).pipe(
          Effect.provide(
            testLayer({
              startCallbackServer: fakeCallbackServer().start,
              openedUrls,
              env: DEVICE_LOGIN,
              deviceLoginIo: api.io,
            }),
          ),
        );
      },
    );

    it.effect("answers cancelled, polling no further, when the window closes", () => {
      const api = fakeDeviceLoginApi({ holdWaits: true });
      const mainWindow = makeFakeWindow();

      return Effect.gen(function* () {
        const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
        const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
          startImmediately: true,
        });
        yield* Effect.promise(() => api.waited);

        (mainWindow as unknown as NodeEvents.EventEmitter).emit("closed");
        const result = yield* Fiber.join(fiber);

        assert.deepEqual(result, { kind: "cancelled" });
        assert.equal(api.requests.length, 1);
        assert.equal((mainWindow as unknown as NodeEvents.EventEmitter).listenerCount("closed"), 0);
        assert.equal((mainWindow as unknown as NodeEvents.EventEmitter).listenerCount("focus"), 0);
      }).pipe(
        Effect.provide(
          testLayer({
            startCallbackServer: fakeCallbackServer().start,
            openedUrls: [],
            mainWindow,
            env: DEVICE_LOGIN,
            deviceLoginIo: api.io,
          }),
        ),
      );
    });

    it.effect("asks again at once when the person comes back to the window", () => {
      const api = fakeDeviceLoginApi({ holdWaits: true, checks: [APPROVED] });
      const mainWindow = makeFakeWindow();

      return Effect.gen(function* () {
        const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
        const fiber = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
          startImmediately: true,
        });
        yield* Effect.promise(() => api.waited);

        (mainWindow as unknown as NodeEvents.EventEmitter).emit("focus");
        const result = yield* Fiber.join(fiber);

        assert.equal(result.kind, "session");
      }).pipe(
        Effect.provide(
          testLayer({
            startCallbackServer: fakeCallbackServer().start,
            openedUrls: [],
            mainWindow,
            env: DEVICE_LOGIN,
            deviceLoginIo: api.io,
          }),
        ),
      );
    });

    it.effect("answers cancelled for an attempt a newer one replaced", () => {
      const api = fakeDeviceLoginApi({ holdWaits: true });

      return Effect.gen(function* () {
        const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
        const first = yield* Effect.forkChild(signIn.signIn({ state: "nonce-1" }), {
          startImmediately: true,
        });
        yield* Effect.promise(() => api.waited);
        const second = yield* Effect.forkChild(signIn.signIn({ state: "nonce-2" }), {
          startImmediately: true,
        });

        assert.deepEqual(yield* Fiber.join(first), { kind: "cancelled" });
        yield* Fiber.interrupt(second);
      }).pipe(
        Effect.provide(
          testLayer({
            startCallbackServer: fakeCallbackServer().start,
            openedUrls: [],
            env: DEVICE_LOGIN,
            deviceLoginIo: api.io,
          }),
        ),
      );
    });

    it.effect("answers cancelled, polling nothing, when the system browser will not open", () => {
      const api = fakeDeviceLoginApi({});

      return Effect.gen(function* () {
        const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
        assert.deepEqual(yield* signIn.signIn({ state: "nonce-1" }), { kind: "cancelled" });
        assert.equal(api.requests.length, 1);
      }).pipe(
        Effect.provide(
          testLayer({
            startCallbackServer: fakeCallbackServer().start,
            openedUrls: [],
            opens: false,
            env: DEVICE_LOGIN,
            deviceLoginIo: api.io,
          }),
        ),
      );
    });
  });
});
