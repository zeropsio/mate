import type { KeyInput } from "puppeteer-core";
import { expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { createScenario } from "../../harness/scenario.ts";
import { visibleText } from "../../harness/browser.ts";
import { chatFor, revokeProjectAccess } from "./fake.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export function mateChat(
  s: Pick<Scenario, "page" | "drivers" | "web"> & { when: Pick<Scenario["when"], "conversation"> },
) {
  const { page } = s;
  const composer =
    '::-p-aria([role="textbox"]):not([inert], [inert] *, [aria-hidden="true"], [aria-hidden="true"] *)';
  const text = (value: string, present = true) =>
    Effect.promise(async () => {
      try {
        await page.waitForFunction(
          (value, present) => {
            const visible = (root: Node): boolean => {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node instanceof Element && node.shadowRoot && visible(node.shadowRoot))
                  return true;
                if (
                  node instanceof Element &&
                  node.textContent?.includes(value) &&
                  ![...node.children].some((child) => child.textContent?.includes(value)) &&
                  !node.closest(
                    '[inert], textarea, input, [role="textbox"], [data-zerops-surface="sidebar-environments"]',
                  ) &&
                  node.getBoundingClientRect().height > 0
                )
                  return true;
              }
              return false;
            };
            const found = visible(document.body);
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
      yield* Effect.promise(() => page.waitForSelector(composer, { visible: true, timeout: 8000 }));
    });
  const timed = (
    kind: "first" | "parked" | "reload",
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
      yield* Effect.logInfo(`c-mate ${kind}: ${Math.round(elapsed)} ms`);
    });
  const click = (label: string) =>
    Effect.promise(async () => {
      try {
        await page.locator(`button ::-p-text(${label})`).setTimeout(8000).click();
      } catch (cause) {
        throw new Error(`Click ${label}: ${await page.evaluate(() => document.body.innerText)}`, {
          cause,
        });
      }
    });
  const openMate = (name: string) =>
    Effect.promise(async () => {
      await page
        .locator(`[data-zerops-surface="sidebar-mate"] ::-p-text(${name})`)
        .setTimeout(8000)
        .click();
    });
  return {
    step: <A, E, R>(name: string, action: Effect.Effect<A, E, R>) =>
      action.pipe(
        Effect.tapCause((cause) => Effect.logError(`Journey step: ${name}`, cause)),
        Effect.annotateLogs("journey-step", name),
      ),
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
      press: (name: string, role = "button") =>
        Effect.promise(async () => {
          try {
            await page
              .locator(`::-p-aria([name="${name}"][role="${role}"])`)
              .setTimeout(8000)
              .click();
          } catch (cause) {
            throw new Error(
              `Cannot press ${name}\n${await page.evaluate(
                () =>
                  document.body.innerText +
                  "\nControls: " +
                  [...document.querySelectorAll("button")]
                    .filter((button) => button.getBoundingClientRect().height)
                    .map((button) => button.getAttribute("aria-label") ?? button.innerText)
                    .join(" | "),
              )}`,
              { cause },
            );
          }
        }),
      openLastPicture: (expected: number) =>
        Effect.promise(async () => {
          await page.waitForFunction(
            (expected) =>
              [...document.querySelectorAll('button[aria-label^="Open picture "]')].filter(
                (button) => button.getBoundingClientRect().height > 0,
              ).length === expected,
            { timeout: 8000, polling: "raf" },
            expected,
          );
          const pictures = await page.$$('button[aria-label^="Open picture "]');
          await pictures.at(-1)!.click();
        }),
      type: (value: string) =>
        Effect.promise(async () => {
          await (await page.locator(composer).setTimeout(8000).waitHandle()).focus();
          await page.keyboard.type(value);
        }),
      read: (value: string) =>
        Effect.promise(async () => {
          const node = await page.waitForSelector(`::-p-text(${value})`, { visible: true });
          await node!.evaluate((element) => element.scrollIntoView({ block: "center" }));
        }),
      shortcut: (key: KeyInput) =>
        Effect.promise(async () => {
          await page.keyboard.down("Meta");
          await page.keyboard.press(key);
          await page.keyboard.up("Meta");
        }),
      key: (key: KeyInput) => Effect.promise(() => page.keyboard.press(key)),
      mention: (token: string) =>
        Effect.promise(async () => {
          try {
            await page.locator(`::-p-text(${token})`).setTimeout(8000).click();
          } catch (cause) {
            throw new Error(
              `Mention ${token}: ${await page.evaluate(() => document.body.innerText)}`,
              { cause },
            );
          }
        }),
      agent: (name: string) =>
        Effect.promise(async () => {
          try {
            await page.locator(`button[aria-label^="${name}"]`).setTimeout(8000).click();
          } catch (cause) {
            throw new Error(
              `Agent ${name}: ${await page.evaluate(() =>
                [...document.querySelectorAll("button")]
                  .filter((b) => b.getBoundingClientRect().height)
                  .map((b) => b.getAttribute("aria-label") ?? b.innerText)
                  .join(" | "),
              )}`,
              { cause },
            );
          }
        }),
      copy: (value: string) =>
        Effect.promise(async () => {
          await page
            .browserContext()
            .overridePermissions(s.web.origin, ["clipboard-read", "clipboard-write"]);
          const node = await page.waitForSelector(`::-p-text(${value})`, { visible: true });
          await node!.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          });
          await page.keyboard.down("c", { commands: ["copy"] });
          await page.keyboard.up("c");
          expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(value);
        }),
      activate: (name: string) =>
        Effect.promise(async () => {
          const button = await page.waitForSelector(`::-p-aria([name="${name}"][role="button"])`, {
            visible: true,
            timeout: 8000,
          });
          await button!.focus();
          await page.keyboard.press("Enter");
        }),
      pasteFile: (name: string, content: string) =>
        Effect.promise(async () => {
          await (await page.locator(composer).setTimeout(8000).waitHandle()).focus();
          await page.evaluate(
            (name, content) => {
              const clipboard = new DataTransfer();
              clipboard.items.add(new File([content], name, { type: "text/plain" }));
              document.activeElement!.dispatchEvent(
                new ClipboardEvent("paste", {
                  clipboardData: clipboard,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            name,
            content,
          );
        }),
      pastePicture: (name: string, colour = "#c34b34") =>
        Effect.promise(async () => {
          await (await page.locator(composer).setTimeout(8000).waitHandle()).focus();
          await page.evaluate(
            async (name, colour) => {
              const canvas = document.createElement("canvas");
              canvas.width = 320;
              canvas.height = 200;
              const context = canvas.getContext("2d")!;
              context.fillStyle = colour;
              context.fillRect(0, 0, 320, 200);
              const blob = await new Promise<Blob>((resolve) =>
                canvas.toBlob((blob) => resolve(blob!), "image/png"),
              );
              const clipboard = new DataTransfer();
              clipboard.items.add(new File([blob], name, { type: "image/png" }));
              document.activeElement!.dispatchEvent(
                new ClipboardEvent("paste", {
                  clipboardData: clipboard,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            name,
            colour,
          );
        }),
      fill: (name: string, value: string) =>
        Effect.promise(() =>
          page.locator(`::-p-aria([name="${name}"])`).setTimeout(8000).fill(value),
        ),
      notePicture: (note: string) =>
        Effect.promise(async () => {
          const dialog = await page.waitForSelector('[role="dialog"]', { visible: true });
          const box = await dialog!.boundingBox();
          if (!box) throw new Error("Picture dialog has no visible bounds");
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.locator('::-p-aria([name="Note text"])').fill(note);
          await page.keyboard.press("Enter");
        }),
      cropPicture: () =>
        Effect.promise(async () => {
          const handle = await page.waitForSelector('[role="dialog"] [data-handle="e"]', {
            visible: true,
          });
          const box = await handle!.boundingBox();
          const frame = await page.waitForSelector('[role="dialog"] canvas', { visible: true });
          const picture = await frame!.boundingBox();
          if (!box || !picture) throw new Error("The crop has no visible drag handle");
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(picture.x + picture.width / 2, box.y + box.height / 2, {
            steps: 5,
          });
          await page.mouse.up();
        }),
      send: (message: string) =>
        Effect.promise(async () => {
          const input = page.locator(composer).setTimeout(8000);
          await (await input.waitHandle()).focus();
          await input.fill(message);
          await page.keyboard.press("Enter");
        }),
    },
    // The scenario DSL exposes assertions, never a Promise callback.
    // oxlint-disable-next-line unicorn/no-thenable
    then: {
      chatChoices: (names: ReadonlyArray<string>) =>
        Effect.promise(async () => {
          await page.waitForFunction(
            (names) => {
              const shown = [...document.querySelectorAll('[role="menuitemradio"]')]
                .filter((row) => row.getBoundingClientRect().height > 0)
                .map((row) => row.textContent?.replace(/\s+/g, " ").trim());
              return JSON.stringify(shown) === JSON.stringify(names);
            },
            { timeout: 8000, polling: "raf" },
            names,
          );
        }),

      ready,
      reading: (value: string) =>
        Effect.promise(() =>
          page.waitForFunction(
            (value) => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (
                  node.textContent === value &&
                  !node.parentElement?.closest('[role="textbox"], [inert]')
                ) {
                  const rect = node.parentElement?.getBoundingClientRect();
                  if (rect && rect.top >= 0 && rect.bottom <= innerHeight) return true;
                }
              }
              return false;
            },
            { timeout: 8000, polling: "raf" },
            value,
          ),
        ),
      picture: (data: string, present = true) =>
        Effect.promise(() =>
          page.waitForFunction(
            (data, present) =>
              [...document.querySelectorAll("img")].some(
                (image) => image.getBoundingClientRect().height > 0 && image.src.endsWith(data),
              ) === present,
            { timeout: 8000, polling: "raf" },
            data,
            present,
          ),
        ),
      draft: (value: string) =>
        Effect.promise(() =>
          page.waitForFunction(
            (value) =>
              [...document.querySelectorAll('[role="textbox"]')].some(
                (element) =>
                  element.getBoundingClientRect().height > 0 && element.textContent === value,
              ),
            { timeout: 8000, polling: "raf" },
            value,
          ),
        ),
      composerText: (value: string) =>
        Effect.promise(() =>
          page.waitForFunction(
            (value) =>
              [...document.querySelectorAll('[role="textbox"]')].some(
                (element) =>
                  element.getBoundingClientRect().height > 0 &&
                  element.textContent?.includes(value),
              ),
            { timeout: 8000 },
            value,
          ),
        ),
      control: (name: string, role = "button", present = true) =>
        Effect.promise(async () => {
          try {
            return await page.waitForSelector(
              `::-p-aria([name="${name}"]${role ? `[role="${role}"]` : ""})`,
              {
                ...(present ? { visible: true } : { hidden: true }),
                timeout: 8000,
              },
            );
          } catch (cause) {
            throw new Error(
              `Control ${name}, present=${present}: ${await page.evaluate(() => document.body.innerText)}`,
              { cause },
            );
          }
        }),
      once: (value: string) =>
        Effect.gen(function* () {
          yield* text(value);
          expect(
            yield* Effect.promise(() =>
              page.evaluate((value) => {
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                let count = 0;
                while (walker.nextNode()) {
                  const node = walker.currentNode;
                  if (
                    node.textContent === value &&
                    node.parentElement?.getBoundingClientRect().height &&
                    !node.parentElement.closest(
                      '[inert], [role="textbox"], [data-zerops-surface="sidebar-environments"]',
                    )
                  )
                    count++;
                }
                return count;
              }, value),
            ),
          ).toBe(1);
        }),
      headerName: (name: string) =>
        Effect.promise(async () => {
          const header = await page
            .locator(`::-p-aria([name="${name}"][role="button"])`)
            .filter((button) => !button.closest('[data-zerops-surface="sidebar-environments"]'))
            .setVisibility("visible")
            .setTimeout(10_000)
            .waitHandle();
          await header.dispose();
        }),
      selected: (name: string) =>
        Effect.promise(() =>
          page.waitForFunction(
            (name) =>
              [...document.querySelectorAll('[role="radio"]')].some(
                (element) =>
                  element.textContent?.trim() === name &&
                  element.getAttribute("aria-checked") === "true",
              ),
            { timeout: 8000, polling: "raf" },
            name,
          ),
        ),
      disabledControl: (name: string, role = "button") =>
        Effect.promise(async () => {
          const node = await page.waitForSelector(`::-p-aria([name="${name}"][role="${role}"])`, {
            visible: true,
          });
          expect(
            await node!.evaluate(
              (element) =>
                element.getAttribute("aria-disabled") === "true" ||
                (element instanceof HTMLButtonElement && element.disabled),
            ),
          ).toBe(true);
        }),
      sent: (message: string) =>
        Effect.gen(function* () {
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
            { timeout: 8000, polling: "raf" },
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
      signInRequired: Effect.promise(async () => {
        try {
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].some(
                (button) =>
                  button.disabled && /sign.*in/iu.test(button.getAttribute("aria-label") ?? ""),
              ),
            { timeout: 8000, polling: "raf" },
          );
        } catch (cause) {
          throw new Error(
            `Agent sign-in requirement missing:\n${await page.evaluate(() => document.body.innerText)}`,
            { cause },
          );
        }
      }),
      sendDisabled: Effect.promise(async () => {
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some(
              (button) =>
                button.type === "submit" &&
                button.disabled &&
                button.getBoundingClientRect().height > 0,
            ),
          { timeout: 8000, polling: "raf" },
        );
      }),
    },
  };
}

export const projectAccessRevoked = Effect.fn("chat.projectAccessRevoked")(function* (
  s: Scenario,
  name: string,
) {
  const read = yield* Effect.promise(() => revokeProjectAccess(s.drivers, name));
  yield* Effect.promise(() => s.clock.advance(15_000));
  yield* Effect.promise(read.heartbeat);
  yield* Effect.sync(read.release);
});
