import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { installOlderNavigation } from "../../fakes/b-menu/olderNavigation.ts";
import { menuScenario } from "./dsl.ts";

describe("B: navigation protocol", () => {
  scenarioSuite((it) => {
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
        s.drivers.hq.mapFrames((frame) => frame);
        yield* s.when.hq.socket.drops;
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              !document.body.innerText.includes("HQ needs an update to show all navigation facts."),
            { polling: "raf" },
          ),
        );
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
