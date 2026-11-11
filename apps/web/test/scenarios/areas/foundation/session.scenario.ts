import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ZEROPS_SESSION_STORAGE_KEY } from "../../../../../../packages/client-runtime/src/zerops/session.ts";
import { createScenario } from "../../harness/scenario.ts";
import { visibleText } from "../../harness/browser.ts";

describe("Scenario session setup", () => {
  scenarioSuite((it) => {
    it.effect("scenarios can explicitly exercise the OAuth UI journey", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { signIn: "ui" });
        yield* s.given.signedIn;
        expect(new URL(s.page.url()).pathname).toBe("/zerops");
        expect(s.drivers.zerops.requests.get("GET /authorize-app")).toBe(1);
      }),
    );
    it.effect("scenarios restore the chosen account without an OAuth UI round trip", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        s.given.asPerson("reader");
        yield* s.given.signedIn;
        expect(new URL(s.page.url()).pathname).toBe("/zerops");
        yield* Effect.promise(() => visibleText(s.page, "sidebar-account", "reader"));
        expect(
          [...s.drivers.zerops.requests.keys()].filter((key) => key.includes("authorize-app")),
        ).toEqual([]);
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate(
              (key) => JSON.parse(localStorage.getItem(key)!).accessToken,
              ZEROPS_SESSION_STORAGE_KEY,
            ),
          ),
        ).toBe("personal-reader");
        yield* Effect.promise(async () => {
          await s.page.evaluate((key) => localStorage.removeItem(key), ZEROPS_SESSION_STORAGE_KEY);
          await s.page.reload();
          await s.page.locator("::-p-aria(Continue with your Zerops account)").waitHandle();
        });
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate((key) => localStorage.getItem(key), ZEROPS_SESSION_STORAGE_KEY),
          ),
        ).toBeNull();
      }),
    );
  });
});
