import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { menuScenario } from "./dsl.ts";

describe("B: menu liveness", () => {
  scenarioSuite((it) => {
    // Placement updates in both tabs while the Mate's conversation keeps its identity and history.
    it.effect("moving an open Mate updates both tabs without losing its conversation", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Cara", { mate: true, app: "Other" });
        yield* s.colleague.said("Ada", "Keep this conversation when Ada moves");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* s.then.conversation.showsMessage("Keep this conversation when Ada moves");
        const url = s.page.url();
        const second = yield* s.given.browserActor();
        yield* second.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop", second.page);
        yield* second.when.menu.opensMate("Ada");
        yield* second.then.conversation.appears;
        yield* second.then.conversation.showsMessage("Keep this conversation when Ada moves");
        const secondUrl = second.page.url();
        yield* s.menu.movesMate("Ada", "Other");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.menu.grouped("Ada", "Other", second.page);
        yield* s.menu.keepsConversation(url);
        yield* s.menu.keepsConversation(secondUrl, second.page);
        yield* s.then.conversation.showsMessage("Keep this conversation when Ada moves");
        yield* second.then.conversation.showsMessage("Keep this conversation when Ada moves");
        yield* s.when.conversation.sends("Continue in the same Mate after Move");
        yield* s.then.conversation.showsMessage("Continue in the same Mate after Move");
        yield* second.then.conversation.showsMessage("Continue in the same Mate after Move");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.then.noReload;
        yield* second.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a Mate whose address was turned on staying unreachable: its record is not promised
    // to arrive by a push, so its own row is read once its enable finishes.
    it.effect("a Mate opens once its address is turned on, its record never pushed", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        const zerops = s.drivers.zerops;
        const zcp = zerops.rows("service-stack").find((row) => row.id === "service-Bea")!;
        zerops.put("service-stack", {
          ...zcp,
          subdomainAccess: false,
          lastUpdate: "2026-10-06T12:00:00.000Z",
        });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Bea").appears();
        // Zerops turns its address on: the enable finishes, and the service's record changes
        // with no push of it.
        zerops.faults.set("service-stack:push", { silence: true });
        zerops.put("service-stack", {
          ...zcp,
          subdomainAccess: true,
          lastUpdate: "2026-10-06T12:01:50.000Z",
        });
        zerops.put("process", {
          id: "enable-bea",
          clientId: "ORG",
          projectId: "Bea",
          actionName: "stack.enableSubdomainAccess",
          status: "FINISHED",
          created: "2026-10-06T12:01:40.000Z",
          started: "2026-10-06T12:01:40.000Z",
          finished: "2026-10-06T12:01:45.000Z",
          lastUpdate: "2026-10-06T12:01:45.000Z",
          executorTag: "USER",
          serviceStackId: "service-Bea",
          serviceStacks: [{ id: "service-Bea" }],
          error: null,
          appVersion: null,
        });
        yield* s.when.menu.opensMate("Bea");
        yield* s.then.conversation.appears;
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Targets stage builds running without a menu indicator while the detail remains unopened.
    it.effect("a colleague's stage build appears in the menu", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.stage("Shop-stage", "Shop");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        const chipContrast = Effect.promise(async () => {
          for (const theme of ["light", "dark"]) {
            await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
            await s.page.waitForFunction(
              (dark) => document.documentElement.classList.contains("dark") === dark,
              {},
              theme === "dark",
            );
            await s.page.evaluate(() => document.fonts.ready);
            await s.page.evaluate(async () => {
              await Promise.all(
                [
                  ...document.querySelectorAll('[data-zerops-surface="sidebar-project-env-tag"]'),
                ].flatMap((chip) => chip.getAnimations().map((animation) => animation.finished)),
              );
            });
            const contrasts = await s.page.evaluate(() => {
              const sidebar = document.querySelector('[data-sidebar="sidebar"]')!;
              const chips = [
                ...sidebar.querySelectorAll<HTMLElement>(
                  '[data-zerops-surface="sidebar-project-env-tag"]',
                ),
              ].filter((node) => node.getBoundingClientRect().width > 0);
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", { willReadFrequently: true })!;
              const luminance = (bytes: Uint8ClampedArray) =>
                [...bytes].slice(0, 3).reduce((sum, channel, index) => {
                  const value = channel / 255;
                  return (
                    sum +
                    [0.2126, 0.7152, 0.0722][index]! *
                      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
                  );
                }, 0);
              return chips.map((chip) => {
                // Scoped to these chip/sidebar colour layers; grain, gradients and ancestor opacity remain unverified.
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = getComputedStyle(sidebar).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                context.fillStyle = getComputedStyle(chip).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                const background = luminance(context.getImageData(0, 0, 1, 1).data);
                context.fillStyle = getComputedStyle(chip).color;
                context.fillRect(0, 0, 1, 1);
                const text = luminance(context.getImageData(0, 0, 1, 1).data);
                return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
              });
            });
            expect(
              contrasts.length,
              "ASSERTION: menu has rendered chip text to measure",
            ).toBeGreaterThan(0);
            expect(
              Math.min(...contrasts),
              `ASSERTION: menu chip colour layers have readable contrast in both themes (${theme})`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        });
        yield* s.colleague.builds("Shop-stage");
        // Three times the 5 s target budget gives a loaded laptop 10 s of headroom.
        yield* s.menu.chip("\\b(?:building|deploying|releasing)\\b", 15_000);
        yield* chipContrast;
      }),
    );
  });
});
