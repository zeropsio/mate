import { describe, expect, it } from "@effect/vitest";
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
            { polling: "raf" },
          ),
        );
        // An HQ every organization shares deploys from no project of the organization: the
        // notice is its whole ask, with no Update HQ of its own to follow across a reconnect.
        const ownHq = s.drivers.core.kind === "in-process";
        if (ownHq) {
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                [...document.querySelectorAll("button")].some(
                  (button) => button.textContent?.trim() === "Update HQ",
                ),
              { polling: "raf" },
            ),
          );
          yield* Effect.promise(() =>
            s.page.locator('::-p-aria(Update HQ[role="button"])').click(),
          );
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => document.querySelector('[role="dialog"]')?.textContent?.includes("Update HQ"),
              { polling: "raf" },
            ),
          );
        } else {
          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(() =>
                [...document.querySelectorAll("button")].some(
                  (button) => button.textContent?.trim() === "Update HQ",
                ),
              ),
            ),
            "ASSERTION: a shared HQ offers no Update HQ of its own",
          ).toBe(false);
        }
        s.drivers.hq.mapFrames((frame) => frame);
        yield* s.when.hq.socket.drops;
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (followsUpdate) =>
              !document.body.innerText.includes(
                "HQ needs an update to show all navigation facts.",
              ) &&
              (!followsUpdate ||
                document.querySelector('[role="dialog"]')?.textContent?.includes("Update HQ")),
            { polling: "raf" },
            ownHq,
          ),
        );
        if (ownHq)
          yield* Effect.promise(() => s.page.locator('::-p-aria(Close[role="button"])').click());
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
