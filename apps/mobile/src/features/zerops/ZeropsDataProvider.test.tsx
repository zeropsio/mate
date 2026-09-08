import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../../../web/src/test/reactHookHarness";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const appStateMock = vi.hoisted(() => ({
  current: "active" as string,
  listeners: [] as Array<(next: string) => void>,
  emit(next: string) {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../../../web/src/test/reactHookHarness");
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effects.push(effect);
    },
    // Layout effects commit synchronously, unlike the passive effects above
    // that this harness defers into `effects` for the test to fire by hand.
    useLayoutEffect: (effect: () => void | (() => void)) => {
      effect();
    },
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appStateMock.current;
    },
    addEventListener: (_event: string, listener: (next: string) => void) => {
      appStateMock.listeners.push(listener);
      return {
        remove: () => {
          const index = appStateMock.listeners.indexOf(listener);
          if (index >= 0) appStateMock.listeners.splice(index, 1);
        },
      };
    },
  },
}));

import { it as itEffect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import type { ManagedZeropsDataRuntime } from "@t3tools/client-runtime/zerops/data";

import {
  mobileZeropsVisibility,
  ZeropsDataProvider,
  type MobileZeropsDataAccount,
} from "./ZeropsDataProvider";

const account = (userId: string): MobileZeropsDataAccount =>
  ({
    client: { baseUrl: "https://api.example.test" },
    userId,
  }) as MobileZeropsDataAccount;

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function render(
  currentAccount: MobileZeropsDataAccount | null,
  runtimeFactory: NonNullable<Parameters<typeof ZeropsDataProvider>[0]["runtimeFactory"]>,
): () => void {
  hooks.beginRender();
  effects.length = 0;
  ZeropsDataProvider({ account: currentAccount, children: null as ReactNode, runtimeFactory });
  const effect = effects[0];
  expect(effect).toBeDefined();
  return (effect?.() as () => void) ?? (() => undefined);
}

describe("ZeropsDataProvider account lifecycle", () => {
  beforeEach(() => {
    hooks.reset();
    effects.length = 0;
  });

  it("fences and disposes the old account before starting a replacement", async () => {
    const events: string[] = [];
    const runtimeFactory = vi.fn(async ({ account: scope }) => {
      events.push(`start:${scope.account.accountId}`);
      return {
        scope,
        shutdown: (reason: "logout" | "account-replaced") =>
          Effect.sync(() => events.push(`shutdown:${scope.account.accountId}:${reason}`)),
      } as unknown as ManagedZeropsDataRuntime;
    });

    const cleanupA = render(account("account-a"), runtimeFactory);
    await settle();
    cleanupA();

    const cleanupB = render(account("account-b"), runtimeFactory);
    await settle();
    cleanupB();
    await settle();

    expect(events).toEqual([
      "start:account-a",
      "shutdown:account-a:account-replaced",
      "start:account-b",
      "shutdown:account-b:account-replaced",
    ]);
  });

  it("shuts down with logout when the account becomes null", async () => {
    const events: string[] = [];
    const runtimeFactory = vi.fn(async ({ account: scope }) => {
      events.push(`start:${scope.account.accountId}`);
      return {
        scope,
        shutdown: (reason: "logout" | "account-replaced") =>
          Effect.sync(() => events.push(`shutdown:${scope.account.accountId}:${reason}`)),
      } as unknown as ManagedZeropsDataRuntime;
    });

    const cleanupA = render(account("account-a"), runtimeFactory);
    await settle();
    // A render to a null account happens before React runs the previous
    // effect's cleanup, so cleanup must see the account that replaces it.
    render(null, runtimeFactory);
    cleanupA();
    await settle();

    expect(events).toEqual(["start:account-a", "shutdown:account-a:logout"]);
  });

  it("shuts down the runtime only once when cleanup races a still-resolving startup", async () => {
    const events: string[] = [];
    let resolveRuntime: () => void = () => undefined;
    const runtimeFactory = vi.fn(
      ({ account: scope }) =>
        new Promise<ManagedZeropsDataRuntime>((resolve) => {
          resolveRuntime = () =>
            resolve({
              scope,
              shutdown: (reason: "logout" | "account-replaced") =>
                Effect.sync(() => events.push(`shutdown:${reason}`)),
            } as unknown as ManagedZeropsDataRuntime);
        }),
    );

    const cleanup = render(account("account-a"), runtimeFactory);
    // Let the startup chain reach `await runtimeFactory(...)` before racing it
    // with cleanup — cleanup firing any earlier would abort startup outright.
    await Promise.resolve();
    await Promise.resolve();
    expect(runtimeFactory).toHaveBeenCalledOnce();
    cleanup();
    resolveRuntime();
    await settle();

    expect(events).toEqual(["shutdown:account-replaced"]);
  });
});

describe("mobileZeropsVisibility", () => {
  beforeEach(() => {
    appStateMock.current = "active";
    appStateMock.listeners.length = 0;
  });

  itEffect("reports current visibility from AppState", () =>
    Effect.gen(function* () {
      const visibility = mobileZeropsVisibility();
      expect(yield* visibility.current).toBe("visible");

      appStateMock.current = "background";
      expect(yield* visibility.current).toBe("hidden");
    }),
  );

  itEffect("streams AppState changes and removes the listener when the subscriber shuts down", () =>
    Effect.gen(function* () {
      const visibility = mobileZeropsVisibility();
      const collected: string[] = [];
      const fiber = yield* Effect.forkChild(
        visibility.changes.pipe(
          Stream.runForEach((value: string) => Effect.sync(() => collected.push(value))),
        ),
      );
      yield* Effect.sleep("20 millis");
      expect(appStateMock.listeners).toHaveLength(1);

      appStateMock.emit("background");
      yield* Effect.sleep("20 millis");
      appStateMock.emit("active");
      yield* Effect.sleep("20 millis");

      expect(collected).toEqual(["hidden", "visible"]);

      yield* Fiber.interrupt(fiber);
      expect(appStateMock.listeners).toHaveLength(0);
    }),
  );
});
