// @effect-diagnostics preferSchemaOverJson:off -- controlled report inputs on the existing scenario wire.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { UsageReport } from "@t3tools/contracts";
import type { HqStreamMessage } from "@t3tools/shared/hqStream";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { recordedReport, statistics } from "../../../../src/components/usage/usageTestFixtures.ts";

describe("B: Usage read states", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
                (message.type !== "scope-reset" && message.type !== "scope-values") ||
                message.scope.kind !== "agentUsage"
              )
                return frame;
              if (reading) return JSON.stringify({ type: "ping" });
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
              await s.page.screenshot({ path: `/tmp/usage-fix-slice3-loading-${width}.png` });
              reading = false;
              await s.page.locator('::-p-aria(Refresh usage[role="button"])').click();
              await s.page.waitForFunction(() => document.body.innerText.includes("1 turn"));
              const loaded = await geometry();
              await s.page.screenshot({ path: `/tmp/usage-fix-slice3-loaded-${width}.png` });
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
                await s.page.screenshot({ path: `/tmp/usage-fix-slice3-footer-${width}.png` });
              }
            });
            yield* s.then.noExternalNetwork;
          }),
      );

    it.effect("Usage distinguishes coverage from failed reads and recovers the named section", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        yield* s.given.project("Fern", { mate: true, app: "Shop" });
        let failed = false;
        let recordedMateId: string | undefined;
        const periods = new Map<
          string,
          Extract<HqStreamMessage, { type: "scope-error" }>["scope"]
        >();
        const mateScopes: string[] = [];
        s.drivers.hq.mapFrames((frame) => {
          const message = JSON.parse(frame) as HqStreamMessage;
          if (
            (message.type !== "scope-reset" && message.type !== "scope-values") ||
            message.scope.kind !== "agentUsage"
          )
            return frame;
          const sourceReport = message.values.find((entry) => entry.key === "report")?.value as
            | UsageReport
            | undefined;
          recordedMateId ??= sourceReport?.coverage.find(
            (entry) => entry.projectId === "Fern",
          )?.mateId;
          if (recordedMateId === undefined) return frame;
          const query = message.scope.query;
          if (query.mateId != null) mateScopes.push(query.mateId);
          if (query.groupBy === "day") {
            periods.set(JSON.stringify(message.scope), message.scope);
            if (failed)
              return JSON.stringify({
                type: "scope-error",
                scope: message.scope,
                code: "fixture-outage",
                reason: "fixture outage",
                disposition: "transient",
              });
          }
          const earlier = query.provenance === "legacy-scanner";
          const report = recordedReport({
            query,
            provenance: query.provenance ?? "live-responses",
            recordedSince: earlier ? null : "2026-10-01T00:00:00.000Z",
            totals: statistics(earlier ? "0" : "1000", earlier ? "0" : "1"),
            state: "partial",
            coverage: [
              {
                mateId: recordedMateId,
                label: "Fern",
                deleted: false,
                value: { state: "unknown", since: null, through: null, gaps: [] },
              },
            ],
            groups: earlier
              ? []
              : [
                  {
                    key: recordedMateId,
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
          await s.page.setViewport({ width: 1786, height: 1000 });
          await s.page.goto(`${s.web.origin}/usage`);
          await s.page.locator('::-p-aria(Cost[role="button"])').click();
          await s.page.waitForFunction(
            () =>
              document.body.innerText.includes("1 turn") &&
              document.querySelector(
                'svg[aria-label="Daily cost by coding agent"] g[role="button"]',
              ) !== null,
          );
          await s.page.locator("::-p-text(Coverage by Mate)").click();
          const text = await s.page.evaluate(() => document.body.innerText);
          expect(text).toContain("No usage from this Mate is recorded in this report.");
          expect(text).toContain("Totals include only recorded activity.");
          expect(text).not.toContain("could not be read");
          await s.page.screenshot({ path: "/tmp/usage-fix-slice3-coverage.png" });
          await s.page.locator('::-p-aria(Show usage for Fern[role="button"])').click();
          await s.page.waitForFunction(() => document.body.innerText.includes("1 turn"));
          expect(mateScopes).toContain(recordedMateId);
          failed = true;
          for (const scope of periods.values())
            for (const [client] of s.drivers.hq.links)
              client.send(
                JSON.stringify({
                  type: "scope-error",
                  scope,
                  code: "fixture-outage",
                  reason: "fixture outage",
                  disposition: "transient",
                }),
              );
          await s.page.waitForFunction(() =>
            document.body.innerText.includes("Showing last known daily usage."),
          );
          expect(await s.page.evaluate(() => document.body.innerText)).toContain("$7.83");
          await s.page.screenshot({ path: "/tmp/usage-fix-slice3-stale-detail.png" });
          failed = false;
          await s.page.locator('::-p-aria(Try again[role="button"])').click();
          await s.page.waitForFunction(
            () =>
              !document.body.innerText.includes("Showing last known") &&
              document.querySelector('svg[aria-label="Daily cost by coding agent"]') !== null,
          );
          await s.page.locator('::-p-aria(Earlier history[role="button"])').click();
          await s.page.waitForFunction(() =>
            document.body.innerText.includes("No earlier history is recorded for this period."),
          );
          expect(await s.page.evaluate(() => document.body.innerText)).not.toContain(
            "agents and subagents running in Mate",
          );
          await s.page.screenshot({ path: "/tmp/usage-fix-slice3-earlier-empty.png" });
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
