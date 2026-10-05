import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";

describe("foundation: the real hosted client", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches an organization menu that ignores a colleague's realtime project addition until reload.
    it.effect("B: a colleague's new project appears without reload", () =>
      Effect.gen(function* () {
        const { given, when, then } = yield* createScenario();
        given.org("KRLS");
        yield* given.project("Ada", { mate: true });
        yield* given.signedIn;
        yield* then.menu.row("Ada").appears();
        yield* when.zerops.colleague.createsProject("Bea", { mate: true, enroll: true });
        yield* then.menu.row("Bea").appears({ within: 5000 });
        yield* then.noReload;
        yield* then.noExternalNetwork;
      }),
    );

    // Catches a broken Mate door/navigation or a composer whose message never reaches the timeline.
    it.effect("C: opening a Mate reaches its conversation and sends a message", () =>
      Effect.gen(function* () {
        const { given, when, then } = yield* createScenario();
        yield* given.project("Ada", { mate: true });
        yield* given.signedIn;
        yield* when.menu.opensMate("Ada");
        yield* then.conversation.appears;
        yield* when.conversation.sends("Please inspect the Shop project");
        yield* then.conversation.showsMessage("Please inspect the Shop project");
        yield* then.noExternalNetwork;
      }),
    );

    // Catches clearing known menu rows on HQ disconnect or failing to reconcile an outage-time change.
    it.effect("G: HQ outage preserves rows and catches up after return", () =>
      Effect.gen(function* () {
        const { given, when, then } = yield* createScenario();
        yield* given.project("Ada", { mate: true, app: "Shop" });
        yield* given.signedIn;
        yield* then.menu.row("Shop").appears();
        const retained = yield* then.menu.keepsRows(["Shop", "Ada"]);
        yield* when.hq.socket.drops;
        yield* then.menu.row("Shop").appears();
        yield* then.menu.row("Ada").appears();
        yield* when.hq.colleague.renamesProject("Shop", "Shop returned");
        yield* retained;
        yield* when.hq.socket.returns;
        yield* then.menu.row("Shop returned").appears();
        yield* then.noExternalNetwork;
      }),
    );
  });
});
