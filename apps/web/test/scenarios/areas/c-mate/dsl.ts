import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { createScenario } from "../../harness/scenario.ts";
import { visibleText } from "../../harness/browser.ts";
import { chatFor } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

// Twelve times the measured real caps leaves headroom for eight concurrent jobs,
// interception, CDP and RAF condition checks. Build, fixture and sign-in time are excluded.
export const openCaps = { first: 816 * 12, parked: 165 * 12, reload: 717 * 12 };

export function mateChat(s: Scenario) {
  const { page } = s;
  const text = (value: string, present = true) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (value, present) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let found = false;
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (
                node.textContent?.includes(value) &&
                node.parentElement &&
                !node.parentElement.closest(
                  '[role="textbox"], [data-zerops-surface="sidebar-environments"]',
                ) &&
                node.parentElement.getBoundingClientRect().height > 0
              )
                found = true;
            }
            return found === present;
          },
          { timeout: 8000, polling: "raf" },
          value,
          present,
        );
      } catch (cause) {
        throw new Error(
          `Visible text ${present ? "missing" : "still present"}: ${value}\n${await page.evaluate(() => document.body.innerText)}`,
          { cause },
        );
      }
    });
  const ready = (name: string) =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        page.waitForFunction(
          (name) => location.pathname === `/env-${name}/thread-${name}`,
          { timeout: 8000, polling: "raf" },
          name,
        ),
      );
      yield* Effect.promise(() =>
        page.waitForSelector('[role="textbox"]', { visible: true, timeout: 8000 }),
      );
    });
  const timed = (kind: keyof typeof openCaps, action: Effect.Effect<unknown>, name: string) =>
    Effect.gen(function* () {
      const start = performance.now();
      yield* action;
      yield* ready(name);
      const elapsed = performance.now() - start;
      yield* Effect.logInfo(`c-mate ${kind}: ${Math.round(elapsed)} ms / ${openCaps[kind]} ms`);
      expect(elapsed, `${kind} Mate opening exceeded its scaled cap`).toBeLessThanOrEqual(
        openCaps[kind],
      );
    });
  const click = (label: string) =>
    Effect.promise(() => page.locator(`button ::-p-text(${label})`).setTimeout(8000).click());
  const openMate = (name: string) =>
    Effect.promise(async () => {
      await visibleText(page, "sidebar-mate", name);
      await page
        .locator(`[data-zerops-surface="sidebar-mate"] ::-p-text(${name})`)
        .setTimeout(8000)
        .click();
    });
  return {
    fixture: (name = "Ada") => {
      const mate = s.drivers.mates.get(name);
      if (!mate) throw new Error(`Create Mate ${name} first`);
      return chatFor(mate);
    },
    when: {
      open: (name = "Ada") => timed("first", openMate(name), name),
      openReadOnly: (name = "Ada") => openMate(name),
      returnTo: (name = "Ada") => timed("parked", openMate(name), name),
      reload: (name = "Ada") =>
        timed(
          "reload",
          Effect.promise(() => page.reload()),
          name,
        ),
      visit: (path: string) => Effect.promise(() => page.goto(`${s.web.origin}${path}`)),
      click,
      send: s.when.conversation.sends,
    },
    // The scenario DSL exposes assertions, never a Promise callback.
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
      ready,
      sent: (message: string) =>
        Effect.gen(function* () {
          const mate = s.drivers.mates.get("Ada");
          if (!mate) throw new Error("Create Ada before sending a message");
          yield* Effect.promise(() => mate.waitForMessage(message));
          yield* text(message);
        }),
      text,
      noText: (value: string) => text(value, false),
      path: (path: string) =>
        Effect.promise(async () => {
          await page.waitForFunction((path) => location.pathname === path, { timeout: 8000 }, path);
        }),
      noComposer: Effect.promise(async () => {
        expect(
          await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[role="textbox"]')].filter(
              (element) => element.getBoundingClientRect().height > 0,
            ),
          ),
        ).toEqual([]);
      }),
      noButton: (label: string) =>
        Effect.promise(async () => {
          expect(
            await page.evaluate(
              (label) =>
                [...document.querySelectorAll("button")].some(
                  (button) =>
                    button.innerText.trim() === label && button.getBoundingClientRect().height > 0,
                ),
              label,
            ),
          ).toBe(false);
        }),
      sendDisabled: Effect.promise(async () => {
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some(
              (button) =>
                button.type === "submit" &&
                button.disabled &&
                (button.getAttribute("aria-label") ?? "").includes("not recorded"),
            ),
          { timeout: 8000, polling: "raf" },
        );
      }),
    },
  };
}
