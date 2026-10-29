// @effect-diagnostics preferSchemaOverJson:off -- fake HTTP request diagnostics.
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { createScenario } from "../../harness/scenario.ts";
import { creationNetwork } from "../../fakes/f-create/browserDrain.ts";
import { creationOf } from "./fake.ts";
import type { Dialog } from "puppeteer-core";
import { visibleText } from "../../harness/browser.ts";
import { rendered } from "../../harness/completedHttp.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function creation(s: Pick<Scenario, "page" | "drivers" | "clock" | "web">) {
  const { page, drivers } = s;
  const control = creationOf(drivers);
  const network = creationNetwork(page);
  drivers.cleanup.push(async () => network.close());
  const text = (value: string) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (value) => document.body.innerText.includes(value),
          { polling: "raf" },
          value,
        );
      } catch (cause) {
        throw new Error(
          `Missing visible creation text: ${value}\n${await page.evaluate(() => document.body.innerText)}\nRequests: ${JSON.stringify([...drivers.zerops.requests])}`,
          { cause },
        );
      }
    });
  const click = (name: string) =>
    Effect.promise(async () => {
      try {
        await page.locator(`::-p-aria(${name})`).click();
      } catch (cause) {
        throw new Error(
          `Cannot press ${name}\n${await page.evaluate(() => document.body.innerText)}`,
          { cause },
        );
      }
    });
  const fill = (name: string, value: string) =>
    Effect.promise(async () => {
      await page.locator(`::-p-aria(${name})`).click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.keyboard.type(value);
      await rendered(page);
    });
  return {
    holdProjectCreation: () => {
      control.holdCreation = true;
    },
    completeProjectCreation: Effect.sync(() => {
      const process = drivers.zerops.rows("process").find((row) => row.id === "created-1-creation");
      if (!process) throw new Error("The original creation was not accepted");
      drivers.zerops.put("process", { ...process, status: "FINISHED" });
    }),
    projectBound: () => {
      const bound = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          /^\/api\/births\/[^/]+\/project$/u.test(new URL(response.url()).pathname) &&
          response.status() === 200,
      );
      return Effect.promise(() => bound);
    },
    noSetupYet: Effect.sync(() => {
      expect(control.mateKeys).toEqual([]);
      expect(
        drivers.zerops.rows("service-stack").some((row) => row.projectId === "created-1"),
      ).toBe(false);
    }),
    stopAfterContainer: () => {
      control.blockIsolation = true;
    },
    allowSetup: () => {
      control.blockIsolation = false;
    },
    failProject: () => {
      control.creationStatus = "FAILED";
    },
    reload: Effect.promise(async () => {
      const confirmations: string[] = [];
      // Leaving during setup asks first; this driver represents choosing to leave.
      const leave = async (dialog: Dialog) => {
        confirmations.push(dialog.type());
        await dialog.accept();
      };
      page.on("dialog", leave);
      try {
        await page.reload();
        return confirmations;
      } finally {
        page.off("dialog", leave);
      }
    }),
    finishSetup: click("Finish setup"),
    originalSetupOnly: Effect.sync(() => {
      expect(control.accepted).toEqual([{ id: "created-1", name: "Garden - Nova" }]);
      expect(
        drivers.zerops.requests.get(
          "PUT /project/created-1/first-class-recipe/development-container",
        ),
      ).toBe(1);
      expect(control.mateKeys).toEqual(["zcp-Garden - Nova"]);
    }),
    failedProjectRemoved: Effect.sync(() => {
      expect(control.deleted).toEqual(["created-1"]);
      expect(drivers.zerops.rows("project").some((row) => row.id === "Ada")).toBe(true);
      expect(drivers.zerops.rows("project").some((row) => row.id === "created-1")).toBe(false);
    }),
    noAgentImported: Effect.sync(() => {
      expect(
        drivers.zerops.requests.get(
          "PUT /project/created-1/first-class-recipe/development-container",
        ) ?? 0,
      ).toBe(0);
    }),
    loseCreationReply: () => {
      control.outcome = "lost";
    },
    /** Zerops has been asked to create the project. */
    createAsked: Effect.promise(() => drivers.zerops.waitForRequest("POST /client/ORG/project", 1)),
    /** Another project of the same name appears as the creation is accepted. */
    twinCreation: () => {
      control.twin = true;
    },
    refuseCreatedProjectAccess: () => {
      drivers.zerops.faults.set("GET /project/created-1", { status: 403 });
    },
    refusedReads: () => drivers.zerops.requests.get("GET /project/created-1") ?? 0,
    settled: Effect.promise(network.settled),
    pastRetryWindow: Effect.gen(function* () {
      yield* Effect.promise(network.settled);
      yield* Effect.promise(() => s.clock.advanceStepped(5_000, { settle: network.settled }));
      yield* Effect.promise(network.settled);
    }),
    text,
    matePage: (name: string) => Effect.promise(() => visibleText(page, "mate-coming-page", name)),
    click,
    fill,
    newProject: Effect.gen(function* () {
      yield* click("New project");
      yield* fill("Project name", "Garden");
      yield* fill("Its first Mate", "Nova");
    }),
    submitProject: click("Create Garden with Nova"),
    /** Shop's card in the overview: its ··· holds Add Mate, Add stage and Put it live. */
    openAdd: (role: "Mate" | "stage" | "production") =>
      Effect.gen(function* () {
        yield* Effect.promise(() => page.goto(`${s.web.origin}/zerops`));
        // The page's ··· for Shop — on its card, or its row among the projects without work —
        // never the menu heading's of the same name. Shop holds only its setup files, so its
        // card's Production offers no Put it live (it waits for a change); the ··· still does.
        yield* Effect.promise(async () => {
          await page
            .locator(() =>
              [...document.querySelectorAll<HTMLElement>('[aria-label="More for Shop"]')].find(
                (button) =>
                  button.closest('[data-sidebar="sidebar"]') === null &&
                  button.getBoundingClientRect().width > 0,
              ),
            )
            .click();
        });
        // Production is put live from its sheet; its own form — a name, an agent, a Git branch —
        // is the sheet's quiet way out.
        if (role === "production") {
          yield* click('Put it live[role="menuitem"]');
          yield* text("Put Shop live");
          yield* click("Set up production yourself…");
          return;
        }
        // The menu's item, not the card's own Add stage beneath the open menu.
        yield* click(`Add ${role}[role="menuitem"]`);
      }),
    /** The sheet's quiet ways out: production's or a stage's own form, or a Git branch. */
    chooseDestination: (target: "zerops" | "git") =>
      click(
        target === "zerops"
          ? "Change its name or services…"
          : "Use a branch in your Git repository instead…",
      ),
    withAgent: Effect.promise(() =>
      page.locator('[data-zerops-surface="environment-creation-form"] [role="switch"]').click(),
    ),
    agentIsOff: Effect.promise(async () => {
      const selector = '[data-zerops-surface="environment-creation-form"] [role="switch"]';
      await page.locator(selector).wait();
      expect(await page.$eval(selector, (toggle) => toggle.getAttribute("aria-checked"))).toBe(
        "false",
      );
    }),
    /** The new place stands on its project's road in the menu, as its stage or its prod. */
    environmentAppears: (name: string, tag: "stage" | "prod") =>
      Effect.promise(async () => {
        await page.waitForSelector('[data-zerops-surface="environment-creation-form"]', {
          hidden: true,
        });
        // Its project, as Zerops accepted it.
        let projectId = control.accepted.find((project) => project.name === name)?.id;
        for (let wait = 0; projectId === undefined && wait < 150; wait++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          projectId = control.accepted.find((project) => project.name === name)?.id;
        }
        if (projectId === undefined)
          throw new Error(`No project ${name} was made: ${JSON.stringify(control.accepted)}`);
        try {
          // It stands on its project's page, outside the menu.
          await page.waitForFunction(
            (name, tag) => {
              const menu = document.querySelector('[data-sidebar="sidebar"]');
              const words = new Set(
                [...document.querySelectorAll<HTMLElement>("body *")]
                  .filter(
                    (node) =>
                      node.childElementCount === 0 &&
                      menu?.contains(node) !== true &&
                      node.getBoundingClientRect().height > 0,
                  )
                  .map((node) => node.textContent?.trim()),
              );
              // A stage stands under its name; production as the project's Production, set up.
              return tag === "prod"
                ? words.has("Production") && !words.has("Put it live")
                : words.has(name);
            },
            { polling: "raf" },
            name,
            tag,
          );
        } catch (cause) {
          throw new Error(
            `Missing environment ${name} (${tag}) on its project's page\n${await page.evaluate(() => document.body.innerText)}`,
            { cause },
          );
        }
      }),
    /**
     * The stage being added has come up as far as its adding goes: its card's Stage section no
     * longer says how far the adding has got, and its own reading speaks there.
     */
    stageAdded: Effect.promise(async () => {
      try {
        await page.waitForFunction(
          () =>
            document.querySelector('[data-zerops-place="stage"]') !== null &&
            document.querySelector('[data-zerops-place="stage"][data-zerops-setting-up]') === null,
          { polling: "raf" },
        );
      } catch (cause) {
        throw new Error(
          `The stage is still being added\n${await page.evaluate(() => document.body.innerText)}`,
          { cause },
        );
      }
    }),
    /** The Mate stands on its project's card in the overview. */
    mateAppearsInProject: (name: string, group: string) =>
      Effect.promise(async () => {
        await page.goto(`${s.web.origin}/zerops`);
        await page.waitForFunction(
          (name, group) =>
            [...document.querySelectorAll<HTMLElement>("[data-zerops-group]")]
              .filter((card) => card.getAttribute("aria-label") === group)
              .some((card) =>
                [...card.querySelectorAll<HTMLElement>('[data-zerops-surface="card-mate"]')].some(
                  (mate) => mate.innerText.split("\n").some((line) => line.trim() === name),
                ),
              ),
          { polling: "raf" },
          name,
          group,
        );
      }),
    acceptedOnce: (name: string) =>
      Effect.sync(() => {
        expect(control.accepted, "Creation made duplicate or wrong projects").toEqual([
          { id: "created-1", name },
        ]);
      }),
    writes: () => drivers.zerops.requests.get("POST /client/ORG/project") ?? 0,
  };
}
