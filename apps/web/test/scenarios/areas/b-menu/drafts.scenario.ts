import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { MateLinkUp } from "@t3tools/shared/mateLink";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { menuScenario } from "./dsl.ts";

describe("B: text-only drafts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a restored draft previews text without displaying its loaded or missing pictures",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* s.given.project("Ada", { mate: true, app: "Imperial Titan" });
          yield* s.given.project("Bea", { mate: true, app: "Imperial Titan" });
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
              const branch = sessionStorage.getItem("mate:draft-tab:v1")!;
              const prefix = "mate:account:owner:t3code:composer-drafts:v1";
              const loaded = document.createElement("canvas").toDataURL("image/png");
              localStorage.setItem(
                `${prefix}:tab:${branch}`,
                JSON.stringify({
                  version: 8,
                  state: {
                    draftsByThreadKey: {
                      "draft-menu": {
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
                      },
                    },
                    draftThreadsByThreadKey: {
                      "draft-menu": {
                        threadId: "draft-menu",
                        environmentId: "previous-environment",
                        projectId: "workspace",
                        createdAt: "2026-10-08T00:00:00Z",
                        runtimeMode: "full-access",
                        interactionMode: "default",
                        branch: null,
                        worktreePath: null,
                        envMode: "local",
                      },
                    },
                    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
                  },
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
            await s.page.waitForFunction(() => document.body.innerText.includes("2 quiet Mates"), {
              timeout: 8000,
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
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
