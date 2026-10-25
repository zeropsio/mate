import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { menuMateRow } from "../../harness/browser.ts";
import { installArea } from "../c-mate/fake.ts";
import { mateChat } from "../c-mate/dsl.ts";

describe("Scenario menu rows", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a Mate row in a folded group is pressed where it stands once the group unfolds",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true, app: "Shop" });
          yield* s.given.project("Bea", { mate: true, app: "Shop" });
          mateChat(s).fixture("Bea").history("Bea's conversation");
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            // The group's unfold, ten times slower: a press while its rows still move misses them.
            const animations = await s.page.createCDPSession();
            await animations.send("Animation.enable");
            await animations.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
            await (await menuMateRow(s.page, "Bea")).click();
            await s.page.waitForFunction(() => location.pathname === "/env-Bea/thread-Bea");
          });
        }),
    );
  });
});
