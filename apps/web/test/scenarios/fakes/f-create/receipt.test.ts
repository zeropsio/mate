import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { it as effectIt } from "@effect/vitest";
import puppeteer from "puppeteer-core";
import { expect, inject, it, vi } from "vite-plus/test";
import { creation, receipt } from "../../areas/f-create/dsl.ts";

vi.mock("../../areas/f-create/fake.ts", () => ({ creationOf: () => ({}) }));

it("an interrupted creation receipt is named in the test failure itself", async () => {
  const stop = new AbortController();
  const timeout = new Error("Test timed out in 180000ms.");
  void timeout.stack;
  const waiting = receipt(new Promise(() => {}), "visible text Continue", stop.signal);
  const rejected = expect(waiting).rejects.toThrow("Timed out: visible text Continue");

  stop.abort(timeout);

  await rejected;
  expect(timeout.message).toBe(
    "Test timed out in 180000ms.\nPending receipt: visible text Continue",
  );
  expect(timeout.stack).toContain("Pending receipt: visible text Continue");
});

it("a delayed creation receipt remains pending until the expected text arrives", async () => {
  const stop = new AbortController();
  const arrived = Promise.withResolvers<string>();
  let settled = false;
  const waiting = receipt(arrived.promise, "visible text Continue", stop.signal);
  void waiting.then(
    () => (settled = true),
    () => (settled = true),
  );

  await Promise.resolve();
  expect(settled).toBe(false);
  arrived.resolve("Continue");
  await expect(waiting).resolves.toBe("Continue");
  const timeout = new Error("Test timed out in 180000ms.");
  stop.abort(timeout);
  expect(timeout.message).toBe("Test timed out in 180000ms.");
});

effectIt.effect(
  "creation accepts a visible refusal while a later Continue receipt is still pending",
  () =>
    Effect.gen(function* () {
      const browser = yield* Effect.promise(() =>
        puppeteer.connect({ browserWSEndpoint: inject("scenarioBrowserEndpoint") }),
      );
      const context = yield* Effect.promise(() => browser.createBrowserContext());
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const page = yield* Effect.promise(() => context.newPage());
        const driver = creation({
          page,
          drivers: { cleanup, zerops: { requests: new Map() } },
        } as unknown as Parameters<typeof creation>[0]);
        yield* Effect.promise(() =>
          page.setContent("<div>Project created · Import refused by Zerops.</div>"),
        );
        yield* driver.text("Import refused by Zerops.");

        const missingSeen = Promise.withResolvers<void>();
        yield* Effect.promise(() =>
          page.exposeFunction("creationMissingContinue", () => missingSeen.resolve()),
        );
        yield* Effect.promise(() =>
          page.evaluate(() => {
            const read = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")?.get;
            if (!read) throw new Error("The browser cannot read visible text");
            Object.defineProperty(document.body, "innerText", {
              configurable: true,
              get() {
                const text = read.call(this) as string;
                if (!text.includes("Continue")) {
                  void (
                    globalThis as unknown as { creationMissingContinue: () => void }
                  ).creationMissingContinue();
                }
                return text;
              },
            });
          }),
        );
        const waiting = yield* Effect.forkChild(driver.text("Continue"));
        const first = yield* Effect.raceFirst(
          Effect.promise(() => missingSeen.promise).pipe(Effect.as("pending")),
          Fiber.await(waiting).pipe(Effect.as("finished")),
        );
        expect(first).toBe("pending");
        yield* Effect.promise(() =>
          page.evaluate(() => {
            document.body.append(" Continue");
          }),
        );
        yield* Fiber.join(waiting);
      } finally {
        yield* Effect.promise(async () => {
          for (const close of cleanup) await close();
          await context.close();
          browser.disconnect();
        });
      }
    }),
);
