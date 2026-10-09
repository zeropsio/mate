// @effect-diagnostics preferSchemaOverJson:off -- controlled report inputs on the existing scenario wire.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { HqStreamMessage } from "@t3tools/shared/hqStream";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { recordedReport, statistics } from "../../../../src/components/usage/usageTestFixtures.ts";

describe("B: Usage report presentation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("Usage displays a partial sub-cent estimate and the recorded daily date", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        s.drivers.hq.mapFrames((frame) => {
          const message = JSON.parse(frame) as HqStreamMessage;
          if (
            (message.type !== "scope-reset" && message.type !== "scope-values") ||
            message.scope.kind !== "agentUsage"
          )
            return frame;
          const query = message.scope.query;
          const report = recordedReport({
            query,
            provenance: query.provenance ?? "live-responses",
            totals: statistics("920000", "22"),
            pricing: {
              ...recordedReport().pricing,
              costUsdNanos: "949000",
              pricedModelEntries: "1",
              unpricedModelEntries: "21",
            },
            groups: [
              {
                key: "fixture",
                provider: "claude",
                model: "claude-opus-5-5[1m]",
                period: (query.since ?? "2026-10-01").slice(0, 10),
                totals: statistics("920000", "22"),
                costUsdNanos: "949000",
                unpricedModelEntries: "21",
                unpricedTokens: "919000",
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
          await s.page.locator('::-p-aria(7 days[role="button"])').click();
          await s.page.waitForFunction(() =>
            document.body.innerText.includes("21 unpriced model entries excluded"),
          );
          await s.page.locator('::-p-aria(Day[role="button"])').click();
          const text = await s.page.evaluate(() => document.body.innerText);
          expect(text).toContain("<$0.01");
          expect(text).toContain("partial");
          const cell = await s.page.$eval("tbody td", (node) => node.textContent);
          expect(cell).toMatch(/^[A-Z][a-z]{2} \d/);
          await s.page.screenshot({ path: "/tmp/usage-fix-slice1.png" });
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
