import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, vi } from "vite-plus/test";

import {
  createManagedRelaySession,
  managedRelayAccountChanges,
  managedRelaySessionAtom,
  setManagedRelaySession,
} from "./managedRelayState.ts";

let registry = AtomRegistry.make();

function resetRegistry() {
  registry.dispose();
  registry = AtomRegistry.make();
}

function zeropsToken(expiresAtSeconds: number): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `${encode({ alg: "none" })}.${encode({ exp: expiresAtSeconds })}.signature`;
}

describe("ManagedRelaySession", () => {
  afterEach(resetRegistry);

  it.effect(
    "deduplicates concurrent Zerops token reads and reuses the token until JWT expiry",
    () =>
      Effect.gen(function* () {
        const token = zeropsToken(4_102_444_800);
        let resolveToken!: (value: string) => void;
        const readClerkToken = vi.fn(
          () =>
            new Promise<string>((resolve) => {
              resolveToken = resolve;
            }),
        );
        const session = createManagedRelaySession({
          accountId: "account-1",
          readClerkToken,
        });

        const readsFiber = yield* Effect.all([session.readClerkToken(), session.readClerkToken()], {
          concurrency: "unbounded",
        }).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(readClerkToken).toHaveBeenCalledTimes(1);

        resolveToken(token);
        expect(yield* Fiber.join(readsFiber)).toEqual([token, token]);
        expect(yield* session.readClerkToken()).toBe(token);
        expect(readClerkToken).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect("updates the token provider without replacing a same-account session", () =>
    Effect.gen(function* () {
      const firstRead = vi.fn(() => Promise.resolve<string | null>(null));
      setManagedRelaySession(registry, {
        accountId: "account-1",
        readClerkToken: firstRead,
      });
      const firstSession = registry.get(managedRelaySessionAtom);
      expect(firstSession).not.toBeNull();
      expect(yield* firstSession!.readClerkToken()).toBeNull();

      const secondRead = vi.fn(() => Promise.resolve<string | null>("refreshed-token"));
      setManagedRelaySession(registry, {
        accountId: "account-1",
        readClerkToken: secondRead,
      });

      expect(registry.get(managedRelaySessionAtom)).toBe(firstSession);
      expect(yield* firstSession!.readClerkToken()).toBe("refreshed-token");
      expect(firstRead).toHaveBeenCalledTimes(1);
      expect(secondRead).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("does not pin a refreshed session to an older pending token read", () =>
    Effect.gen(function* () {
      let resolveFirst!: (token: string) => void;
      setManagedRelaySession(registry, {
        accountId: "account-1",
        readClerkToken: () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      });
      const session = registry.get(managedRelaySessionAtom);
      const firstRead = yield* session!.readClerkToken().pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      setManagedRelaySession(registry, {
        accountId: "account-1",
        readClerkToken: () => Promise.resolve("refreshed-token"),
      });

      expect(yield* session!.readClerkToken()).toBe("refreshed-token");
      resolveFirst("older-token");
      expect(yield* Fiber.join(firstRead)).toBe("older-token");
    }),
  );

  it("emits credential changes only when the managed relay account changes", async () => {
    setManagedRelaySession(registry, {
      accountId: "account-1",
      readClerkToken: () => Promise.resolve("first-token"),
    });
    const changes = Effect.runPromise(
      managedRelayAccountChanges(registry).pipe(Stream.take(2), Stream.runCollect),
    );
    await vi.waitFor(() => {
      expect(registry.getNodes().get(managedRelaySessionAtom)?.listeners.size).toBeGreaterThan(0);
    });

    setManagedRelaySession(registry, {
      accountId: "account-1",
      readClerkToken: () => Promise.resolve("refreshed-token"),
    });
    setManagedRelaySession(registry, {
      accountId: "account-2",
      readClerkToken: () => Promise.resolve("second-token"),
    });
    setManagedRelaySession(registry, null);

    expect(Array.from(await changes)).toEqual(["account-2", null]);
  });
});
