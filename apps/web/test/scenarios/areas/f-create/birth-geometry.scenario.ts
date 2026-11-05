import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { foldMenuGroup, resizeMenu } from "../../harness/browser.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { installCreation } from "./fake.ts";
import { receipt } from "./dsl.ts";

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    it.effect(
      "a being-born Mate's row fits within the menu beside its project",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installCreation]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("Bea", { mate: true, app: "Shop" });
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await receipt(resizeMenu(s.page, 435), "435 px menu");
            await receipt(foldMenuGroup(s.page, "Shop", false), "Shop group open");
          });
          const id = "4bc11a32-434c-4a90-908b-3ac6c6e87377";
          const born = yield* s.drivers.core.call("POST", "/api/births", {
            session: s.owner,
            body: {
              id,
              appId: s.appIds.get("Shop"),
              face: "rose:seal",
              intent: {
                projectName: "Shop - Nova",
                recipe: { kind: "none" },
                agents: ["codex"],
                standUp: false,
                automated: false,
                placement: { role: "dev", name: "Nova", chief: false },
                location: null,
                userRoles: [],
              },
            },
          });
          expect(born.status).toBe(201);
          const geometry = yield* Effect.promise(async () => {
            await receipt(
              s.page.waitForSelector(`[data-zerops-mate-row="${id}"]`, { visible: true }),
              "being-born Mate row after HQ birth",
            );
            return s.page.evaluate((id) => {
              const menu = document.querySelector<HTMLElement>('[data-sidebar="sidebar"]')!;
              const row = document.querySelector<HTMLElement>(`[data-zerops-mate-row="${id}"]`)!;
              const m = menu.getBoundingClientRect();
              const r = row.getBoundingClientRect();
              return {
                menuWidth: m.width,
                menuLeft: m.left,
                menuRight: m.right,
                left: r.left,
                right: r.right,
                height: r.height,
              };
            }, id);
          });
          expect(geometry.menuWidth).toBe(435);
          expect(geometry.height).toBeGreaterThan(0);
          expect(geometry.left).toBeGreaterThanOrEqual(geometry.menuLeft);
          expect(geometry.right).toBeLessThanOrEqual(geometry.menuRight + 1);
          yield* s.then.noExternalNetwork;
        }),
      60_000,
    );
  });
});
