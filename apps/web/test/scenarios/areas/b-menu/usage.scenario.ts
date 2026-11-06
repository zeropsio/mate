// @effect-diagnostics preferSchemaOverJson:off -- controlled report inputs on the existing scenario wire.
import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect } from "@effect/vitest";
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
            s.given.person("owner", { role: "OWNER", grants: { Ada: "OWNER" } });
            s.given.person("admin", { role: "ADMIN" });
            s.given.person("dev", { role: "Developer", grants: { Bea: "OWNER" } });
            yield* s.given.project("Ada", { mate: true, app: "Shop" });
            yield* s.given.project("Bea", { mate: true, app: "Lab" });
            for (const name of ["Ada", "Bea"]) {
              const registration = yield* s.drivers.core.call("GET", "/api/mate/self", {
                headers: { authorization: `Project mate-key-${name}` },
              });
              expect(registration.status).toBe(200);
            }
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
              const rows = [
                { name: "Ada", owner: "owner", app: "Shop", provider: "claude" },
                { name: "Bea", owner: "dev", app: "Lab", provider: "codex" },
              ] as const;
              const selected = rows.filter(
                (row) => query.ownerUserId === null || query.ownerUserId === row.owner,
              );
              const count = empty ? 0 : selected.length;
              const report = recordedReport({
                query,
                provenance: query.provenance ?? "live-responses",
                totals: statistics(String(count * 1000), String(count)),
                pricing: {
                  ...recordedReport().pricing,
                  costUsdNanos: String(count * 1000000000),
                  pricedModelEntries: String(count),
                },
                coverage: selected.map(({ name, owner, app }) => ({
                  ...recordedReport().coverage[0]!,
                  originId: name,
                  mateId: name,
                  label: name,
                  appId: s.appIds.get(app)!,
                  ownerUserId: owner,
                })),
                groups: empty
                  ? []
                  : selected.map(({ name, provider }) => ({
                      key: name,
                      provider,
                      model: "recorded-model",
                      period: (query.since ?? "2026-10-01").slice(0, 10),
                      totals: statistics(),
                      costUsdNanos: "1000000000",
                    })),
              });
              return JSON.stringify({ ...message, values: [{ key: "report", value: report }] });
            });
            s.given.asPerson(check === "filters" ? "owner" : "admin");
            yield* s.given.signedIn;
            yield* Effect.promise(async () => {
              await s.page.setViewport({ width: 320, height: 740 });
              await s.page.goto(`${s.web.origin}/usage`);
              await s.page.locator("::-p-aria(Usage metric)").click();
              await s.page.locator('::-p-aria(Cost[role="option"])').click();
              await s.page.waitForFunction(() => /\b[12] turns?\b/u.test(document.body.innerText));
              if (check === "filters") {
                expect(await s.page.evaluate(() => document.body.innerText)).toContain("2 turns");
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
                expect(await s.page.evaluate(() => document.body.innerText)).toContain("2 turns");
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
