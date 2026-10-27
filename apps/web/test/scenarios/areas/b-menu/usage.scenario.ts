// @effect-diagnostics preferSchemaOverJson:off -- controlled report inputs on the existing scenario wire.
import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { HqStreamMessage } from "@t3tools/shared/hqStream";
import { createScenario } from "../../harness/scenario.ts";
import { recordedReport, statistics } from "../../../../src/components/usage/usageTestFixtures.ts";

describe("B: Usage report presentation", () => {
  scenarioSuite((it) => {
    for (const check of ["filters", "geometry"] as const) {
      it.effect(
        check === "filters"
          ? "Narrow Usage keeps owner and project filters reachable, including inactive projects"
          : "All five Usage breakdown modes fit without widening the page at 320 pixels",
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario();
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            yield* s.given.project("Bea", { mate: true, app: "Lab" });
            const inactive = yield* s.given.app("Archive");
            s.drivers.hq.mapFrames((frame) => {
              const message = JSON.parse(frame) as HqStreamMessage;
              if (
                (message.type !== "scope-reset" && message.type !== "scope-values") ||
                message.scope.kind !== "agentUsage"
              )
                return frame;
              const query = message.scope.query;
              const empty = query.appId === inactive;
              const report = recordedReport({
                query,
                provenance: query.provenance ?? "live-responses",
                totals: statistics(empty ? "0" : "2000", empty ? "0" : "2"),
                pricing: {
                  ...recordedReport().pricing,
                  costUsdNanos: empty ? "0" : "2000000000",
                  pricedModelEntries: empty ? "0" : "2",
                },
                coverage: ["Ada", "Bea"].map((name, i) => ({
                  ...recordedReport().coverage[0]!,
                  originId: name,
                  mateId: name,
                  label: name,
                  appId: s.appIds.get(i === 0 ? "Shop" : "Lab")!,
                  ownerUserId: i === 0 ? "owner" : "dev",
                })),
                groups: empty
                  ? []
                  : ["Ada", "Bea"].map((name, i) => ({
                      key: name,
                      provider: i === 0 ? "claude" : "codex",
                      model: "recorded-model",
                      period: (query.since ?? "2026-10-01").slice(0, 10),
                      totals: statistics(),
                      costUsdNanos: "1000000000",
                    })),
              });
              return JSON.stringify({ ...message, values: [{ key: "report", value: report }] });
            });
            yield* s.given.signedIn;
            yield* Effect.promise(async () => {
              await s.page.setViewport({ width: 320, height: 740 });
              await s.page.goto(`${s.web.origin}/usage`);
              await s.page.locator("::-p-aria(Usage metric)").click();
              await s.page.locator('::-p-aria(Cost[role="option"])').click();
              await s.page.waitForFunction(() => document.body.innerText.includes("2 turns"));
              if (check === "filters") {
                const visible = await s.page.$$eval(
                  '[aria-label="Usage project"], [aria-label="Usage person"]',
                  (nodes) =>
                    nodes
                      .filter((node) => node.getBoundingClientRect().width > 0)
                      .map((node) => node.getAttribute("aria-label")),
                );
                expect(visible).toContain("Usage project");
                expect(visible).toContain("Usage person");
                await s.page.locator("::-p-aria(Usage project)").click();
                await s.page.locator('::-p-aria(Archive[role="option"])').click();
                await s.page.waitForFunction(() =>
                  document.body.innerText.includes("No recorded usage in this period."),
                );
                expect(await s.page.evaluate(() => document.body.innerText)).toContain("Archive");
              } else {
                for (const width of [320, 390, 1786]) {
                  await s.page.setViewport({ width, height: width > 1000 ? 1000 : 844 });
                  const modes = await s.page.$$eval(
                    '[aria-label="Usage breakdown"] button',
                    (nodes) => nodes.map((node) => node.textContent),
                  );
                  expect(modes).toEqual(["Owner", "Project", "Mate", "Model", "Day"]);
                  const bounds = await s.page.evaluate(() => {
                    const control = document.querySelector('[aria-label="Usage breakdown"]')!;
                    const section = control.closest("section")!;
                    const page = section.parentElement!;
                    return {
                      content: page.scrollWidth,
                      frame: page.clientWidth,
                      left: section.getBoundingClientRect().left,
                      right: section.getBoundingClientRect().right,
                      viewport: innerWidth,
                    };
                  });
                  expect(
                    bounds.content,
                    "ASSERTION: breakdown controls cannot widen the Usage content",
                  ).toBeLessThanOrEqual(bounds.frame);
                  expect(bounds.left).toBeGreaterThanOrEqual(0);
                  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
                  await s.page.$eval('[aria-label="Usage breakdown"]', (node) =>
                    node.closest("section")!.scrollIntoView({ block: "center" }),
                  );
                }
              }
            });
            yield* s.then.noExternalNetwork;
          }),
      );
    }
  });
});
