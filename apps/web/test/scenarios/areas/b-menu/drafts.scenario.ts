import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { menuScenario } from "./dsl.ts";
import { dropZerops } from "../g-outage/fake.ts";
import { lastingZeropsOutage } from "../g-outage/dsl.ts";

describe("B: text-only drafts", () => {
  scenarioSuite((it) => {
    it.effect(
      "a resized menu preserves its Mate rows and footer room through account failure and recovery",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* s.given.project("Ada", { mate: true, app: "Imperial Titan" });
          yield* s.given.project("Bea", { mate: true, app: "Imperial Titan" });
          yield* Effect.promise(() => s.clock.install());
          yield* s.given.signedIn;
          yield* s.colleague.reports("Ada", {
            latestUserMessageAt: "2020-01-01T00:00:00Z",
            updatedAt: "2020-01-01T00:00:00Z",
          });
          yield* s.colleague.reports("Bea", {
            latestUserMessageAt: "2020-01-01T00:00:00Z",
            updatedAt: "2020-01-01T00:00:00Z",
          });
          for (const name of ["Ada", "Bea"]) {
            yield* s.drivers.links.get(name)!.send(
              yield* Schema.encodeEffect(MateLinkUp)({
                type: "overview",
                full: false,
                sections: {
                  logins: { codex: { present: true, token: true, signedInBy: null } },
                },
              }),
            );
          }
          // This is the account's persisted local input, restored through the production decoder.
          // The environment is outside the roster: roster-owned drafts have their own row.
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await s.page.evaluate(() => {
              const prefix = "mate:account:owner:t3code:composer-drafts:v2";
              const loaded = document.createElement("canvas").toDataURL("image/png");
              localStorage.setItem(prefix, "8");
              localStorage.setItem(
                `${prefix}:draftsByThreadKey:draft-menu`,
                JSON.stringify({
                  prompt: "Liu opened Zerops Mate on this project.\n![missing](missing.png)",
                  attachments: [
                    {
                      id: "loaded",
                      name: "loaded.png",
                      mimeType: "image/png",
                      sizeBytes: 1,
                      dataUrl: loaded,
                    },
                    {
                      id: "missing",
                      name: "missing.png",
                      mimeType: "image/png",
                      sizeBytes: 1,
                      dataUrl: "data:image/png;base64,aW52YWxpZA==",
                    },
                  ],
                }),
              );
              localStorage.setItem(
                `${prefix}:draftThreadsByThreadKey:draft-menu`,
                JSON.stringify({
                  threadId: "draft-menu",
                  environmentId: "previous-environment",
                  projectId: "workspace",
                  createdAt: "2026-10-08T00:00:00Z",
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  envMode: "local",
                }),
              );
            });
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForSelector('[data-testid="sidebar-draft-row"]');
            const row = await s.page.$eval('[data-testid="sidebar-draft-row"]', (element) => ({
              text: element.textContent,
              media: element.querySelectorAll("img, .asset-image-frame, .asset-image-unavailable")
                .length,
            }));
            expect(row.text).toContain("Liu opened Zerops Mate on this project.");
            expect(row.text).not.toContain("Image unavailable");
            expect(row.text).not.toContain("Try again");
            expect(row.media).toBe(0);
            // Both Mates stand in the menu as rows: none rests apart as "quiet" (the owner,
            // 2026-10-11).
            await s.page.waitForFunction(() => {
              // Their project's group, opened as a person would: → on its row.
              for (const group of document.querySelectorAll<HTMLElement>(
                '[data-zerops-surface="sidebar-project"][aria-expanded="false"]',
              )) {
                group.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
                );
              }
              const lines =
                document
                  .querySelector<HTMLElement>('[data-zerops-surface="sidebar-environments"]')
                  ?.innerText.split("\n")
                  .flatMap((line) => line.split(/\s·\s/))
                  .map((line) => line.trim()) ?? [];
              return lines.includes("Ada") && lines.includes("Bea");
            });
            const rail = await s.page.$('[data-sidebar="rail"]');
            const box = (await rail!.boundingBox())!;
            const width = await s.page.$eval(
              '[data-sidebar="sidebar"]',
              (element) => element.getBoundingClientRect().width,
            );
            await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await s.page.mouse.down();
            await s.page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2, {
              steps: 5,
            });
            await s.page.mouse.up();
            await s.page.waitForFunction(
              () =>
                document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect()
                  .width === 435,
            );
            if (process.env.MENU_DRAFT_EVIDENCE) {
              for (const theme of ["light", "dark"]) {
                await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
                await s.page.waitForFunction(
                  (dark) => document.documentElement.classList.contains("dark") === dark,
                  {},
                  theme === "dark",
                );
                await s.page.screenshot({
                  path: `${process.env.MENU_DRAFT_EVIDENCE}/${theme}.png`,
                  clip: { x: 0, y: 0, width: 435, height: 1000 },
                });
              }
            }
          });
          const geometry = () =>
            s.page.evaluate(() =>
              ["[data-sidebar='footer']", "[data-sidebar='content']"].map((selector) => {
                const box = document.querySelector(selector)!.getBoundingClientRect();
                return { y: box.y, height: box.height };
              }),
            );
          // The groups the witness opened unfold over 220 ms: measure the menu once they stand.
          yield* Effect.promise(() =>
            s.page.waitForFunction(() =>
              [...document.querySelectorAll('[data-zerops-surface="sidebar-project-rows"]')].every(
                (fold) => fold.getAnimations().length === 0,
              ),
            ),
          );
          const before = yield* Effect.promise(geometry);
          yield* dropZerops(s.drivers);
          yield* lastingZeropsOutage(s);
          const after = yield* Effect.promise(geometry);
          expect(
            Math.max(
              ...after.flatMap((box, index) => [
                Math.abs(box.y - before[index]!.y),
                Math.abs(box.height - before[index]!.height),
              ]),
            ),
            "ASSERTION: account failure and recovery preserve footer room",
          ).toBeLessThanOrEqual(4);
          s.drivers.zerops.handlers.pop();
          s.drivers.zerops.faults.delete("POST /web-socket/login");
          yield* Effect.promise(async () => {
            await s.page.locator("::-p-aria(Try now)").click();
            await s.page.waitForFunction(
              () => document.querySelector('[data-zerops-surface="sidebar-account-line"]') === null,
            );
          });
          const recovered = yield* Effect.promise(geometry);
          expect(
            Math.max(
              ...recovered.flatMap((box, index) => [
                Math.abs(box.y - before[index]!.y),
                Math.abs(box.height - before[index]!.height),
              ]),
            ),
            "ASSERTION: account failure and recovery preserve footer room",
          ).toBeLessThanOrEqual(4);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
