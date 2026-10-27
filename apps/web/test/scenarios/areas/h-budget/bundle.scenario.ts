// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- inspect the production assets the browser requests.
import { scenarioSuite } from "../../harness/suite.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, inject } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { SETTLE_MS } from "../../../../src/lib/appChunks.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "../c-mate/fake.ts";
import { mateChat } from "../c-mate/dsl.ts";

function deferredAssets() {
  const manifest = JSON.parse(
    NodeFS.readFileSync(NodePath.join(inject("scenarioDist"), ".vite/manifest.json"), "utf8"),
  ) as Record<string, { file: string; name?: string }>;
  const asset = (key: string) => {
    const name = NodePath.basename(key, ".tsx").replace(/\.ts$/u, "");
    const matching = Object.values(manifest).filter((chunk) => chunk.name === name);
    const chunk = manifest[key] ?? (matching.length === 1 ? matching[0] : undefined);
    if (!chunk) throw new Error(`Surface is no longer deferred: ${key}`);
    return `/${chunk.file}`;
  };
  return {
    usage: asset("src/routes/usage.tsx?tsr-split=component"),
    settings: asset("src/routes/settings.appearance.tsx?tsr-split=component"),
    theme: asset("src/components/settings/ThemeEditorPanel.tsx"),
    terminal: asset("src/terminal/ghostty/surface.ts"),
    helpers: asset("src/components/AgentsPanel.tsx"),
    data: asset("src/components/zerops/ZeropsDataPanel.tsx"),
    crew: asset("src/components/zerops/crew/CrewPanel.tsx"),
    change: asset("src/components/zerops/review/ZeropsChangeReview.tsx"),
  };
}

/**
 * The page's requests, by path, and a wait until every one of `paths` has been asked for: the
 * request is the receipt, never a window of time.
 */
function requestsOf(page: Effect.Success<ReturnType<typeof createScenario>>["page"]) {
  const requested = new Set<string>();
  const waiting = new Set<() => void>();
  page.on("request", (request) => {
    requested.add(new URL(request.url()).pathname);
    for (const check of waiting) check();
  });
  const all = (paths: ReadonlyArray<string>) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (!paths.every((path) => requested.has(path))) return;
        waiting.delete(check);
        resolve();
      };
      waiting.add(check);
      check();
    });
  return { requested, all };
}

describe("H: production surface demand", () => {
  scenarioSuite((it) => {
    // The app warms every surface once the page has settled (`appChunks.ts`), so a tab open
    // across a deploy still opens them: until then, nothing unopened is downloaded.
    it.effect(
      "sign-in, menu and a plain conversation do not download unopened surfaces before the page settles",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          chat.fixture().history();
          const assets = deferredAssets();
          const { requested, all } = requestsOf(s.page);
          yield* Effect.promise(() => s.clock.install());
          yield* s.given.signedIn;
          for (const [surface, asset] of Object.entries(assets))
            expect(requested.has(asset), `${surface} downloaded before a conversation opened`).toBe(
              false,
            );
          yield* chat.when.open();
          yield* chat.then.text("The existing conversation is still here");
          for (const [surface, asset] of Object.entries(assets))
            expect(requested.has(asset), `${surface} downloaded in a plain conversation`).toBe(
              false,
            );

          yield* Effect.promise(async () => {
            await s.page.locator("::-p-aria(Toggle right panel)").click();
            await s.page.locator('[aria-label="Open a page"] ::-p-text(Helpers)').click();
            await s.clock.advanceStepped(1_000);
            await s.page.waitForFunction(() => document.body.innerText.includes("No helpers yet"));
          });
          expect(requested.has(assets.helpers), "Opening Helpers must load its module").toBe(true);
          expect(requested.has(assets.terminal)).toBe(false);
          expect(requested.has(assets.crew)).toBe(false);

          yield* Effect.promise(async () => {
            const modifier = await s.page.evaluate(() =>
              navigator.platform.includes("Mac") ? "Meta" : "Control",
            );
            await s.page.keyboard.down(modifier);
            await s.page.keyboard.down("Alt");
            await s.page.keyboard.down("Shift");
            await s.page.keyboard.press("KeyT");
            await s.page.keyboard.up("Shift");
            await s.page.keyboard.up("Alt");
            await s.page.keyboard.up(modifier);
            // The page takes the shortcut: the editor's stand-in opens while its chunk loads.
            await s.page.waitForSelector(
              '[data-theme-editor-loading][role="dialog"], [data-theme-editor-panel][role="dialog"]',
            );
            // The stand-in asked for the chunk itself, before anything else could.
            await all([assets.theme]);
            // The chunk has run: importing it again answers from the page's module map. A string,
            // since the test's transform would rewrite an `import()` written as a function.
            await s.page.evaluate(`import(${JSON.stringify(assets.theme)}).then(() => {})`);
            // React shows a lazy surface no sooner than 300 ms after its stand-in, on the page's
            // timers, so that time passes on the scenario clock until the editor says it is open.
            while (!(await s.page.$('[data-theme-editor-panel][role="dialog"]')))
              await s.clock.advanceStepped(300);
          });
          expect(requested.has(assets.theme), "The theme shortcut must load the editor").toBe(true);

          // The page settles: the warmer fetches every surface it has not opened.
          yield* Effect.promise(() => s.clock.advance(SETTLE_MS));
          yield* Effect.promise(() => all(Object.values(assets)));
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect("opening Usage downloads its route, leaving Appearance deferred", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        // The page never settles here: what Usage downloads is its own, not the warmer's.
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        const assets = deferredAssets();
        const { requested } = requestsOf(s.page);
        yield* Effect.promise(async () => {
          await s.page.goto(`${s.web.origin}/usage`);
          await s.page.waitForFunction(() => document.body.innerText.includes("Usage"));
        });
        expect(requested.has(assets.usage)).toBe(true);
        expect(requested.has(assets.settings)).toBe(false);
        expect(requested.has(assets.theme)).toBe(false);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
