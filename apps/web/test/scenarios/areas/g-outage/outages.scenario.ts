import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { outageControls } from "./fake.ts";
import {
  givenOutage,
  reportsWork,
  menuSays,
  menuRowGone,
  caughtUp,
  cappedHqOutage,
  zeropsCatchesUp,
  lastingZeropsOutage,
  newSegmentWithoutSnapshot,
  stallsHq,
  frozenMenuStillSays,
  zeropsGoesDown,
  heartbeatsWithoutSnapshot,
  corruptMate,
  checkpoint,
  opensMate,
  messageAppears,
  showsWokenTab,
  stopHq,
  startHq,
  declareNewerProtocol,
  endHqSession,
  resubscribesOnResume,
  refuseHq,
  resumeTab,
  hqRefusalShown,
  retryHq,
} from "./dsl.ts";

describe("G: outages, sleep and several tabs", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // No baseline from HQ can prove that the platform containers belong to no application.
    it.effect("cold HQ placement stays unknown on Projects until owner evidence arrives", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        outageControls(s.drivers).silenceFacts();
        yield* s.given.signedIn;
        yield* Effect.promise(() =>
          s.page.locator('[data-zerops-surface="other-containers"]').setTimeout(15_000).wait(),
        );
        const words = yield* Effect.promise(() =>
          s.page.$eval('[data-zerops-surface="other-containers"]', (node) => node.textContent),
        );
        expect(words).toContain("placement unknown");
        expect(words).not.toContain("Not in a project");
        yield* s.then.noExternalNetwork;
      }),
    );

    // A replaced Core must resubscribe the open tab, including after backoff reaches its cap.
    it.effect("HQ restart and a new build recover the open tab without reloading", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        for (const build of [undefined, "redeployed-core"]) {
          yield* s.when.hq.socket.drops;
          yield* stopHq(s);
          yield* cappedHqOutage(s);
          yield* startHq(s, build);
          if (build !== undefined) yield* declareNewerProtocol(s);
          yield* s.when.hq.socket.returns;
          yield* Effect.promise(() => s.clock.advanceStepped(60_000));
          yield* caughtUp(s, "Shop");
        }
        yield* checkpoint(s);
      }),
    );
    // Returning input wakes backoff, but only a fresh HQ answer clears the header.
    for (const trigger of ["online", "focus", "visibilitychange"] as const)
      it.effect(`${trigger} recovers HQ during capped backoff without reloading`, () =>
        Effect.gen(function* () {
          const s = yield* givenOutage();
          yield* s.given.signedIn;
          yield* caughtUp(s, "Shop");
          yield* s.when.hq.socket.drops;
          yield* cappedHqOutage(s);
          yield* s.when.hq.socket.returns;
          yield* resumeTab(s, trigger);
          yield* caughtUp(s, "Shop");
          yield* checkpoint(s);
        }),
      );

    // A session ending is not a permanent denial of a newly authenticated subscription.
    it.effect("successive HQ session endings renew and restore the menu", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        for (let end = 0; end < 3; end++) {
          // A renewal within the reconnect grace is not an outage, so the menu says nothing of
          // the ending; the renewal shows as a new subscription.
          const opened = yield* endHqSession(s);
          yield* resubscribesOnResume(s, "online", opened);
          yield* caughtUp(s, "Shop");
        }
        yield* checkpoint(s);
      }),
    );

    // A genuine refusal is shown as a refusal and incidental wake events cannot undo it.
    it.effect("HQ refusal says why and waits for an explicit retry", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* refuseHq(s);
        yield* hqRefusalShown(s);
        for (const trigger of ["online", "focus", "visibilitychange"] as const)
          yield* resumeTab(s, trigger);
        yield* Effect.promise(() => s.clock.advanceStepped(120_000));
        yield* hqRefusalShown(s);
        yield* retryHq(s);
        yield* caughtUp(s, "Shop");
        yield* checkpoint(s);
      }),
    );
    // A completed HQ read remains evidence of absence while the source reconnects.
    it.effect("HQ down retains a known Not in this HQ row", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.project("Wren", { mate: true, registered: false });
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* menuSays(s.page, "Not in this HQ");
        yield* s.when.hq.socket.drops;
        yield* s.then.hq.isUnavailable;
        yield* menuSays(s.page, "Not in this HQ");
        yield* checkpoint(s);
      }),
    );
    // Catches HQ downtime making a retained Mate impossible to open or send a message to.
    it.effect("HQ down: the menu holds and a Mate still opens and chats", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        const retained = yield* s.then.menu.keepsRows(["Shop", "Ada"]);
        yield* s.when.hq.socket.drops;
        yield* s.then.hq.isUnavailable;
        yield* opensMate(s);
        yield* s.then.conversation.appears;
        yield* s.when.conversation.sends("Inspect checkout while HQ is down");
        yield* messageAppears(s, "Inspect checkout while HQ is down");
        yield* cappedHqOutage(s);
        yield* retained;
        yield* checkpoint(s);
      }),
    );

    // Catches a second disconnect exhausting recovery or resurrecting an earlier application name.
    it.effect("two consecutive HQ outages each reconcile the latest name", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        let previous = "Shop";
        for (const name of ["Shop first return", "Shop second return"]) {
          yield* s.when.hq.socket.drops;
          yield* s.then.hq.isUnavailable;
          yield* s.when.hq.colleague.renamesProject("Shop", name);
          yield* s.when.hq.socket.returns;
          yield* Effect.promise(() => s.clock.advance(30_000));
          yield* caughtUp(s, name);
          yield* menuRowGone(s.page, previous);
          previous = name;
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
        const stalled = yield* stallsHq(s);
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop while stalled");
        yield* Effect.promise(() => stalled.waitForDownstream("Shop while stalled"));
        yield* Effect.promise(() => s.clock.advance(30_000));
        yield* menuRowGone(s.page, "Shop while stalled");
        yield* menuSays(s.page, "Shop");
        yield* Effect.promise(() => s.clock.sleep());
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after wake");
        yield* Effect.promise(() => stalled.waitForDownstream("Shop after wake"));
        yield* frozenMenuStillSays(s, "Shop", "Shop after wake");
        yield* Effect.promise(() => s.clock.wake(3_600_000));
        yield* showsWokenTab(s);
        for (let step = 0; step < 5; step++) {
          yield* Effect.promise(() =>
            s.clock.advanceStepped(1_000, {
              settle: () =>
                s.page.evaluate(
                  () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
                ),
            }),
          );
        }
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
    it.effect(
      "Zerops outage shows catching up and retains menu/chat through capped HQ retries",
      () =>
        Effect.gen(function* () {
          const s = yield* givenOutage();
          yield* s.given.signedIn;
          yield* caughtUp(s, "Shop");
          yield* opensMate(s);
          yield* s.then.conversation.appears;
          const retained = yield* s.then.menu.keepsRows(["Shop", "Ada"]);
          yield* zeropsGoesDown(s);
          yield* lastingZeropsOutage(s);
          yield* zeropsCatchesUp(s);
          yield* s.when.hq.socket.drops;
          yield* cappedHqOutage(s);
          yield* zeropsCatchesUp(s);
          yield* s.when.conversation.sends("Inspect checkout while Zerops is down");
          yield* messageAppears(s, "Inspect checkout while Zerops is down");
          yield* retained;
          yield* checkpoint(s);
        }),
    );

    // Catches one unreadable HQ Mate record erasing an unrelated Mate's task or the whole menu.
    it.effect("a corrupt HQ Mate record keeps unrelated tasks and menu rows", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        yield* reportsWork(s, "Ada", "Inspect Ada checkout");
        yield* reportsWork(s, "Bea", "Inspect Bea checkout");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Inspect Ada checkout");
        yield* menuSays(s.page, "Inspect Bea checkout");
        yield* corruptMate(s, "Ada");
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after corrupt");
        yield* menuSays(s.page, "Shop after corrupt");
        yield* menuSays(s.page, "Inspect Bea checkout");
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Shop after corrupt").appears();
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
        yield* s.then.hq.isUnavailable;
        yield* cappedHqOutage(s);
        yield* menuSays(s.page, "Inspect checkout before outage").pipe(
          Effect.ensuring(checkpoint(s)),
        );
      }),
    );

    // Targets an HQ outage erasing a pending question that the user still needs to answer.
    it.effect("HQ down retains the last known pending question", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* reportsWork(s, "Ada", "Inspect checkout", "Which checkout should I inspect?");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Which checkout should I inspect?");
        yield* s.when.hq.socket.drops;
        yield* s.then.hq.isUnavailable;
        yield* cappedHqOutage(s);
        yield* checkpoint(s);
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

    // Targets a new segment staying apparently current when pings arrive but its snapshot never does.
    it.effect("a new HQ segment without its snapshot cannot stay live on pings", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* s.given.signedIn;
        yield* caughtUp(s, "Shop");
        yield* newSegmentWithoutSnapshot(s);
        yield* heartbeatsWithoutSnapshot(s);
        yield* checkpoint(s);
        yield* s.then.hq.isUnavailable;
      }),
    );

    // Catches corrupt HQ data deleting the last valid task instead of keeping it until a valid replacement.
    it.effect("Ada's task is kept after a corrupt update", () =>
      Effect.gen(function* () {
        const s = yield* givenOutage();
        yield* reportsWork(s, "Ada", "Inspect Ada checkout");
        yield* s.given.signedIn;
        yield* menuSays(s.page, "Inspect Ada checkout");
        yield* corruptMate(s, "Ada");
        yield* s.when.hq.colleague.renamesProject("Shop", "Shop after corrupt");
        yield* menuSays(s.page, "Shop after corrupt");
        yield* checkpoint(s);
        yield* menuSays(s.page, "Inspect Ada checkout");
      }),
    );
  });
});
