import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { ZeropsDataConsoleResponse } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

describe("C: service data detail", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "SQL pages arriving after first paint preserve exact rows and Back returns to the table",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history();
          wire.databaseCatalog();
          Object.assign(wire.mate.config.environment.capabilities, { dataConsole: true });
          Object.assign(wire.mate.descriptor.capabilities!, { dataConsole: true });
          if (wire.database.kind !== "services") throw new Error("Expected service inventory");
          wire.database = {
            ...wire.database,
            services: wire.database.services.map((service) => ({
              ...service,
              family: "tabular",
              actions: [
                ...service.actions,
                { id: "querySQL", enabled: true, readOnly: true, reason: "" },
              ],
            })),
          };
          const page = (
            rows: readonly (readonly number[])[],
            nextCursor = "",
          ): ZeropsDataConsoleResponse => ({
            kind: "table",
            page: {
              columns: [
                {
                  name: "id",
                  dataType: "int4",
                  pk: true,
                  editable: false,
                  reason: "Read only",
                  sortable: true,
                  sortReason: "",
                },
              ],
              rows,
              nextCursor,
              rowKeyCols: ["id"],
              bestEffort: false,
              numbered: false,
            },
          });
          wire.databaseReplies.set("table", page([[700]]));
          wire.databaseReplies.set("summary", {
            kind: "summary",
            maskedConnection: "postgresql://reader:••••@ordersdb:5432/app",
          });
          wire.databaseReplies.set("stat", {
            kind: "node",
            node: {
              name: "orders",
              kind: "tabular",
              path: { service: "ordersdb", segments: ["public", "orders"] },
              hasChildren: false,
            },
          });
          wire.databaseReplies.set(
            "query",
            page(
              Array.from({ length: 100 }, (_, index) => [index + 1]),
              "100",
            ),
          );
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.text("The existing conversation is still here");
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.locator("::-p-aria(Toggle right panel)").click();
            await s.page.locator('[aria-label="Open a surface"] ::-p-text(Data)').click();
            await s.page.locator('[data-zerops-data-service="ordersdb"]').click();
            await s.page.waitForSelector("[data-zerops-data-tree-node]");
            const separator = await s.page.evaluate(() =>
              [...document.querySelectorAll('[role="separator"]')]
                .map((e) => e.getBoundingClientRect().toJSON())
                .find((r) => r.height > 900),
            );
            if (!separator) throw new Error("Expected panel resize handle");
            await s.page.mouse.move(separator.x + separator.width / 2, 400);
            await s.page.mouse.down();
            await s.page.mouse.move(1786 - 435, 400);
            await s.page.mouse.up();
            await s.page.locator("[data-zerops-data-tree-node]").click();
            await s.page.waitForFunction(
              () =>
                document.querySelector("[data-zerops-data-table-row]")?.textContent?.trim() ===
                "700",
            );
            const capture = async (name: string) => {
              const output = process.env.MATE_DATA_PANEL_EVIDENCE;
              if (!output) return;
              await s.page.screenshot({ path: `${output}/${name}-full.png` });
              const panel = await s.page.$('[data-zerops-data-panel="service"]');
              await panel!.screenshot({ path: `${output}/${name}.png` });
            };
            await capture("table-435");
            await s.page.locator("[data-zerops-data-filter-add]").click();
            await s.page.locator("[data-zerops-data-filter-value]").fill("700");
            expect(await s.page.$("[data-zerops-data-filter-raw-toggle]")).toBeNull();
            await capture("filter-draft-435");
            wire.databaseReplies.set("query", page([[700]]));
            await s.page.locator("[data-zerops-data-filter-apply]").click();
            await s.page.waitForSelector("[data-zerops-data-table-filtered]");
            expect(
              await s.page.$eval("[data-zerops-data-table-row]", (e) => e.textContent?.trim()),
            ).toBe("700");
            await capture("filtered-435");
            await s.page.locator("[data-zerops-data-filter-clear]").click();
            await s.page.waitForSelector("[data-zerops-data-table-filtered]", { hidden: true });
            wire.databaseReplies.set(
              "query",
              page(
                Array.from({ length: 100 }, (_, index) => [index + 1]),
                "100",
              ),
            );
            await s.page.locator("[data-zerops-data-query-toggle]").click();
            await s.page
              .locator("[data-zerops-data-query-input]")
              .fill("SELECT id FROM orders ORDER BY id");
            const held = wire.holdDataReply("query");
            await s.page.locator("[data-zerops-data-query-submit]").click();
            await held.requested();
            expect(
              await s.page.$eval(
                "[data-zerops-data-query-submit]",
                (e) => (e as HTMLButtonElement).disabled,
              ),
            ).toBe(true);
            expect(
              await s.page.$eval("[data-zerops-data-table-row]", (e) => e.textContent?.trim()),
            ).toBe("700");
            await capture("query-pending-435");
            held.release();
            await s.page.waitForFunction(
              () =>
                document.querySelector("[data-zerops-data-table-row]")?.textContent?.trim() === "1",
            );
            expect(
              await s.page.$$eval("[data-zerops-data-table-row]", (rows) =>
                rows.map((e) => Number(e.textContent?.trim())),
              ),
            ).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
            await capture("query-435");
            wire.databaseReplies.set("query", page([[101]]));
            await s.page.locator("[data-zerops-data-next-page]").click();
            await s.page.waitForFunction(
              () =>
                document.querySelector("[data-zerops-data-table-row]")?.textContent?.trim() ===
                "101",
            );
            expect(
              await s.page.$$eval("[data-zerops-data-table-row]", (rows) =>
                rows.map((e) => Number(e.textContent?.trim())),
              ),
            ).toEqual([101]);
            await s.page.locator("[data-zerops-data-query-back]").click();
            await s.page.waitForFunction(
              () =>
                document.querySelector("[data-zerops-data-table-row]")?.textContent?.trim() ===
                "700",
            );
            await s.page.locator("[data-zerops-data-maximize]").click();
            await s.page.waitForSelector('[data-zerops-data-layout="wide"]');
            await capture("table-wide");
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
