// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- inspect the production assets the browser requests.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it, inject } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
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
    calendar: asset("src/components/ui/calendar.tsx"),
    terminal: asset("src/terminal/ghostty/surface.ts"),
    helpers: asset("src/components/AgentsPanel.tsx"),
    data: asset("src/components/zerops/ZeropsDataPanel.tsx"),
    crew: asset("src/components/zerops/crew/CrewPanel.tsx"),
    change: asset("src/components/zerops/review/ZeropsChangeReview.tsx"),
  };
}

describe("H: production surface demand", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("sign-in, menu and a plain conversation do not download unopened surfaces", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        chat.fixture().history();
        const assets = deferredAssets();
        const requested = new Set<string>();
        s.page.on("request", (request) => requested.add(new URL(request.url()).pathname));
        yield* s.given.signedIn;
        for (const [surface, asset] of Object.entries(assets))
          expect(requested.has(asset), `${surface} downloaded before a conversation opened`).toBe(
            false,
          );
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        for (const [surface, asset] of Object.entries(assets))
          expect(requested.has(asset), `${surface} downloaded in a plain conversation`).toBe(false);

        yield* Effect.promise(async () => {
          await s.page.locator("::-p-aria(Toggle right panel)").click();
          await s.page.locator('[aria-label="Open a surface"] ::-p-text(Helpers)').click();
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
          await s.page.waitForSelector('[data-theme-editor-panel][role="dialog"]');
        });
        expect(requested.has(assets.theme), "The theme shortcut must load the editor").toBe(true);
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("opening Usage downloads its route, leaving Appearance deferred", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        yield* s.given.signedIn;
        const assets = deferredAssets();
        const requested = new Set<string>();
        s.page.on("request", (request) => requested.add(new URL(request.url()).pathname));
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
