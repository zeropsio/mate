// @effect-diagnostics preferSchemaOverJson:off -- controlled report inputs on the existing scenario wire.
import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { HqStreamMessage } from "@t3tools/shared/hqStream";
import { createScenario } from "../../harness/scenario.ts";
import { recordedReport, statistics } from "../../../../src/components/usage/usageTestFixtures.ts";

describe("B: Usage read states", () => {
  scenarioSuite((it) => {
    for (const width of [1786, 390, 320])
      it.effect(
        `Loading and recorded Usage keep the same totals columns and section frames at ${width} pixels`,
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario();
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            let reading = true;
            s.drivers.hq.mapFrames((frame) => {
              const message = JSON.parse(frame) as HqStreamMessage;
              if (
                (message.type !== "scope-ready" &&
                  message.type !== "scope-reset" &&
                  message.type !== "scope-values") ||
                message.scope.kind !== "agentUsage"
              )
                return frame;
              // Loading is a read HQ has not answered: none of its answer reaches the page, its
              // ready mark included, or the page holds the read as answered and Refresh resumes it
              // empty instead of asking afresh.
              if (reading) return JSON.stringify({ type: "ping" });
              if (message.type === "scope-ready") return frame;
              const query = message.scope.query;
              const report = recordedReport({
                query,
                provenance: query.provenance ?? "live-responses",
                nativeCosts: { '["USD","provider-reported-estimate",7]': "8265478" },
                groups: [
                  {
                    key: "Ada",
                    provider: "claude",
                    model: "recorded-model",
                    period: (query.since ?? "2026-10-01").slice(0, 10),
                    totals: statistics(),
                    costUsdNanos: "7830000000",
                  },
                ],
              });
              return JSON.stringify({ ...message, values: [{ key: "report", value: report }] });
            });
            yield* s.given.signedIn;
            yield* Effect.promise(async () => {
              await s.page.setViewport({ width, height: 1000 });
              await s.page.goto(`${s.web.origin}/usage`);
              if (width > 1000) await s.page.locator('::-p-aria(Cost[role="button"])').click();
              else {
                await s.page.locator("::-p-aria(Usage metric)").click();
                await s.page.locator('::-p-aria(Cost[role="option"])').click();
              }
              await s.page.waitForFunction(() => document.body.innerText.includes("Totals"));
              const geometry = () =>
                s.page.evaluate(() => {
                  const sections = [...document.querySelectorAll("section")];
                  const totals = sections.find(
                    (node) => node.querySelector("h2")?.textContent === "Totals",
                  )!;
                  const rect = (node: Element) => {
                    const r = node.getBoundingClientRect();
                    return { x: r.x, y: r.y, width: r.width, height: r.height };
                  };
                  return {
                    totals: rect(totals),
                    breakdown: rect(
                      sections.find(
                        (node) => node.querySelector("h2")?.textContent === "Breakdown",
                      )!,
                    ),
                    labels: [...totals.querySelectorAll("span")]
                      .filter((node) =>
                        [
                          "Processed tokens",
                          "Cached input",
                          "Uncached input",
                          "Output",
                          "Cache write",
                          "Cache writes",
                          "Estimated cache savings",
                        ].includes(node.textContent ?? ""),
                      )
                      .map((node) => ({ text: node.textContent, ...rect(node) })),
                  };
                });
              const pending = await geometry();

              reading = false;
              await s.page.locator('::-p-aria(Refresh usage[role="button"])').click();
              await s.page.waitForFunction(() => document.body.innerText.includes("1 turn"));
              const loaded = await geometry();

              expect(
                pending.labels.map((row) => row.text),
                "ASSERTION: loading has the same current totals in order",
              ).toEqual(loaded.labels.map((row) => row.text));
              expect(
                pending.totals.y,
                "ASSERTION: reported costs do not shift the totals frame",
              ).toBe(loaded.totals.y);
              expect(pending.breakdown.y, "ASSERTION: totals preserve the breakdown frame").toBe(
                loaded.breakdown.y,
              );
              for (const [index, row] of loaded.labels.entries()) {
                expect(pending.labels[index]!.x).toBe(row.x);
                expect(pending.labels[index]!.y).toBe(row.y);
              }
              if (width > 1000)
                expect(await s.page.$('[data-zerops-surface="sidebar-account"]')).not.toBeNull();
              else {
                await s.page.locator('::-p-aria(Open main sidebar[role="button"])').click();
                await s.page.waitForSelector('[data-zerops-surface="sidebar-account"]', {
                  visible: true,
                });
                await s.page.evaluate(async () => {
                  await Promise.all(
                    document
                      .getAnimations()
                      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
                      .map((animation) => animation.finished.catch(() => undefined)),
                  );
                });
                const footer = await s.page.$eval(
                  '[data-zerops-surface="sidebar-account"]',
                  (node) => {
                    const rect = node.getBoundingClientRect();
                    return { left: rect.left, right: rect.right };
                  },
                );
                expect(
                  footer.left,
                  "ASSERTION: the open account footer starts inside the narrow viewport",
                ).toBeGreaterThanOrEqual(0);
                expect(
                  footer.right,
                  "ASSERTION: the open account footer ends inside the narrow viewport",
                ).toBeLessThanOrEqual(width);
                expect(await s.page.evaluate(() => document.body.innerText)).not.toContain("Back");
              }
            });
            yield* s.then.noExternalNetwork;
          }),
      );
  });
});
