import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { menuMateRow } from "../../harness/browser.ts";
import { throughEachHqInstance } from "../../harness/hqCore.ts";
import { createScenario } from "../../harness/scenario.ts";
import { scenarioSuite } from "../../harness/suite.ts";
import { eachInstanceShowsAda, ownerSignsInAdasAgent } from "../c-mate/dsl.ts";
import { installSignIn } from "./fake.ts";

describe("A: sign-in against every HQ instance", () => {
  scenarioSuite((it) => {
    // witness: apps/web/src/components/zerops/SidebarZeropsAccount.tsx | <span className="menu-foot-name">{lines.name}</span> → <span className="menu-foot-name">{null}</span>
    it.effect("a person signs in through either HQ instance and gets their account's menu", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installSignIn], { signIn: "ui" });
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        const names: string[] = [];
        yield* throughEachHqInstance(s, () =>
          Effect.gen(function* () {
            const actor = yield* s.given.browserActor({ person: "owner" });
            yield* actor.given.signedIn;
            yield* Effect.promise(() => menuMateRow(actor.page, "Ada"));
            names.push(
              yield* Effect.promise(() =>
                actor.page.$eval(
                  '[data-zerops-surface="sidebar-account"] .menu-foot-name',
                  (name) => name.textContent ?? "",
                ),
              ),
            );
          }),
        );
        expect(names, "ASSERTION: each instance's sign-in names the person").toEqual([
          "owner",
          "owner",
        ]);
      }),
    );

    // witness: apps/web/src/components/ChatView.tsx | ownerName: admissionOwner.called, → ownerName: "nobody",
    it.effect(
      "a colleague reads along with another member's signed-in agent, whichever HQ instance answers",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* ownerSignsInAdasAgent(s);
          const looks = yield* eachInstanceShowsAda(s, "dev");
          expect(
            looks.map((look) => look.gate),
            "ASSERTION: each instance's page gives the colleague the signer's Mate to read",
          ).toEqual([
            "Ada is owner's Mate — you can read along.",
            "Ada is owner's Mate — you can read along.",
          ]);
        }),
    );
  });
});
