import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { installOlderNavigation } from "../../fakes/b-menu/olderNavigation.ts";
import { menuScenario } from "./dsl.ts";

describe("B: navigation protocol", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a newer field discarding every app from an older Core's navigation.
    it.effect("an older HQ keeps Mates grouped and visibly asks for an update", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario([installOlderNavigation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.grouped("Bea", "Shop");
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              document.body.innerText.includes("HQ needs an update to show all navigation facts."),
            { timeout: 15_000, polling: "raf" },
          ),
        );
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              [...document.querySelectorAll("button")].some(
                (button) => button.textContent?.trim() === "Update HQ",
              ),
            { timeout: 15_000, polling: "raf" },
          ),
        );
        yield* Effect.promise(() =>
          s.page.locator('::-p-aria(Update HQ[role="button"])').setTimeout(15_000).click(),
        );
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () => document.querySelector('[role="dialog"]')?.textContent?.includes("Update HQ"),
            { timeout: 15_000, polling: "raf" },
          ),
        );
        s.drivers.hq.mapFrames((frame) => frame);
        yield* s.when.hq.socket.drops;
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              !document.body.innerText.includes(
                "HQ needs an update to show all navigation facts.",
              ) && document.querySelector('[role="dialog"]')?.textContent?.includes("Update HQ"),
            { timeout: 15_000, polling: "raf" },
          ),
        );
        yield* Effect.promise(() =>
          s.page.locator('::-p-aria(Close[role="button"])').setTimeout(15_000).click(),
        );
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
    it.effect("a reader sees the protocol notice without an update action", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario([installOlderNavigation]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        s.given.asPerson("reader");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              document.body.innerText.includes(
                "HQ needs an update to show all navigation facts.",
              ) &&
              ![...document.querySelectorAll("button")].some(
                (button) => button.textContent?.trim() === "Update HQ",
              ),
            { timeout: 15_000, polling: "raf" },
          ),
        );
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
