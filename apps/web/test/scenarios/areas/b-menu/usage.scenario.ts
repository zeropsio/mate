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
                  await s.page.screenshot({ path: `/tmp/usage-fix-slice2-geometry-${width}.png` });
                }
              }
              if (check === "filters")
                await s.page.screenshot({ path: "/tmp/usage-fix-slice2-filters-320.png" });
            });
            yield* s.then.noExternalNetwork;
          }),
      );
    }
    for (const state of ["reading", "unavailable", "stale", "unknown"] as const) {
      it.effect(`The model dialog presents its ${state} source record`, () =>
        Effect.gen(function* () {
          const s = yield* createScenario();
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          let modelReadFailed = false;
          const modelScopes = new Map<
            string,
            Extract<HqStreamMessage, { type: "scope-error" }>["scope"]
          >();
          s.drivers.hq.mapFrames((frame) => {
            const message = JSON.parse(frame) as HqStreamMessage;
            if (
              (message.type !== "scope-reset" && message.type !== "scope-values") ||
              message.scope.kind !== "agentUsage"
            )
              return frame;
            const query = message.scope.query;
            if (query.model != null) {
              modelScopes.set(JSON.stringify(message.scope), message.scope);
              if (modelReadFailed)
                return JSON.stringify({
                  type: "scope-error",
                  scope: message.scope,
                  code: "usage-test-unavailable",
                  reason: "fixture outage",
                  disposition: "transient",
                });
              if (state === "reading") return JSON.stringify({ type: "ping" });
              if (state === "unavailable")
                return JSON.stringify({
                  type: "scope-error",
                  scope: message.scope,
                  code: "usage-test-refused",
                  reason: "fixture refusal",
                  disposition: "refused",
                });
            }
            const report = recordedReport({
              query,
              provenance: query.provenance ?? "live-responses",
              totals: {
                ...statistics(),
                unknownComponents: query.model != null && state === "unknown" ? "1" : "0",
              },
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
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.goto(`${s.web.origin}/usage`);
            await s.page.locator('::-p-aria(Cost[role="button"])').click();
            await s.page.locator('::-p-aria(Open recorded-model[role="button"])').click();
            const dialog = await s.page.waitForSelector('[role="dialog"]');
            if (state === "stale") {
              await s.page.waitForFunction(() =>
                document.querySelector('[role="dialog"]')?.textContent?.includes("Tokens by type"),
              );
              modelReadFailed = true;
              for (const scope of modelScopes.values())
                for (const [client] of s.drivers.hq.links)
                  client.send(
                    JSON.stringify({
                      type: "scope-error",
                      scope,
                      code: "usage-test-unavailable",
                      reason: "fixture outage",
                      disposition: "transient",
                    }),
                  );
            }
            const message =
              state === "reading"
                ? "Reading model usage…"
                : state === "unavailable"
                  ? "Model usage could not be read."
                  : state === "stale"
                    ? "Showing last known model usage."
                    : "Token categories are unknown.";
            await s.page.waitForFunction(
              (message) =>
                document.querySelector('[role="dialog"]')?.textContent?.includes(message),
              {},
              message,
            );
            const text = await dialog!.evaluate((node) => node.textContent ?? "");
            if (state !== "unknown") expect(text).not.toContain("Token categories are unknown.");
            if (state === "unavailable" || state === "stale") expect(text).toContain("Try again");
            await dialog!.screenshot({ path: `/tmp/usage-fix-slice2-dialog-${state}.png` });
          });
          yield* s.then.noExternalNetwork;
        }),
      );
    }
  });
});
