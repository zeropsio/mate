import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { mapCodexModelCapabilities } from "../../../../../server/src/provider/Layers/CodexProvider.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

// Native limits recorded on Fen (codex-cli 0.157.1, 2026-10-13); authored discovery timing.
const model = {
  model: "gpt-6-luna",
  id: "gpt-6-luna",
  displayName: "GPT-6-Luna",
  description: "Test model",
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: "low",
  supportedReasoningEfforts: [],
};
const capabilities = mapCodexModelCapabilities(model, {
  context_window: 272000,
  max_context_window: 872000,
});
const group = '[role="radiogroup"][aria-label="Context Window"]';

describe("C: Codex context window", () => {
  scenarioSuite((it) => {
    it.effect(
      "Codex's catalog window arriving after first paint is selectable, checked and reversible in the shared model picker",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history();
          const providers = wire.mate.config.providers.map((provider) =>
            provider.driver !== "codex"
              ? provider
              : {
                  ...provider,
                  models: [
                    {
                      slug: model.model,
                      name: model.displayName,
                      isCustom: false,
                      isDefault: true,
                      capabilities: null,
                    },
                  ],
                },
          );
          wire.providers(providers);
          wire.engine.assign({ instanceId: "codex", model: model.model, driver: "codex" });
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
            const rail = (await s.page.$('[data-sidebar="rail"]'))!;
            const box = (await rail.boundingBox())!;
            const width = await s.page.$eval(
              '[data-sidebar="sidebar"]',
              (element) => element.getBoundingClientRect().width,
            );
            await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await s.page.mouse.down();
            await s.page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
            await s.page.mouse.up();
            await s.page.waitForFunction(
              () =>
                document.querySelector('[data-sidebar="sidebar"]')?.getBoundingClientRect()
                  .width === 435,
            );
            await s.page.locator("[data-chat-provider-model-picker]").click();
            await s.page.waitForSelector('[data-slot="popover-popup"]');
            expect(await s.page.$(group)).toBeNull();
          });
          wire.providers(
            providers.map((provider) =>
              provider.driver !== "codex"
                ? provider
                : {
                    ...provider,
                    models: provider.models.map((model) => ({ ...model, capabilities })),
                  },
            ),
          );
          yield* Effect.promise(async () => {
            await s.page.waitForSelector(group);
            expect(
              await s.page.$$eval(group + ' [role="radio"]', (nodes) =>
                nodes.map((node) => ({
                  text: node.textContent,
                  checked: node.getAttribute("aria-checked"),
                })),
              ),
            ).toEqual([
              { text: "272kDefault", checked: "true" },
              { text: "872k", checked: "false" },
            ]);
            await s.page.locator(group + ' button[role="radio"]:nth-of-type(2)').click();
            const applied = await wire.waitForOp("switch-model");
            expect(applied.payload.options).toContainEqual({
              id: "contextWindow",
              value: "872000",
            });
            await s.page.waitForFunction(
              (group) =>
                document
                  .querySelector(group + ' button[role="radio"]:nth-of-type(2)')
                  ?.getAttribute("aria-checked") === "true",
              {},
              group,
            );
            const output = process.env.MATE_CONTEXT_WINDOW_EVIDENCE;
            if (output) {
              await s.page.screenshot({ path: `${output}/picker-full.png` });
              await (await s.page.$('[data-slot="popover-popup"]'))!.screenshot({
                path: `${output}/picker.png`,
              });
            }
            await s.page.locator(group + ' button[role="radio"]:nth-of-type(1)').click();
            expect((await wire.waitForOp("switch-model", 2)).payload.options).toContainEqual({
              id: "contextWindow",
              value: "272000",
            });
            await s.page.waitForFunction(
              (group) =>
                document
                  .querySelector(group + ' button[role="radio"]:nth-of-type(1)')
                  ?.getAttribute("aria-checked") === "true",
              {},
              group,
            );
          });
        }),
    );
  });
});
