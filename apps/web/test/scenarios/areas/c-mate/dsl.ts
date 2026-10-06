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
  const composer =
    '::-p-aria([role="textbox"]):not([inert], [inert] *, [aria-hidden="true"], [aria-hidden="true"] *)';
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
                  'textarea, input, [role="textbox"], [data-zerops-surface="sidebar-environments"]',
                ) &&
                node.parentElement.getBoundingClientRect().height > 0
              )
                found = true;
            }
            return found === present;
          },
          { timeout: page.getDefaultTimeout(), polling: "raf" },
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
          { timeout: page.getDefaultTimeout(), polling: "raf" },
          name,
        ),
      );
      yield* Effect.promise(() => page.waitForSelector(composer, { visible: true, timeout: 8000 }));
    });
  const timed = (
    kind: keyof typeof openCaps,
    action: Effect.Effect<unknown>,
    name: string,
    history = "The existing conversation is still here",
  ) =>
    Effect.gen(function* () {
      const start = performance.now();
      yield* action;
      yield* ready(name);
      yield* text(history);
      const elapsed = performance.now() - start;
      yield* Effect.logInfo(`c-mate ${kind}: ${Math.round(elapsed)} ms / ${openCaps[kind]} ms`);
      expect(elapsed, `${kind} Mate opening exceeded its scaled cap`).toBeLessThanOrEqual(
        openCaps[kind],
      );
    });
  const click = (label: string) =>
    Effect.promise(() => page.locator(`button ::-p-text(${label})`).click());
  const openMate = (name: string) =>
    Effect.promise(async () => {
      await page
        .locator(`[data-zerops-surface="sidebar-mate"] ::-p-text(${name})`)

        .click();
    });
  return {
    fixture: (name = "Ada") => {
      const mate = s.drivers.mates.get(name);
      if (!mate) throw new Error(`Create Mate ${name} first`);
      return chatFor(mate);
    },
    when: {
      open: (name = "Ada", history?: string) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => visibleText(page, "sidebar-mate", name));
          yield* timed("first", openMate(name), name, history);
        }),
      openReadOnly: (name = "Ada") => openMate(name),
      returnTo: (name = "Ada") =>
        Effect.gen(function* () {
          yield* Effect.promise(() => visibleText(page, "sidebar-mate", name));
          yield* timed("parked", openMate(name), name);
        }),
      reload: (name = "Ada", history?: string) =>
        timed(
          "reload",
          Effect.promise(() => page.reload()),
          name,
          history,
        ),
      visit: (path: string) => Effect.promise(() => page.goto(`${s.web.origin}${path}`)),
      click,
      send: s.when.conversation.sends,
    },
    // The scenario DSL exposes assertions, never a Promise callback.
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
      ready,
      headerName: (name: string) =>
        Effect.promise(async () => {
          const header = await page
            .locator(`::-p-aria([name="${name}"][role="button"])`)
            .filter((button) => !button.closest('[data-zerops-surface="sidebar-environments"]'))
            .setVisibility("visible")

            .waitHandle();
          await header.dispose();
        }),
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
      noComposer: Effect.promise(() =>
        page.waitForSelector(composer, { hidden: true, timeout: 8000 }),
      ),
      blockedPromptRemains: (message: string) =>
        Effect.promise(async () => {
          await page.waitForFunction(
            (message) =>
              [
                ...document.querySelectorAll<HTMLElement>(
                  'textarea, input:not([type]), input[type="text"], [role="textbox"]',
                ),
              ].some(
                (element) =>
                  element.getBoundingClientRect().height > 0 &&
                  (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
                    ? element.value
                    : element.textContent) === message,
              ) &&
              [...document.querySelectorAll("button")].some(
                (button) =>
                  button.type === "submit" &&
                  button.disabled &&
                  (button.getAttribute("aria-label") ?? "").includes("not recorded"),
              ),
            { timeout: page.getDefaultTimeout(), polling: "raf" },
            message,
          );
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
          { timeout: page.getDefaultTimeout(), polling: "raf" },
        );
      }),
    },
  };
}
