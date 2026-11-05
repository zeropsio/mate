import { describe, expect, it, vi } from "@effect/vitest";
import { EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { AVAILABLE_CONNECTION_STATE, PrimaryConnectionTarget } from "../connection/model.ts";
import * as EnvironmentRegistryModule from "../connection/registry.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";
import {
  createAssetEnvironmentAtoms,
  InvalidAssetCollectionKeyError,
  parseAssetCollectionKey,
  resolveAssetUrl,
} from "./assets.ts";

describe("resolveAssetUrl", () => {
  it("resolves a server-relative asset route against the environment base", () => {
    expect(resolveAssetUrl("https://host.example/", "/api/assets/token/file.png")).toBe(
      "https://host.example/api/assets/token/file.png",
    );
  });

  // The route the server hands back is root-absolute, so resolving it with a
  // plain `new URL` would drop the prefix the environment is proxied under and
  // point every image and attachment at whoever owns the origin root.
  it("keeps the path prefix the environment is served under", () => {
    expect(resolveAssetUrl("https://host.example/mate/", "/api/assets/token/file.png")).toBe(
      "https://host.example/mate/api/assets/token/file.png",
    );
    expect(
      resolveAssetUrl("https://host.example/mate/", "/api/attachments/upload/payload.sig"),
    ).toBe("https://host.example/mate/api/attachments/upload/payload.sig");
  });

  it("returns null for an unusable base URL", () => {
    expect(resolveAssetUrl("not a url", "/api/assets/token/file.png")).toBeNull();
  });
});

describe("asset collection keys", () => {
  it("preserves malformed JSON and its native cause", () => {
    const key = "not-json";
    let error: unknown;

    try {
      parseAssetCollectionKey(key);
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(InvalidAssetCollectionKeyError);
    expect(error).toMatchObject({ key, cause: expect.any(SyntaxError) });
  });

  it("rejects invalid asset collection shapes", () => {
    const key = JSON.stringify(["environment-1", [{ _tag: "unknown" }]]);

    expect(() => parseAssetCollectionKey(key)).toThrowError(InvalidAssetCollectionKeyError);
  });
});

describe("createAssetEnvironmentAtoms", () => {
  it("keys asset URL queries by environment and resource", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const assets = createAssetEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const originalTarget = {
      environmentId,
      input: {
        resource: {
          _tag: "project-favicon" as const,
          cwd: "/repo/original",
        },
      },
    };

    expect(assets.createUrl(originalTarget)).toBe(
      assets.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "project-favicon",
            cwd: "/repo/original",
          },
        },
      }),
    );
    expect(
      assets.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "project-favicon",
            cwd: "/repo/next",
          },
        },
      }),
    ).not.toBe(assets.createUrl(originalTarget));
    expect(
      assets.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "project-favicon",
            cwd: "/repo/original",
            path: "brand/icon.svg",
          },
        },
      }),
    ).not.toBe(assets.createUrl(originalTarget));
    expect(
      assets.createUrl({
        environmentId: EnvironmentId.make("environment-2"),
        input: originalTarget.input,
      }),
    ).not.toBe(assets.createUrl(originalTarget));
  });

  it("keys collections while preserving independent resource queries", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const assets = createAssetEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const resources = [
      { _tag: "attachment" as const, attachmentId: "attachment-1" },
      { _tag: "attachment" as const, attachmentId: "attachment-2" },
    ];

    expect(assets.createUrls({ environmentId, resources })).toBe(
      assets.createUrls({
        environmentId,
        resources: resources.map((resource) => ({ ...resource })),
      }),
    );
    expect(
      assets.createUrls({
        environmentId,
        resources: [...resources].toReversed(),
      }),
    ).not.toBe(assets.createUrls({ environmentId, resources }));
  });
});

describe("asset URLs", () => {
  it.live("An asset URL is refreshed at its `expiresAt`; no fixed 30 min refresh", () =>
    Effect.gen(function* () {
      const target = new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make("environment-1"),
        label: "Environment",
        httpBaseUrl: "https://host.example",
        wsBaseUrl: "wss://host.example",
      });
      const lifetimeMs = 50 * 60_000;
      let asked = 0;
      const session = {
        client: {
          [WS_METHODS.assetsCreateUrl]: () =>
            Effect.map(Clock.currentTimeMillis, (now) => {
              asked += 1;
              return {
                relativeUrl: `/api/assets/token-${String(asked)}/icon.png`,
                expiresAt: now + lifetimeMs,
              };
            }),
        },
      } as unknown as RpcSession.RpcSession;
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target,
        state: yield* SubscriptionRef.make({
          ...AVAILABLE_CONNECTION_STATE,
          desired: true,
          network: "online" as const,
          phase: "connected" as const,
          attempt: 1,
          generation: 1,
        }),
        session: yield* SubscriptionRef.make(Option.some(session)),
      } as unknown as EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const run: EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
        Effect.provideService(effect, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
      const followStream: EnvironmentRegistry["Service"]["followStream"] = (
        _environmentId,
        stream,
      ) => Stream.provideService(stream, EnvironmentSupervisor.EnvironmentSupervisor, supervisor);
      const runtime = Atom.runtime(
        Layer.succeed(
          EnvironmentRegistryModule.EnvironmentRegistry,
          EnvironmentRegistryModule.EnvironmentRegistry.of({
            run,
            followStream,
          } as unknown as EnvironmentRegistry["Service"]),
        ),
      );
      const atom = createAssetEnvironmentAtoms(runtime).createUrl({
        environmentId: target.environmentId,
        input: { resource: { _tag: "project-favicon", cwd: "/repo" } },
      });
      const url = (registry: AtomRegistry.AtomRegistry) => {
        const result = registry.get(atom);
        return AsyncResult.isSuccess(result) ? result.value.relativeUrl : null;
      };
      // The atom runtime keeps the wall clock: its timers are the test's to move.
      const advance = (ms: number) => Effect.promise(() => vi.advanceTimersByTimeAsync(ms));

      vi.useFakeTimers({ now: 0 });
      const registry = AtomRegistry.make();
      const unmount = registry.mount(atom);
      yield* Effect.ensuring(
        Effect.gen(function* () {
          yield* advance(0);
          expect(asked).toBe(1);
          expect(url(registry)).toBe("/api/assets/token-1/icon.png");
          yield* advance(lifetimeMs - 1);
          expect(asked).toBe(1);
          yield* advance(1);
          expect(asked).toBe(2);
          expect(url(registry)).toBe("/api/assets/token-2/icon.png");
        }),
        Effect.sync(() => {
          unmount();
          registry.dispose();
          vi.useRealTimers();
        }),
      );
    }),
  );
});
