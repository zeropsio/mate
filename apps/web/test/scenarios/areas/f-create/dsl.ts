// @effect-diagnostics preferSchemaOverJson:off -- fake HTTP request diagnostics.
import * as Effect from "effect/Effect";
import { expect } from "@effect/vitest";
import type { createScenario } from "../../harness/scenario.ts";
import { creationNetwork } from "../../fakes/f-create/browserDrain.ts";
import { creationOf } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function creation(s: Scenario) {
  const { page, drivers } = s;
  const control = creationOf(drivers);
  const network = creationNetwork(page);
  drivers.cleanup.push(async () => network.close());
  const text = (value: string) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (value) => document.body.innerText.includes(value),
          { timeout: page.getDefaultTimeout(), polling: "raf" },
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
    });
  const openProjectDetails = async (group: string) => {
    const toggle = page.locator(`[data-zerops-surface="project-rows"] ::-p-aria(${group})`);
    await toggle.wait();
    const expanded = await page.evaluate(
      (group) =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[data-zerops-surface="project-rows"] button',
          ),
        ]
          .find((button) => button.innerText.trim() === group)
          ?.getAttribute("aria-expanded"),
      group,
    );
    if (expanded !== "true") await toggle.click();
  };
  return {
    loseCreationReply: () => {
      control.outcome = "lost";
    },
    refuseCreatedProjectAccess: () => {
      drivers.zerops.faults.set("GET /project/created-1", { status: 403 });
    },
    refusedReads: () => drivers.zerops.requests.get("GET /project/created-1") ?? 0,
    refusedReadArrives: Effect.promise(() =>
      drivers.zerops.waitForRequest("GET /project/created-1", 1),
    ),
    settled: Effect.promise(network.settled),
    pastRetryWindow: Effect.gen(function* () {
      yield* Effect.promise(network.settled);
      // Drain requests before advancing: their continuations may install the 5 s re-check.
      // Ten fake seconds gives that window another full 5 s of headroom on a loaded CPU.
      yield* Effect.promise(() => s.clock.advance(10_000));
      yield* Effect.promise(network.settled);
    }),
    text,
    click,
    fill,
    newProject: Effect.gen(function* () {
      yield* click("New project");
      yield* fill("Project name", "Garden");
      yield* fill("Its first Mate", "Nova");
    }),
    submitProject: click("Create Garden with Nova"),
    openAdd: (role: "Mate" | "stage" | "production") =>
      Effect.gen(function* () {
        yield* Effect.promise(() => page.goto(`${s.web.origin}/zerops`));
        yield* Effect.promise(() => openProjectDetails("Shop"));
        yield* Effect.promise(() =>
          page
            .locator('[data-zerops-surface="project-rows"] ::-p-aria(More for Shop)')

            .click(),
        );
        yield* click(`Add ${role}`);
      }),
    withAgent: Effect.promise(() =>
      page
        .locator('[data-zerops-surface="environment-creation-form"] [role="switch"]')

        .click(),
    ),
    agentIsOff: Effect.promise(async () => {
      const selector = '[data-zerops-surface="environment-creation-form"] [role="switch"]';
      await page.locator(selector).wait();
      expect(await page.$eval(selector, (toggle) => toggle.getAttribute("aria-checked"))).toBe(
        "false",
      );
    }),
    environmentAppears: (name: string, tag: "stage" | "prod") =>
      Effect.promise(async () => {
        await page.waitForSelector('[data-zerops-surface="environment-creation-form"]', {
          hidden: true,
          timeout: page.getDefaultTimeout(),
        });
        try {
          await page.waitForFunction(
            (name, tag) =>
              [
                ...document.querySelectorAll<HTMLElement>(
                  '[data-zerops-surface="environment-rows"] [data-zerops-surface="environment-name"]',
                ),
              ].some(
                (label) =>
                  label.innerText.trim() === name &&
                  label
                    .closest("li")
                    ?.querySelector<HTMLElement>('[data-zerops-surface="role-tag"]')
                    ?.innerText.trim()
                    .toLowerCase() === tag,
              ),
            { timeout: page.getDefaultTimeout(), polling: "raf" },
            name,
            tag,
          );
        } catch (cause) {
          throw new Error(
            `Missing environment ${name} with ${tag} badge\n${await page.evaluate(() => document.body.innerText)}`,
            { cause },
          );
        }
      }),
    mateAppearsInProject: (name: string, group: string) =>
      Effect.promise(async () => {
        await page.goto(`${s.web.origin}/zerops`);
        await openProjectDetails(group);
        await page.waitForFunction(
          (name) =>
            [...document.querySelectorAll<HTMLElement>('[data-zerops-surface="mate-cards"]')].some(
              (cards) => cards.innerText.split("\n").some((line) => line.trim() === name),
            ),
          { timeout: page.getDefaultTimeout(), polling: "raf" },
          name,
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
