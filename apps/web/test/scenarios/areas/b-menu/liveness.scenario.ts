import { describe, expect, it } from "@effect/vitest";
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

    // Placement updates in both tabs while the Mate's conversation keeps its identity and history.
    it.effect("moving an open Mate updates both tabs without losing its conversation", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.given.project("Cara", { mate: true, app: "Other" });
        yield* s.colleague.said("Ada", "Keep this conversation when Ada moves");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop");
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* s.then.conversation.showsMessage("Keep this conversation when Ada moves");
        const url = s.page.url();
        const second = yield* s.given.browserActor();
        yield* second.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop", second.page);
        yield* second.when.menu.opensMate("Ada");
        yield* second.then.conversation.appears;
        yield* second.then.conversation.showsMessage("Keep this conversation when Ada moves");
        const secondUrl = second.page.url();
        yield* s.menu.movesMate("Ada", "Other");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.menu.grouped("Ada", "Other", second.page);
        yield* s.menu.keepsConversation(url);
        yield* s.menu.keepsConversation(secondUrl, second.page);
        yield* s.then.conversation.showsMessage("Keep this conversation when Ada moves");
        yield* second.then.conversation.showsMessage("Keep this conversation when Ada moves");
        yield* s.when.conversation.sends("Continue in the same Mate after Move");
        yield* s.then.conversation.showsMessage("Continue in the same Mate after Move");
        yield* second.then.conversation.showsMessage("Continue in the same Mate after Move");
        yield* s.menu.toggle("Other");
        yield* s.menu.absent("Ada");
        yield* s.menu.toggle("Other");
        yield* s.menu.grouped("Ada", "Other");
        yield* s.then.noReload;
        yield* second.then.noReload;
        yield* s.then.noExternalNetwork;
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

    // Catches a Mate whose address was turned on staying unreachable: its record is not promised
    // to arrive by a push, so its own row is read once its enable finishes.
    it.effect("a Mate opens once its address is turned on, its record never pushed", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Bea", { mate: true, app: "Shop" });
        const zerops = s.drivers.zerops;
        const zcp = zerops.rows("service-stack").find((row) => row.id === "service-Bea")!;
        zerops.put("service-stack", {
          ...zcp,
          subdomainAccess: false,
          lastUpdate: "2026-10-06T12:00:00.000Z",
        });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Bea").appears();
        // Zerops turns its address on: the enable finishes, and the service's record changes
        // with no push of it.
        zerops.faults.set("service-stack:push", { silence: true });
        zerops.put("service-stack", {
          ...zcp,
          subdomainAccess: true,
          lastUpdate: "2026-10-06T12:01:50.000Z",
        });
        zerops.put("process", {
          id: "enable-bea",
          clientId: "ORG",
          projectId: "Bea",
          actionName: "stack.enableSubdomainAccess",
          status: "FINISHED",
          created: "2026-10-06T12:01:40.000Z",
          started: "2026-10-06T12:01:40.000Z",
          finished: "2026-10-06T12:01:45.000Z",
          lastUpdate: "2026-10-06T12:01:45.000Z",
          executorTag: "USER",
          serviceStackId: "service-Bea",
          serviceStacks: [{ id: "service-Bea" }],
          error: null,
          appVersion: null,
        });
        yield* s.when.menu.opensMate("Bea");
        yield* s.then.conversation.appears;
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

    // Catches a row that keeps saying its Mate works after the Mate said it stopped: its
    // attention, ordered by its own revision, is the word: the row follows within two seconds.
    it.effect("a Mate's attention that it stopped clears its working row within two seconds", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario();
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.colleague.reports("Ada", working, "working");
        yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
        // Its overview still says it works; only its attention moved.
        yield* s.colleague.attends("Ada", {});
        yield* s.menu.lacks("Ada", "sidebar-mate-live-step", 2_000);
        yield* s.then.noReload;
      }),
    );

    // Catches a restarted Mate whose attention starts its revisions over being held to the run
    // before, and the run before — back from a partition, never killed — taking the row back:
    // runs order by their epoch, whatever is live: the row follows within two seconds.
    it.effect(
      "a restarted Mate's attention, HQ relaying it alone, replaces its run before within two seconds, and the run before's late word never wins",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Ada").appears();
          yield* s.colleague.reports("Ada", working, "working");
          yield* s.colleague.reports("Ada", working, "working");
          yield* s.menu.text("Ada", "Thinking", "sidebar-mate-live-step");
          yield* s.colleague.restarts("Ada");
          yield* s.colleague.relays("Ada", {});
          yield* s.menu.lacks("Ada", "sidebar-mate-live-step", 2_000);
          yield* s.colleague.speaksFromRunBefore("Ada", { working: 1 });
          yield* s.menu.keepsLacking("Ada", "sidebar-mate-live-step", 2_000);
          yield* s.then.noReload;
        }),
    );

    // Catches a new chat reaching the row only with HQ's overview of it: the attention HQ relays
    // names it first, and the row follows it alone within two seconds.
    it.effect(
      "a new chat HQ relays the attention of alone reaches its row within two seconds",
      () =>
        Effect.gen(function* () {
          const s = yield* menuScenario();
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.signedIn;
          yield* s.then.menu.row("Ada").appears();
          yield* s.colleague.reports("Ada");
          yield* s.menu.text("Ada", "Inspect the checkout", "sidebar-mate-subject");
          yield* s.colleague.relays("Ada", {
            mainThreadId: ThreadId.make("new-chat"),
            lastThreadId: ThreadId.make("new-chat"),
            waiting: 1,
            questions: [{ threadId: ThreadId.make("new-chat"), kind: "approval", turnId: null }],
          });
          yield* s.menu.dot("Ada", "attention", 2_000);
          yield* s.menu.lacks("Ada", "sidebar-mate-subject", 2_000);
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
        yield* s.given.signedIn;
        yield* s.then.menu.row("Ada").appears();
        yield* s.then.menu.row("Bea").appears();
        const retained = yield* s.then.menu.keepsRows(["Ada"]);
        const refusal = s.page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith("/project/Ada") && response.status() === 403,
          { timeout: 10_000 },
        );
        // Leaving Zerops' roster asks its owner to verify absence; that owner refuses the read.
        yield* s.colleague.deletes("Ada");
        yield* Effect.promise(async () => {
          await (await refusal).buffer();
          await s.page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
        });
        yield* s.colleague.deletes("Bea");
        yield* s.menu.absent("Bea");
        yield* retained;
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Targets menu rows blocked behind the delivery of HQ application detail.
    it.effect("application menu rows arrive before HQ application detail", () =>
      Effect.gen(function* () {
        const s = yield* menuScenario([installDelayedDetails]);
        yield* s.given.project("Ada", { mate: true, app: "Shop" });
        yield* s.colleague.holdsDetails("Shop");
        yield* s.given.signedIn;
        yield* s.menu.grouped("Ada", "Shop").pipe(
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
        const chipContrast = Effect.promise(async () => {
          for (const theme of ["light", "dark"]) {
            await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
            await s.page.waitForFunction(
              (dark) => document.documentElement.classList.contains("dark") === dark,
              {},
              theme === "dark",
            );
            await s.page.evaluate(() => document.fonts.ready);
            await s.page.evaluate(async () => {
              await Promise.all(
                [...document.querySelectorAll("[data-zerops-chip]")].flatMap((chip) =>
                  chip.getAnimations().map((animation) => animation.finished),
                ),
              );
            });
            const contrasts = await s.page.evaluate(() => {
              const sidebar = document.querySelector('[data-sidebar="sidebar"]')!;
              const chips = [...sidebar.querySelectorAll<HTMLElement>("[data-zerops-chip]")].filter(
                (node) => node.getBoundingClientRect().width > 0,
              );
              const canvas = document.createElement("canvas");
              canvas.width = canvas.height = 1;
              const context = canvas.getContext("2d", { willReadFrequently: true })!;
              const luminance = (bytes: Uint8ClampedArray) =>
                [...bytes].slice(0, 3).reduce((sum, channel, index) => {
                  const value = channel / 255;
                  return (
                    sum +
                    [0.2126, 0.7152, 0.0722][index]! *
                      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
                  );
                }, 0);
              return chips.map((chip) => {
                // Scoped to these chip/sidebar colour layers; grain, gradients and ancestor opacity remain unverified.
                context.clearRect(0, 0, 1, 1);
                context.fillStyle = getComputedStyle(sidebar).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                context.fillStyle = getComputedStyle(chip).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                const background = luminance(context.getImageData(0, 0, 1, 1).data);
                context.fillStyle = getComputedStyle(chip).color;
                context.fillRect(0, 0, 1, 1);
                const text = luminance(context.getImageData(0, 0, 1, 1).data);
                return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
              });
            });
            expect(
              contrasts.length,
              "ASSERTION: menu has rendered chip text to measure",
            ).toBeGreaterThan(0);
            expect(
              Math.min(...contrasts),
              `ASSERTION: menu chip colour layers have readable contrast in both themes (${theme})`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        });
        yield* chipContrast;
        yield* s.colleague.builds("Shop-stage");
        // Three times the 5 s target budget gives a loaded laptop 10 s of headroom.
        yield* s.menu.chip("\\b(?:building|deploying|releasing)\\b", 15_000);
        yield* chipContrast;
      }),
    );
  });
});
