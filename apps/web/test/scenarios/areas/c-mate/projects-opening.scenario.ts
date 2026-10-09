import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";
import { reportConversation } from "../b-menu/fake.ts";

describe("opening a Mate from the projects page", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a project's Mate chip opens that Mate's conversation", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* Effect.promise(async () => {
          await s.page.goto(`${s.web.origin}/zerops`);
          const chip = '[data-zerops-surface="project-rows"] [aria-label="Open Ada"]';
          await expect
            .poll(
              () =>
                s.page.evaluate(
                  (selector) => ({
                    found: document.querySelector(selector) !== null,
                    text:
                      document.querySelector('[data-zerops-surface="project-rows"]')?.textContent ??
                      document.body.innerText,
                  }),
                  chip,
                ),
              { timeout: 8_000 },
            )
            .toMatchObject({ found: true })
            .catch(async (cause: unknown) => {
              throw new Error(await s.page.evaluate(() => document.body.innerText), { cause });
            });
          await s.page.locator(chip).click();
          await expect
            .poll(() => new URL(s.page.url()).pathname, { timeout: 8_000 })
            .toBe("/env-Ada/thread-Ada");
        });
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});

describe("Projects source states", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "Projects shows the Mate's limit, latest outcome and missing sign-in from its records",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          const wire = mateChat(s).fixture();
          wire.run("limited", "error", "Claude usage limit reached");
          yield* reportConversation(
            s.drivers,
            "Ada",
            {
              session: wire.mate.thread.session ?? null,
              latestTurn: wire.mate.thread.latestTurn ?? null,
            },
            "failed",
          );
          yield* s.given.signedIn;
          const rows = '[data-zerops-surface="project-rows"]';
          const capture = (name: string, words: string) =>
            Effect.promise(async () => {
              await expect
                .poll(() => s.page.$eval(rows, (element) => element.textContent), {
                  timeout: 8_000,
                })
                .toContain(words);
              if (process.env.PROJECTS_EVIDENCE) {
                await s.page.screenshot({
                  path: `${process.env.PROJECTS_EVIDENCE}-${name}-full.png`,
                  fullPage: true,
                });
                await (await s.page.$(rows))!.screenshot({
                  path: `${process.env.PROJECTS_EVIDENCE}-${name}.png`,
                });
              }
            });
          yield* capture("limit", "Ada hit the Claude limit.");
          wire.run("finished", "completed");
          yield* reportConversation(s.drivers, "Ada", {
            session: wire.mate.thread.session ?? null,
            latestTurn: wire.mate.thread.latestTurn ?? null,
            latestUserMessagePreview: { text: "Redesign checkout" },
            latestMessagePreview: {
              role: "assistant",
              text: "Checkout is redesigned and verified.",
            },
          });
          yield* capture("outcome", "Checkout is redesigned and verified.");
          yield* s.drivers.links.get("Ada")!.send({
            type: "overview",
            full: true,
            overview: {
              identity: {
                environmentId: wire.mate.descriptor.environmentId,
                serverVersion: "0.14.35",
                update: null,
              },
              main: null,
              threads: { list: [], omitted: 0 },
              crew: { status: "off" },
              logins: { "claude-code": { present: false, signedInBy: null, token: false } },
            },
          });
          yield* capture("sign-in", "Sign in");
          yield* s.then.noExternalNetwork;
        }),
    );
    it.effect(
      "account verification failure separates Verify again from Sign out without a storage claim",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario();
          yield* s.given.signedIn;
          s.drivers.zerops.faults.set("GET /user/info", { status: 503 });
          yield* Effect.promise(async () => {
            await s.page.reload();
            await s.page.waitForSelector("::-p-text(Could not verify your account)", {
              visible: true,
              timeout: 15_000,
            });
            const geometry = await s.page.evaluate(() => {
              const buttons = [...document.querySelectorAll("button")];
              const retry = buttons
                .find((button) => button.textContent === "Verify again")!
                .getBoundingClientRect();
              const signOut = buttons
                .find((button) => button.textContent === "Sign out")!
                .getBoundingClientRect();
              return {
                right: retry.right,
                left: signOut.left,
                retryTop: retry.top,
                signOutTop: signOut.top,
                text: document.body.innerText,
              };
            });
            expect(geometry.right).toBeLessThan(geometry.left);
            expect(geometry.retryTop).toBe(geometry.signOutTop);
            expect(geometry.text).not.toContain("on this device");
            if (process.env.PROJECTS_EVIDENCE) {
              await s.page.screenshot({
                path: `${process.env.PROJECTS_EVIDENCE}-recovery-full.png`,
                fullPage: true,
              });
              const heading = await s.page.$("h1");
              const panel = await heading!.evaluateHandle((element) => element.parentElement!);
              await panel
                .asElement()!
                .screenshot({ path: `${process.env.PROJECTS_EVIDENCE}-recovery.png` });
            }
          });
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
