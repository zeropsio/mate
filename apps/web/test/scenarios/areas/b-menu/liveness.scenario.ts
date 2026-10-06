import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { ThreadId } from "@t3tools/contracts";
import { menuScenario } from "./dsl.ts";
import { installDelayedDetails } from "./fake.ts";

const working = {
  session: { status: "running" as const, lastError: null },
  liveStep: { kind: "thinking" as const, since: "2026-10-06T12:00:00.000Z" },
  planProgress: { step: "Inspecting the checkout" },
};

describe("B: menu liveness", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Catches a cold sign-in that never draws current Mate/application rows.
    it.effect("cold start draws current menu rows within a generous UI deadline", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Cara", { mate: true, app: "Other" });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Shop").appears({ within: 15_000 });
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.grouped("Cara", "Other");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a colleague's HQ-enrolled Mate missing from an already open application.
    it.effect("colleague enrollment adds a Mate beneath its application", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        yield* s.menu.grouped("Bea", "Shop");
        yield* s.then.noReload;
      }),
    );

    // Catches stale application names after a colleague renames the application.
    it.effect("application rename updates its heading without reload", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.when.hq.colleague.renamesProject("Shop", "Bakery");
        yield* s.menu.grouped("Ada", "Bakery");
        yield* s.menu.absent("Shop");
        yield* s.then.noReload;
      }),
    );

    // Catches a moved Mate stranded under the old application or duplicated in the menu.
    it.effect("moving a Mate changes its application and removes the old placement", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Cara", { mate: true, app: "Other" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.colleague.moves("Ada", "Other");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.menu.toggle("Other");
        yield* s.menu.absent("Ada");
        yield* s.menu.toggle("Other");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.then.noReload;
      }),
    );

    // Catches a deleted Mate container kept in the menu: its read's 400 serviceStackNotFound
    // must prove it gone.
    it.effect("a Mate whose container is deleted leaves the menu without reload", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, registered: false });
        yield* s.given.signedIn;
        /** Whether a line of the menu names Bea: as a Mate, or as a project without one. */
        const named = (shown: boolean) =>
          Effect.promise(() =>
            s.page.waitForFunction(
              (shown) =>
                [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-zerops-surface="sidebar-environments"]',
                  ),
                ].some((menu) =>
                  menu.innerText.split("\n").some((line) => line.trim() === "Bea"),
                ) === shown,
              { timeout: 10_000, polling: 100 },
              shown,
            ),
          );
        yield* named(true);
        // Zerops deletes Bea's container: its listing drops it, and a read of it answers
        // 400 serviceStackNotFound.
        s.drivers.zerops.remove("service-stack", "service-Bea");
        yield* named(false);
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a detached Mate becoming unreachable when it leaves its application.
    it.effect("detaching a Mate keeps its row outside the application", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.colleague.moves("Ada", null);
        yield* s.menu.toggle("Shop");
        yield* s.menu.absent("Bea");
        yield* s.menu.grouped("Ada", "Ungrouped");
        yield* s.then.noReload;
      }),
    );

    // Catches the menu still claiming an agent is idle after work starts in an unopened Mate.
    it.effect("an agent starts working and its row shows the live step", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.colleague.reports("Ada", working, "working");
        yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
        yield* s.then.noReload;
      }),
    );

    // Catches a pending agent question hidden until its conversation is opened.
    it.effect("an agent waiting for input shows its question in the row", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.colleague.reports("Ada", working, "working");
        yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
        yield* s.colleague.reports(
          "Ada",
          { hasPendingUserInput: true, pendingQuestion: "Which branch should I use?" },
          "input",
        );
        yield* s.menu.text("Ada", "Which branch should I use?", "sidebar-mate-snippet");
      }),
    );

    // Catches a finished agent leaving a working indicator instead of its answer.
    it.effect("an agent finishes and its row shows the answer", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.colleague.reports("Ada", working, "working");
        yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
        yield* s.colleague.reports("Ada", {
          latestMessagePreview: { role: "assistant", text: "Checkout is ready" },
        });
        yield* s.menu.text("Ada", "Checkout is ready", "sidebar-mate-snippet");
      }),
    );

    // Catches a replacement chat leaving the previous chat's request visible in the Mate row.
    it.effect("a new chat replaces the old request in the row", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.colleague.reports("Ada");
        yield* s.menu.text("Ada", "Inspect the checkout", "sidebar-mate-subject");
        yield* s.colleague.reports("Ada", {
          id: ThreadId.make("new-chat"),
          title: "Fresh task",
          latestUserMessagePreview: { text: "Review the new API" },
        });
        yield* s.menu.text("Ada", "Review the new API", "sidebar-mate-subject");
      }),
    );

    // Catches folded applications losing their Mate rows when expanded again.
    it.effect("folding and expanding restores the application's Mate rows", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.toggle("Shop");
        yield* s.menu.absent("Ada");
        yield* s.menu.toggle("Shop");
        yield* s.menu.grouped("Ada", "Shop");
      }),
    );

    // Catches deleted platform projects leaving selectable ghost Mate rows in the menu.
    it.effect("a deleted project disappears after access renewal", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.project("Bea", { mate: true });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Bea").appears();
        yield* s.colleague.deletes("Ada");
        yield* Effect.promise(() => s.clock.advance(12 * 60_000));
        yield* s.menu.absent("Ada");
        yield* s.then.menu.row("Bea").appears();
        yield* s.then.noReload;
      }),
    );

    // Catches a temporary project-read refusal being mistaken for a deleted Mate.
    it.effect("a 403 project read keeps the HQ-enrolled Mate row", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.project("Bea", { mate: true });
        yield* s.colleague.denies("Ada");
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Bea").appears();
        const retained = yield* s.then.menu.keepsRows(["Ada"]);
        yield* s.colleague.deletes("Bea");
        yield* Effect.promise(() => s.clock.advance(12 * 60_000));
        yield* s.menu.absent("Bea");
        // Keep observing through any delayed confirmation reads and their rendered results.
        yield* s.colleague.settlesRefusal("Ada");
        yield* retained;
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Targets menu rows blocked behind the delivery of HQ application detail.
    it.effect.fails("application menu rows arrive before HQ application detail", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario([installDelayedDetails]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        const held = yield* s.colleague.holdsDetails("Shop");
        yield* s.given.signedIn;
        yield* Effect.all([s.menu.grouped("Ada", "Shop"), held], { concurrency: "unbounded" }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              yield* s.colleague.releasesDetails;
              yield* s.menu.grouped("Ada", "Shop");
              yield* s.then.noReload;
              yield* s.then.noExternalNetwork;
            }),
          ),
        );
      }),
    );

    // Targets stage builds running without a menu indicator while the detail remains unopened.
    it.effect("a colleague's stage build appears in the menu", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.stage("Shop-stage", "Shop");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.menu.chip("^Stage stage-existing, healthy$");
        yield* s.colleague.builds("Shop-stage");
        // Three times the 5 s target budget gives a loaded laptop 10 s of headroom.
        yield* s.menu.chip("\\b(?:building|deploying|releasing)\\b", 15_000);
      }),
    );
  });
});
