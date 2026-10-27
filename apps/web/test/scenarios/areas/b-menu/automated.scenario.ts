import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resizeMenu } from "../../harness/browser.ts";
import { automatedMatesWire } from "../../fakes/b-menu/automatedMates.ts";
import { menuScenario } from "./dsl.ts";

/** Every row of the menu, by what it is, where it stands and how tall. */
const ROWS = `[...document.querySelectorAll('[data-zerops-mate-row], [data-zerops-surface="sidebar-project-row"]')]
  .filter((row) => row.getBoundingClientRect().height > 0)
  .map((row) => {
    const box = row.getBoundingClientRect();
    return [row.getAttribute("data-zerops-mate-row") ?? row.innerText.split("\\n")[0], Math.round(box.top * 10) / 10, Math.round(box.height * 10) / 10];
  })`;

describe("B: automated Mates in the menu", () => {
  scenarioSuite((it) => {
    // The owner's cardinal sin: a task starting or ending must move nothing in the menu.
    it.effect(
      "an automated Mate's row names its task as it starts and how it ended once it ends, and nothing in the menu moves",
      () =>
        Effect.gen(function* () {
          const wire = automatedMatesWire(["Nova"]);
          wire.set({ task: null, waiting: 2 });
          const s = yield* menuScenario([wire.install]);
          yield* s.given.project("Nova", { mate: true, app: "Tea Shop" });
          yield* s.given.project("Ida", { mate: true, app: "Tea Shop" });
          // The organization keeps its API key: at rest, an automated Mate that never had a task says so.
          const kept = yield* s.drivers.core.call("PUT", "/api/org/ai-keys/nebius", {
            session: s.drivers.owner,
            body: { value: ["nb", "key", "acme", "42"].join("-") },
          });
          expect(kept.status, "ASSERTION: HQ keeps the organization's key").toBe(200);
          yield* s.given.signedIn;
          yield* Effect.promise(async () => {
            await s.page.setViewport({ width: 1786, height: 1000 });
            await resizeMenu(s.page, 435);
          });
          yield* s.menu.grouped("Nova", "Tea Shop");
          yield* s.menu.text("Nova", "No tasks yet", "sidebar-mate-task");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                [...document.querySelectorAll('[data-zerops-surface="mate-automated-mark"]')].some(
                  (mark) => mark.getBoundingClientRect().height > 0,
                ) &&
                [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-zerops-surface="sidebar-project-tasks-waiting"]',
                  ),
                ].some((line) => line.innerText.trim() === "2 tasks waiting"),
              { polling: "raf" },
            ),
          );
          const rows = () => Effect.promise(() => s.page.evaluate(ROWS) as Promise<unknown>);
          const idle = yield* rows();
          expect(
            (idle as ReadonlyArray<unknown>).length,
            "ASSERTION: the project's row and both its Mates' rows are measured",
          ).toBeGreaterThanOrEqual(3);
          // HQ hands it a task: its next word of the Mate carries it.
          const face = (to: string) =>
            s.drivers.core.call("PATCH", "/api/mates/Nova", {
              session: s.drivers.owner,
              body: { face: to },
            });
          wire.set({ task: { number: 12, title: "Fix the checkout total" }, waiting: 2 });
          yield* face("rose:seal");
          yield* s.menu.text("Nova", "#12 Fix the checkout total", "sidebar-mate-task");
          expect(yield* rows(), "ASSERTION: a task starting moves no row of the menu").toEqual(
            idle,
          );
          // Its agent asks a person something: the task waits for them, and still nothing moves.
          wire.set({
            task: { number: 12, title: "Fix the checkout total", waiting: true },
            waiting: 2,
          });
          yield* face("violet:seal");
          yield* s.menu.text(
            "Nova",
            "#12 Fix the checkout total · waiting for you",
            "sidebar-mate-task",
          );
          expect(
            yield* rows(),
            "ASSERTION: a task starting to wait for a person moves no row of the menu",
          ).toEqual(idle);
          // The task ends: its row keeps it, saying how it ended, while it waits for its next.
          wire.set({
            task: { number: 12, title: "Fix the checkout total", ended: "merged" },
            waiting: 2,
          });
          yield* face("sky:seal");
          yield* s.menu.text("Nova", "#12 Fix the checkout total · merged", "sidebar-mate-task");
          expect(yield* rows(), "ASSERTION: a task ending moves no row of the menu").toEqual(idle);
          // Nobody is asked to sign an automated Mate in.
          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(
                () =>
                  [...document.querySelectorAll('[data-zerops-surface="sidebar-mate-sign-in"]')]
                    .length,
              ),
            ),
          ).toBe(0);
          yield* s.then.noReload;
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
