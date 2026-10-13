import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { SharedScenario, sharedScenarioLayer } from "../../harness/sharedScenario.ts";

describe("Opt-in read-only scenario stack", () => {
  let preparations = 0;
  let origin: string;
  const stack = sharedScenarioLayer((s) =>
    Effect.gen(function* () {
      preparations++;
      origin = s.web.origin;
      yield* s.given.project("Ada", { mate: true });
      yield* s.given.signedIn;
    }),
  ).pipe(Layer.provide(tempPostgresLayer));

  it.layer(stack, { excludeTestServices: true })((it) => {
    it.effect("a read-only case reads the once-prepared shared stack", () =>
      Effect.gen(function* () {
        const s = yield* SharedScenario;
        expect(preparations).toBe(1);
        expect(s.web.origin).toBe(origin);
        yield* s.then.menu.row("Ada").appears();
      }),
    );
    it.effect("another read-only case reuses the live stack without preparing it again", () =>
      Effect.gen(function* () {
        const s = yield* SharedScenario;
        expect(preparations).toBe(1);
        expect(s.web.origin).toBe(origin);
        expect(s.page.isClosed()).toBe(false);
        yield* s.then.menu.row("Ada").appears();
      }),
    );
  });
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("ordinary scenarios keep their own ports, database, browser context and world", () =>
      Effect.gen(function* () {
        const s = yield* createScenario();
        yield* s.given.project("Ada", { mate: true });
        const isolated = yield* createScenario();
        expect(isolated.web.origin).not.toBe(s.web.origin);
        expect(isolated.drivers.core.url).not.toBe(s.drivers.core.url);
        expect(isolated.page.browserContext().id).not.toBe(s.page.browserContext().id);
        expect(isolated.drivers.zerops.world.projects.some((project) => project.id === "Ada")).toBe(
          false,
        );
      }),
    );
  });
});
