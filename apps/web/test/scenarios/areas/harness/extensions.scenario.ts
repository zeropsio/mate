import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { platformIdentityWasRead } from "./driver.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioTimeout } from "../../harness/policy.ts";

// Catches extension fixtures replacing an app, conflating accounts, or sharing isolated contexts.
describe("harness extension APIs", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    const people = ["owner", "reader", "dev", "reader"] as const;
    it.effect(
      "several projects per application, separate applications and selected people in tabs/contexts",
      () =>
        Effect.gen(function* () {
          const scenario = yield* createScenario();
          const { given, then, drivers } = scenario;
          given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
          yield* given.project("Ada", { mate: true, app: "Shop" });
          const shopId = drivers.appIds.get("Shop");
          yield* given.project("Bea", { mate: true, app: "Shop" });
          yield* given.project("Staging", { kind: "stage", app: "Shop" });
          yield* given.project("Production", { kind: "production", app: "Shop" });
          yield* given.project("Cara", { mate: true, app: "Other" });
          expect(drivers.appIds.size).toBe(2);
          expect(drivers.appIds.get("Shop")).toBe(shopId);
          expect(drivers.owner).toBe(scenario.owner);
          // Real Core's platform traffic must be visible at the fake HTTP boundary.
          expect(platformIdentityWasRead(drivers, "HQ")).toBe(true);
          yield* given.signedIn;
          yield* then.menu.row("Shop").appears();
          yield* then.menu.row("Other").appears();
          const reader = yield* given.browserActor({ person: people[1] });
          yield* reader.given.signedIn;
          yield* reader.then.menu.row("Shop").appears();
          const developer = yield* given.browserActor({ person: people[2] });
          yield* developer.given.signedIn;
          yield* developer.then.menu.row("Ada").appears();
          const tab = yield* given.browserActor({
            person: people[3],
            context: reader.page.browserContext(),
          });
          yield* tab.given.signedIn;
          yield* tab.then.menu.row("Shop").appears();
          expect(reader.page.browserContext()).toBe(tab.page.browserContext());
          expect(developer.page.browserContext()).not.toBe(reader.page.browserContext());
          expect(platformIdentityWasRead(drivers, "dev")).toBe(true);
          expect(platformIdentityWasRead(drivers, "reader")).toBe(true);
          yield* then.noExternalNetwork;
        }),
      scenarioTimeout(people.length),
    );
  });
});
