import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import {
  givenOutage,
  reportsWork,
  menuSays,
  menuOmits,
  menuRowGone,
  caughtUp,
  catchingUp,
  zeropsGoesDown,
  heartbeatsWithoutFacts,
  corruptMate,
  checkpoint,
  opensMate,
  messageAppears,
  showsWokenTab,
} from "./dsl.ts";

describe("G: outages, sleep and several tabs", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches HQ downtime making a retained Mate impossible to open or send a message to.
    it.effect("HQ down: the menu holds and a Mate still opens and chats", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        const retained = yield* s.then.menu.keepsRows(["Shop", "Ada"]);
        yield* s.when.hq.socket.drops;
        yield* catchingUp(s);
        yield* opensMate(s);
        yield* s.then.conversation.appears;
        yield* s.when.conversation.sends("Inspect checkout while HQ is down");
        yield* messageAppears(s, "Inspect checkout while HQ is down");
        yield* retained;
        yield* checkpoint(s);
      }),
    );

    // Catches reconnect leaving the menu stuck on an application's pre-outage name.
    it.effect("HQ return reconciles a colleague's outage-time rename", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* s.when.hq.socket.drops;
        yield* catchingUp(s);
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop returned");
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() => s.clock.advance(30_000));
        yield* caughtUp(s, "Shop returned");
        yield* menuRowGone(s.page, "Shop");
        yield* checkpoint(s);
      }),
    );

    // Catches a second disconnect exhausting recovery or resurrecting an earlier application name.
    it.effect("two consecutive HQ outages each reconcile the latest name", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        for (const name of ["Shop first return", "Shop second return"]) {
          yield* s.when.hq.socket.drops;
          yield* catchingUp(s);
          yield* s.when.hq.colleague.renamesProject("Shop", name);
          yield* s.when.hq.socket.returns;
          yield* Effect.promise(() => s.clock.advance(30_000));
          yield* caughtUp(s, name);
        }
        yield* checkpoint(s);
      }),
    );

    // Catches a laptop wake leaving the pre-sleep menu frozen after HQ changed while asleep.
    it.effect("wake after an hour reconciles an HQ change without reloading", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* Effect.promise(() => s.clock.sleep());
        yield* s.when.hq.socket.drops;
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after wake");
        yield* s.when.hq.socket.returns;
        yield* Effect.promise(() => s.clock.wake(3_600_000));
        yield* showsWokenTab(s);
        yield* Effect.promise(() => s.clock.advance(30_000));
        yield* caughtUp(s, "Shop after wake");
        yield* checkpoint(s);
      }),
    );

    // Catches one signed-in tab missing a colleague's rename received by the other tab.
    it.effect("two tabs of one account both receive a live rename", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        const tab = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* tab.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* caughtUp(tab, "Shop");
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop in both tabs");
        yield* caughtUp(s, "Shop in both tabs");
        yield* caughtUp(tab, "Shop in both tabs");
        yield* tab.then.noReload;
        yield* checkpoint(s);
      }),
    );

    // Catches closing one tab tearing down the remaining tab's account or live subscriptions.
    it.effect("closing the second tab leaves the first receiving changes", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        const tab = yield* s.given.browserActor({ context: s.page.browserContext() });
        yield* tab.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* caughtUp(tab, "Shop");
        yield* Effect.promise(() => tab.page.close());
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop surviving tab");
        yield* caughtUp(s, "Shop surviving tab");
        yield* checkpoint(s);
      }),
    );

    // Catches losing the menu or an already connected conversation when Zerops realtime fails.
    it.effect("Zerops down preserves the menu and an open Mate's conversation", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* opensMate(s);
        yield* s.then.conversation.appears;
        const retained = yield* s.then.menu.keepsRows(["Shop", "Ada"]);
        yield* zeropsGoesDown(s);
        yield* s.when.conversation.sends("Inspect checkout while Zerops is down");
        yield* messageAppears(s, "Inspect checkout while Zerops is down");
        yield* retained;
        yield* checkpoint(s);
      }),
    );

    // Catches one unreadable HQ Mate record erasing an unrelated Mate's task or the whole menu.
    it.effect("a corrupt HQ Mate record removes only its own task", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        yield* reportsWork(s, "Ada", "Inspect Ada checkout");
        yield* reportsWork(s, "Bea", "Inspect Bea checkout");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Inspect Ada checkout");
        yield* menuSays(s.page, "Inspect Bea checkout");
        yield* corruptMate(s, "Ada");
        yield* menuOmits(s.page, "Inspect Ada checkout");
        yield* menuSays(s.page, "Inspect Bea checkout");
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Shop").appears();
        yield* checkpoint(s);
      }),
    );

    // Catches an HQ outage erasing the last known task instead of retaining it as stale.
    it.effect("HQ down retains the last known task beside the catching-up indicator", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* reportsWork(s, "Ada", "Inspect checkout before outage");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Inspect checkout before outage");
        yield* s.when.hq.socket.drops;
        yield* catchingUp(s);
        yield* menuSays(s.page, "Inspect checkout before outage").pipe(
          Effect.ensuring(checkpoint(s)),
        );
      }),
    );

    // Targets an HQ outage erasing a pending question that the user still needs to answer.
    it.effect.fails("HQ down retains the last known pending question", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* reportsWork(s, "Ada", "Inspect checkout", "Which checkout should I inspect?");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Which checkout should I inspect?");
        yield* s.when.hq.socket.drops;
        yield* catchingUp(s);
        yield* menuSays(s.page, "Which checkout should I inspect?").pipe(
          Effect.catchDefect((cause) =>
            Effect.die(
              new Error("Last known pending question disappeared during HQ outage", { cause }),
            ),
          ),
          Effect.ensuring(checkpoint(s)),
        );
      }),
    );

    // Targets heartbeats keeping old HQ facts apparently current forever without another snapshot.
    it.effect.fails("pings alone cannot keep a three-minute-old HQ view live", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* heartbeatsWithoutFacts(s);
        yield* catchingUp(s).pipe(
          Effect.catchDefect((cause) =>
            Effect.die(
              new Error("HQ still appears live after nine pings without fresh facts", { cause }),
            ),
          ),
          Effect.ensuring(checkpoint(s)),
        );
      }),
    );
  });
});
