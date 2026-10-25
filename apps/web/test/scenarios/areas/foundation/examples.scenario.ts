import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";

describe("foundation: the real hosted client", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a missing menu row after a Zerops-only colleague addition, without waiting for HQ.
    it.effect("B: Zerops-only project appears in the menu within 5 s without HQ", () =>
      Effect.gen(function* () {
        const { given, when, then } = yield* createScenario();
        yield* given.project("Ada", { mate: true });
        yield* given.signedIn;
        yield* then.menu.row("Ada").appears();
        yield* when.zerops.colleague.createsProject("Bea", { mate: true });
        yield* then.menu
          .row("Bea")
          .appears()
          .pipe(Effect.ensuring(Effect.all([then.noReload, then.noExternalNetwork])));
      }),
    );

    // Catches a missing menu row after a colleague enrolls a new Mate with real HQ.
    it.effect("B: the HQ enrollment path adds a Mate to the menu without reload", () =>
      Effect.gen(function* () {
        const { given, when, then } = yield* createScenario();
        given.org("ACME");
        yield* given.project("Ada", { mate: true });
        yield* given.signedIn;
        yield* then.menu.row("Ada").appears();
        yield* when.zerops.colleague.createsProject("Bea", { mate: true, enroll: true });
        yield* then.menu.row("Bea").appears();
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
  });
});
