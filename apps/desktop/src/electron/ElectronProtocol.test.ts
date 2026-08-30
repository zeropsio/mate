// @effect-diagnostics nodeBuiltinImport:off - test fixture uses raw fs/path to stage a bundle dir.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, vi } from "vite-plus/test";

const { handleMock, netFetchMock, unhandleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  netFetchMock: vi.fn(),
  unhandleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  net: { fetch: netFetchMock },
  protocol: { handle: handleMock, unhandle: unhandleMock },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

const testLayer = ElectronProtocol.layer.pipe(Layer.provideMerge(NodeServices.layer));

function makeBundleFixture(): string {
  const bundleDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-web-bundle-"));
  NodeFS.writeFileSync(NodePath.join(bundleDir, "index.html"), "<html>root</html>");
  NodeFS.mkdirSync(NodePath.join(bundleDir, "assets"));
  NodeFS.writeFileSync(NodePath.join(bundleDir, "assets", "app.js"), "console.log('app');");
  return bundleDir;
}

describe("ElectronProtocol", () => {
  beforeEach(() => {
    handleMock.mockReset();
    netFetchMock.mockReset();
    unhandleMock.mockReset();
  });

  describe("development target", () => {
    it.effect("proxies the stable renderer origin to the dev server", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });
        netFetchMock.mockResolvedValue(new Response("ok"));

        yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code-dev",
              target: { _tag: "development", devServerUrl: new URL("http://127.0.0.1:3773/") },
            });
            assert.isDefined(handler);

            const response = yield* Effect.promise(() =>
              handler!(
                new Request("t3code-dev://app/api/health?verbose=1", {
                  headers: {
                    accept: "application/json",
                    origin: "t3code-dev://app",
                    referer: "t3code-dev://app/",
                    "sec-fetch-site": "same-origin",
                  },
                }),
              ),
            );
            assert.equal(yield* Effect.promise(() => response.text()), "ok");
            assert.include(
              response.headers.get("content-security-policy") ?? "",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
            );
            assert.include(
              response.headers.get("content-security-policy") ?? "",
              "connect-src 'self' http: https: ws: wss:",
            );
          }),
        );

        assert.deepEqual(
          handleMock.mock.calls.map((call) => call[0]),
          ["t3code-dev"],
        );
        assert.equal(netFetchMock.mock.calls[0]?.[0], "http://127.0.0.1:3773/api/health?verbose=1");
        const forwardedHeaders = new Headers(netFetchMock.mock.calls[0]?.[1]?.headers);
        assert.equal(forwardedHeaders.get("accept"), "application/json");
        assert.isNull(forwardedHeaders.get("origin"));
        assert.isNull(forwardedHeaders.get("referer"));
        assert.isNull(forwardedHeaders.get("sec-fetch-site"));
        assert.deepEqual(unhandleMock.mock.calls, [["t3code-dev"]]);
      }).pipe(Effect.provide(testLayer)),
    );

    it.effect("retries transient dev server failures", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });
        netFetchMock
          .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5733"))
          .mockResolvedValueOnce(new Response("ready"));

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code-dev",
              target: { _tag: "development", devServerUrl: new URL("http://127.0.0.1:5733/") },
            });
            return yield* Effect.promise(() => handler!(new Request("t3code-dev://app/")));
          }),
        );

        assert.equal(yield* Effect.promise(() => response.text()), "ready");
        assert.equal(netFetchMock.mock.calls.length, 2);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  describe("static target", () => {
    let bundleDir: string;

    beforeEach(() => {
      bundleDir = makeBundleFixture();
    });

    afterEach(() => {
      NodeFS.rmSync(bundleDir, { recursive: true, force: true });
    });

    it.effect("serves index.html from disk at the bundle root", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code",
              target: { _tag: "static", bundleDir },
            });
            return yield* Effect.promise(() => handler!(new Request("t3code://app/")));
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(yield* Effect.promise(() => response.text()), "<html>root</html>");
        assert.include(
          response.headers.get("content-security-policy") ?? "",
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
        );
        assert.equal(netFetchMock.mock.calls.length, 0);
      }).pipe(Effect.provide(testLayer)),
    );

    it.effect("serves a nested asset with its own content type", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code",
              target: { _tag: "static", bundleDir },
            });
            return yield* Effect.promise(() => handler!(new Request("t3code://app/assets/app.js")));
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
        assert.equal(yield* Effect.promise(() => response.text()), "console.log('app');");
      }).pipe(Effect.provide(testLayer)),
    );

    it.effect("falls back to index.html for an unknown path (client-side routing)", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code",
              target: { _tag: "static", bundleDir },
            });
            return yield* Effect.promise(() =>
              handler!(new Request("t3code://app/some/client/route")),
            );
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(yield* Effect.promise(() => response.text()), "<html>root</html>");
      }).pipe(Effect.provide(testLayer)),
    );

    it.effect("refuses to serve a path that escapes the bundle directory", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code",
              target: { _tag: "static", bundleDir },
            });
            return yield* Effect.promise(() =>
              handler!(new Request("t3code://app/..%2F..%2Fetc%2Fpasswd")),
            );
          }),
        );

        assert.equal(response.status, 200);
        assert.equal(yield* Effect.promise(() => response.text()), "<html>root</html>");
      }).pipe(Effect.provide(testLayer)),
    );

    it.effect("rejects custom protocol requests for another host", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3code",
              target: { _tag: "static", bundleDir },
            });
            return yield* Effect.promise(() => handler!(new Request("t3code://other/")));
          }),
        );

        assert.equal(response.status, 404);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it.effect("preserves protocol registration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol registration failed");
      handleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const error = yield* Effect.scoped(
        protocol.registerDesktopProtocol({
          scheme: "t3code-dev",
          target: { _tag: "development", devServerUrl: new URL("http://127.0.0.1:3773/") },
        }),
      ).pipe(Effect.flip);

      assert.instanceOf(error, ElectronProtocol.ElectronProtocolRegistrationError);
      assert.equal(error.scheme, "t3code-dev");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, 'Failed to register Electron protocol scheme "t3code-dev".');
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves protocol unregistration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol unregistration failed");
      unhandleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const exit = yield* Effect.exit(
        Effect.scoped(
          protocol.registerDesktopProtocol({
            scheme: "t3code",
            target: { _tag: "development", devServerUrl: new URL("http://127.0.0.1:3773/") },
          }),
        ),
      );

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ElectronProtocol.ElectronProtocolUnregistrationError);
        assert.equal(error.scheme, "t3code");
        assert.strictEqual(error.cause, cause);
        assert.equal(error.message, 'Failed to unregister Electron protocol scheme "t3code".');
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it("keeps executable sources host-restricted while allowing runtime network resources", () => {
    const policy = ElectronProtocol.makeDesktopContentSecurityPolicy({ scheme: "t3code" });
    const directives = Object.fromEntries(
      policy.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );

    assert.deepEqual(directives["script-src"], [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "https://challenges.cloudflare.com",
    ]);
    assert.deepEqual(directives["connect-src"], ["'self'", "http:", "https:", "ws:", "wss:"]);
    assert.deepEqual(directives["img-src"], [
      "'self'",
      "t3code:",
      "blob:",
      "data:",
      "http:",
      "https:",
    ]);
    assert.deepEqual(directives["font-src"], ["'self'", "t3code:", "data:"]);
  });
});
