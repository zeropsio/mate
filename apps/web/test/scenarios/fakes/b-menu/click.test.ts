import { inject, vi } from "vite-plus/test";
import { expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import puppeteer, { ElementHandle } from "puppeteer-core";
import * as Effect from "effect/Effect";
import { openEnvironment } from "../../areas/b-menu/dsl.ts";

it.effect(
  "opening an environment clicks its replacement row after a render between selection and click",
  () =>
    Effect.gen(function* () {
      const browser = yield* Effect.promise(() =>
        puppeteer.connect({ browserWSEndpoint: inject("scenarioBrowserEndpoint") }),
      );
      const context = yield* Effect.promise(() => browser.createBrowserContext());
      const click = ElementHandle.prototype.click;
      let replaced = false;
      try {
        const page = yield* Effect.promise(async () => {
          const page = await context.newPage();
          await page.setRequestInterception(true);
          page.on("request", (request) => {
            void request.respond({ status: 200, contentType: "text/html", body: "<main></main>" });
          });
          await page.goto("http://localhost/group/shop/flow");
          await page.setContent(`
      <main><section><h2>Environments</h2>
        <button data-zerops-environment-id="other"><span>Production</span></button>
        <button data-zerops-environment-id="stage-project"><span>Preview</span></button>
      </section></main>
      <script>
        document.addEventListener('click', event => {
          const button = event.target.closest('button');
          if (button?.dataset.generation === 'replacement') {
            history.pushState({}, '', '/group/shop/stage-service');
          }
        });
      </script>
    `);
          vi.spyOn(ElementHandle.prototype, "click").mockImplementation(async function (
            this: ElementHandle<Element>,
            options,
          ) {
            // Change the DOM precisely after selection and before native input, without a timer.
            if (!replaced) {
              replaced = true;
              await page.evaluate(() => {
                const row = document.querySelector('[data-zerops-environment-id="stage-project"]')!;
                const replacement = row.cloneNode(true) as HTMLElement;
                replacement.dataset.generation = "replacement";
                row.replaceWith(replacement);
              });
            }
            return click.call(this, options);
          });
          return page;
        });
        const outcome = yield* openEnvironment(page, "shop", "Preview", "stage-service").pipe(
          Effect.matchCause({ onSuccess: () => "opened", onFailure: Cause.pretty }),
        );
        expect(
          outcome,
          "ASSERTION: opening an environment survives a row replacement before native input",
        ).toBe("opened");
        expect(replaced).toBe(true);
        expect(new URL(page.url()).pathname).toBe("/group/shop/stage-service");
      } finally {
        vi.restoreAllMocks();
        yield* Effect.promise(async () => {
          await context.close();
          await browser.disconnect();
        });
      }
    }),
);
