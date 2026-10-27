import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { handleMock, unhandleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  unhandleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  protocol: { handle: handleMock, unhandle: unhandleMock },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

const testLayer = ElectronProtocol.layer;

describe("ElectronProtocol", () => {
  beforeEach(() => {
    handleMock.mockReset();
    unhandleMock.mockReset();
  });

  describe("offline fallback page", () => {
    it.effect("serves it at the desktop host, whatever the path", () =>
      Effect.gen(function* () {
        let handler: ((request: Request) => Promise<Response>) | undefined;
        handleMock.mockImplementation((_scheme, nextHandler) => {
          handler = nextHandler;
        });

        yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "zerops-mate",
              applicationUrl: "https://mate.zerops.io/",
            });
            assert.isDefined(handler);

            const rootResponse = yield* Effect.promise(() =>
              handler!(new Request("zerops-mate://app/")),
            );
            const nestedResponse = yield* Effect.promise(() =>
              handler!(new Request("zerops-mate://app/some/nested/route")),
            );

            assert.equal(rootResponse.status, 200);
            assert.equal(rootResponse.headers.get("content-type"), "text/html; charset=utf-8");
            const rootBody = yield* Effect.promise(() => rootResponse.text());
            assert.include(rootBody, "mate.zerops.io");
            assert.include(rootBody, 'href="https://mate.zerops.io/"');
            assert.include(
              rootResponse.headers.get("content-security-policy") ?? "",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
            );

            assert.equal(nestedResponse.status, 200);
            const nestedBody = yield* Effect.promise(() => nestedResponse.text());
            assert.equal(nestedBody, rootBody);
          }),
        );

        assert.deepEqual(unhandleMock.mock.calls, [["zerops-mate"]]);
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
              scheme: "zerops-mate",
              applicationUrl: "https://mate.zerops.io/",
            });
            return yield* Effect.promise(() => handler!(new Request("zerops-mate://other/")));
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
          scheme: "zerops-mate-dev",
          applicationUrl: "http://127.0.0.1:5733/",
        }),
      ).pipe(Effect.flip);

      assert.instanceOf(error, ElectronProtocol.ElectronProtocolRegistrationError);
      assert.equal(error.scheme, "zerops-mate-dev");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, 'Failed to register Electron protocol scheme "zerops-mate-dev".');
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
            scheme: "zerops-mate",
            applicationUrl: "https://mate.zerops.io/",
          }),
        ),
      );

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ElectronProtocol.ElectronProtocolUnregistrationError);
        assert.equal(error.scheme, "zerops-mate");
        assert.strictEqual(error.cause, cause);
        assert.equal(error.message, 'Failed to unregister Electron protocol scheme "zerops-mate".');
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it("keeps executable sources host-restricted while allowing runtime network resources", () => {
    const policy = ElectronProtocol.makeDesktopContentSecurityPolicy({ scheme: "zerops-mate" });
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
      "zerops-mate:",
      "blob:",
      "data:",
      "http:",
      "https:",
    ]);
    assert.deepEqual(directives["font-src"], ["'self'", "zerops-mate:", "data:"]);
  });

  describe("renderOfflineFallbackPage", () => {
    it("names the unreachable host and links retry back to the application url", () => {
      const html = ElectronProtocol.renderOfflineFallbackPage({
        applicationUrl: "https://mate.zerops.io/",
      });

      assert.include(html, "mate.zerops.io");
      assert.include(html, 'href="https://mate.zerops.io/"');
    });

    it("escapes the application url before embedding it", () => {
      const html = ElectronProtocol.renderOfflineFallbackPage({
        applicationUrl: 'https://mate.zerops.io/"><script>alert(1)</script>',
      });

      assert.notInclude(html, "<script>alert(1)</script>");
    });
  });
});
