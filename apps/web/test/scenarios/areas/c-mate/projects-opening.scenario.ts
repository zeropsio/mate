import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";

// Decision: the owner asked for the review and its fixes; existing flows are reused, no new concepts.
describe("Projects entry points", () => {
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
