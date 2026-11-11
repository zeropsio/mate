import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HqNavigationProject } from "@t3tools/shared/hqStream";
import { createScenario } from "../../harness/scenario.ts";
import { openScenarioNavigation } from "../../harness/hqCore.ts";
import { ticketFor } from "../../harness/coreSeed.ts";

const decodeProject = Schema.decodeUnknownOption(HqNavigationProject);

/** The initial navigation receipt must prove the ownership that these filters consume. */
const projectPerson = (
  s: Effect.Success<ReturnType<typeof createScenario>>,
  projectId: string,
  field: "mine" | "waitsOnViewer",
) =>
  Effect.gen(function* () {
    let project: HqNavigationProject | undefined;
    const { core } = s.drivers;
    yield* openScenarioNavigation(core.origin, yield* ticketFor(core.call, s.owner), (message) => {
      if (message.type === "scope-reset" || message.type === "scope-values") {
        const value = message.values.find((entry) => entry.key === `project:${projectId}`)?.value;
        if (value !== undefined) project = Option.getOrUndefined(decodeProject(value));
      }
      return message.type === "scope-ready" && message.scope.kind === "navigation";
    }).pipe(Effect.scoped);
    if (project?.person[field] !== true)
      return yield* Effect.die(
        new Error(`HQ navigation project ${projectId} did not grant ${field} to the viewer`),
      );
  });

describe("overview filter history", () => {
  scenarioSuite((it) => {
    it.effect("after any sequence of filter switches, All lists every item", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        s.given.person("owner", { role: "OWNER", grants: { Bea: "OWNER" } });
        const names = ["Ada", "Bea", "Cara", "Dana"];
        for (const name of names) yield* s.given.project(name, { mate: true, app: name });
        yield* s.given.signedIn;
        yield* s.drivers.realMates
          .get("Bea")!
          .provider.turn([{ kind: "ask", question: "Which environment should I inspect?" }]);
        yield* s.when.menu.opensMate("Bea");
        yield* s.then.conversation.appears;
        yield* s.when.conversation.sends("Inspect this project");
        yield* Effect.promise(() =>
          s.page.waitForSelector("::-p-text(Which environment should I inspect?)", {
            visible: true,
          }),
        );
        yield* projectPerson(s, "Bea", "waitsOnViewer");
        yield* Effect.promise(async () => {
          await s.page.setViewport({ width: 1786, height: 1000 });
          await s.page.goto(`${s.web.origin}/zerops`);
        });
        const assertAll = () =>
          Effect.promise(async () => {
            // Every project All lists, by name: a card out of sight stands in until it is seen.
            await expect
              .poll(() =>
                s.page.$$eval(
                  '[data-zerops-surface="project-cards"] > [role="listitem"]',
                  (items) => items.map((item) => item.getAttribute("aria-label")).sort(),
                ),
              )
              .toEqual([...names].sort());
          });
        yield* assertAll();
        for (const sequence of [
          ["waiting", "all"],
          ["waiting", "mine", "waiting", "all"],
          ["mine", "waiting", "mine", "all"],
        ]) {
          for (const show of sequence) {
            yield* Effect.promise(async () => {
              await s.page
                .locator(`[data-zerops-surface="overview-filters"] [data-show="${show}"]`)
                .click();
              await s.page.waitForFunction(
                (show) =>
                  document
                    .querySelector(`[data-zerops-surface="overview-filters"] [data-show="${show}"]`)
                    ?.getAttribute("data-active-tab") === "true",
                {},
                show,
              );
              if (show === "waiting") {
                await expect
                  .poll(() =>
                    s.page.$$eval(
                      '[data-zerops-surface="project-cards"] [data-zerops-group]',
                      (cards) => cards.map((card) => card.getAttribute("data-zerops-group")),
                    ),
                  )
                  .toEqual([s.appIds.get("Bea")]);
              }
            });
          }
          yield* assertAll();
        }
        // Source data arriving after first paint joins All without changing its selected filter.
        yield* s.given.project("Eva", { mate: true, app: "Eva" });
        names.push("Eva");
        yield* assertAll();
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});

describe("overview filter from the empty link", () => {
  scenarioSuite((it) => {
    it.effect("the empty link opens the overview on Mine, listing the person's own Mates", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([]);
        s.given.person("owner", { role: "OWNER", grants: { Ada: "OWNER" } });
        yield* s.given.project("Ada", { mate: true, app: "Ada" });
        yield* s.given.project("Bea", { kind: "stage", app: "Bea" });
        yield* projectPerson(s, "Ada", "mine");
        yield* s.given.signedIn;
        yield* Effect.promise(async () => {
          await s.page.goto(s.web.origin);
          await s.page.waitForFunction(
            () =>
              document
                .querySelector('[data-zerops-surface="overview-filters"] [data-show="mine"]')
                ?.getAttribute("data-active-tab") === "true",
            { polling: "raf" },
          );
          const opened = new URL(s.page.url());
          expect(`${opened.pathname}${opened.search}`).toBe("/zerops?show=mine");
          await expect
            .poll(() =>
              s.page.$$eval('[data-zerops-surface="project-cards"] > [role="listitem"]', (items) =>
                items.map((item) => item.getAttribute("aria-label")),
              ),
            )
            .toEqual(["Ada"]);
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
