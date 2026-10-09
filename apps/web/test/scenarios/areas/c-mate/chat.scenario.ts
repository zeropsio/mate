import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat, projectAccessRevoked } from "./dsl.ts";

const setup = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  chat.fixture().history();
  return { s, chat };
});

describe("C: opening a Mate and chat", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // A reported version difference alone must never offer a chat-level restart.
    it.effect("older and newer Mate versions show no version-skew warning or restart action", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        chat.fixture("Bea").history();
        for (const [name, version] of [
          ["Ada", "0.14.11"],
          ["Bea", "999.0.0"],
        ] as const) {
          const mate = chat.fixture(name).mate;
          Object.assign(mate.descriptor, { serverVersion: version });
          Object.assign(mate.config.environment, { serverVersion: version });
        }
        yield* s.given.signedIn;
        for (const name of ["Ada", "Bea"]) {
          yield* chat.when.open(name);
          const shown = yield* Effect.promise(() =>
            s.page.evaluate(() => ({
              words: document.body.textContent,
              actions: [...document.querySelectorAll("button")]
                .filter((button) => button.getBoundingClientRect().height > 0)
                .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim()),
            })),
          );
          expect(shown.words).not.toContain("Server versions differ");
          expect(shown.actions).not.toContain("Restart Mate");
          expect(shown.actions).not.toContain("Restart server");
        }
        yield* s.then.noExternalNetwork;
      }),
    );

    describe("Decision: catch real breakage only (overlap, overflow, wrong variant/colour role, missing element) — never pixel-exact or 1px nudges; no new expensive visual suites.", () => {
      // Catches a broken identity door/OAuth exchange or a slow first opening that never reaches the chosen chat.
      it.effect("first open crosses the door and OAuth", () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup;
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.then.path("/env-Ada/thread-Ada");
          yield* Effect.promise(async () => {
            await s.page.evaluate(() => document.fonts.ready);
            const edges = await s.page.evaluate(() => {
              const menu = document
                .querySelector('[data-sidebar="header"]')!
                .getBoundingClientRect();
              const header = document.querySelector("[data-chat-header]")!.getBoundingClientRect();
              return [
                Math.abs(menu.bottom - header.bottom),
                Math.abs((menu.top + menu.bottom - header.top - header.bottom) / 2),
              ];
            });
            expect(
              Math.max(...edges),
              "ASSERTION: menu and conversation header share their centre and bottom edge",
            ).toBeLessThanOrEqual(4);
            await s.page.setViewport({ width: 900, height: 300 });
            // Observe before opening, including the first paint; a settled check misses cap snaps.
            await s.page.evaluate(() => {
              const bounds: number[] = [];
              let active = true;
              const sample = () => {
                const popup = document.querySelector('[data-slot="popover-popup"]');
                if (popup) {
                  const box = popup.getBoundingClientRect();
                  if (
                    box.width > 0 &&
                    box.height > 0 &&
                    getComputedStyle(popup).visibility === "visible" &&
                    Number(getComputedStyle(popup).opacity) > 0
                  )
                    bounds.push(
                      Math.max(
                        -box.left,
                        -box.top,
                        box.right - innerWidth,
                        box.bottom - innerHeight,
                      ),
                    );
                }
                if (active) requestAnimationFrame(sample);
              };
              Reflect.set(window, "popoverBounds", bounds);
              Reflect.set(window, "stopPopoverBounds", () => {
                active = false;
              });
              requestAnimationFrame(sample);
            });
            await s.page.locator("[data-chat-provider-model-picker]").click();
            await s.page.waitForSelector('[data-slot="popover-popup"]');
            await s.page.waitForFunction(() => {
              const popup = document.querySelector('[data-slot="popover-popup"]');
              return (
                popup &&
                !popup.hasAttribute("data-starting-style") &&
                getComputedStyle(popup).opacity === "1"
              );
            });
            const bounds = await s.page.evaluate(async () => {
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              Reflect.get(window, "stopPopoverBounds")();
              return Reflect.get(window, "popoverBounds") as number[];
            });
            expect(
              bounds.length,
              "ASSERTION: opening popover supplies first and settled frame evidence",
            ).toBeGreaterThan(1);
            expect(
              Math.max(...bounds),
              "ASSERTION: model popover stays bounded on first and settled frames",
            ).toBeLessThanOrEqual(4);
            await s.page.keyboard.press("Escape");
            await s.page.setViewport({ width: 1280, height: 800 });
          });
          yield* s.then.noExternalNetwork;
        }),
      );
    });

    // Catches returning to a parked Mate losing its history, opening another chat, or repeating the cold door.
    it.effect("returning to a parked Mate preserves history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        chat.fixture("Bea").history("Bea's conversation history");
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.when.returnTo();
        yield* chat.when.type("Keep this draft with Ada");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.when.returnTo();
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.draft("Keep this draft with Ada");
        yield* chat.then.noButton("Sign in");
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a saved conversation link failing in a browser that has never opened this Mate.
    it.effect("cold direct conversation URL opens the named Mate and its history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        expect(chat.fixture().doorCount()).toBe(0);
        yield* chat.when.visit("/env-Ada/thread-Ada");
        yield* chat.then.ready("Ada");
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches the project-level Mate URL stranding a signed-in user on the arrival page instead of the chat.
    it.effect("/mate/project-id opens the Mate conversation from a cold door", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.visit("/mate/Ada");
        yield* chat.then.ready("Ada");
        yield* chat.then.headerName("Ada");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches reload losing the selected chat/history or turning a kept session into a slow cold opening.
    it.effect("reload restores history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.reload();
        yield* chat.then.headerName("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.path("/env-Ada/thread-Ada");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Enter dropping a prompt, showing it only in the editor, or losing the acknowledged message on reload.
    it.effect("sending a message puts it in the durable visible conversation", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.send("Please inspect the Shop project");
        yield* chat.then.once("Please inspect the Shop project");
        yield* chat.when.reload("Ada", "Please inspect the Shop project");
        yield* chat.then.headerName("Ada");
        yield* chat.then.once("Please inspect the Shop project");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches the conversation jumping to its top once a sent message's run arrives (the engine's did).
    it.effect("a sent message keeps a long conversation at its end", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        for (const round of [1, 2, 3])
          chat
            .fixture()
            .exchange(
              `How did deploy ${round} go?`,
              "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                30,
              ),
            );
        chat.fixture().exchange("And now?", "The existing conversation is still here");
        yield* s.given.signedIn;
        yield* chat.when.open();
        // How far the view stands from the end, frame by frame, for about two seconds.
        const fromEnd = () =>
          Effect.promise(() =>
            s.page.evaluate(async () => {
              const readings: number[] = [];
              for (let frame = 0; frame < 120; frame += 1) {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                const scroll = document.querySelector<HTMLElement>(".timeline-legend-list");
                if (scroll !== null)
                  readings.push(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
              }
              return readings;
            }),
          );
        const before = yield* fromEnd();
        expect(Math.max(...before.slice(-10))).toBeLessThanOrEqual(2);
        yield* chat.when.send("Keep me at the end of this conversation");
        // Every frame after Send, while its run is sent, starts and works: never far from the end.
        const after = yield* fromEnd();
        expect(Math.max(...after)).toBeLessThan(400);
        expect(after.at(-1)).toBeLessThanOrEqual(2);
        yield* chat.then.once("Keep me at the end of this conversation");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a row above the sent message changing as the Mate's record replaces the person's (a
    // day divider the Mate's clock moves) and the list leaving its end for its top.
    it.effect(
      "a message the Mate's clock puts on another day keeps a long conversation at its end",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          for (const round of [1, 2, 3])
            chat
              .fixture()
              .exchange(
                `How did deploy ${round} go?`,
                "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                  30,
                ),
              );
          chat.fixture().exchange("And now?", "The existing conversation is still here");
          chat.fixture().skewClock(-3 * 24 * 60 * 60 * 1000);
          yield* s.given.signedIn;
          yield* chat.when.open();
          const fromEnd = () =>
            Effect.promise(() =>
              s.page.evaluate(async () => {
                const readings: number[] = [];
                for (let frame = 0; frame < 120; frame += 1) {
                  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  const scroll = document.querySelector<HTMLElement>(".timeline-legend-list");
                  if (scroll !== null)
                    readings.push(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
                }
                return readings;
              }),
            );
          const before = yield* fromEnd();
          expect(Math.max(...before.slice(-10))).toBeLessThanOrEqual(2);
          yield* chat.when.send("Keep me at the end, whatever day the Mate says it is");
          const after = yield* fromEnd();
          expect(Math.max(...after)).toBeLessThan(400);
          expect(after.at(-1)).toBeLessThanOrEqual(2);
          yield* chat.then.once("Keep me at the end, whatever day the Mate says it is");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches the conversation opening mid-way (an engine Mate's did on CI, "list at 1764 of
    // 3905"): the list re-applied its own scroll after the view was placed at the end, and the
    // move was read as the person leaving it.
    it.effect(
      "a long conversation opens at its end, and the list's own scrolls never leave it",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          for (const round of [1, 2, 3])
            chat
              .fixture()
              .exchange(
                `How did deploy ${round} go?`,
                "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
                  30,
                ),
              );
          chat.fixture().exchange("And now?", "The existing conversation is still here");
          yield* s.given.signedIn;
          yield* chat.when.open();
          const fromEnd = () =>
            Effect.promise(() =>
              s.page.evaluate(async () => {
                const readings: number[] = [];
                for (let frame = 0; frame < 60; frame += 1) {
                  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  const scroll = document.querySelector<HTMLElement>(".timeline-legend-list");
                  if (scroll !== null)
                    readings.push(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop);
                }
                return readings;
              }),
            );
          expect((yield* fromEnd()).at(-1)).toBeLessThanOrEqual(2);
          // The list puts its scroll back where it once aimed, as LegendList's initial scroll does
          // while its rows measure: the page's own move, never the person's.
          yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
              scroll.scrollTo({ top: Math.round(scroll.scrollHeight * 0.45) });
            }),
          );
          expect((yield* fromEnd()).at(-1)).toBeLessThanOrEqual(2);
          yield* chat.then.text("The existing conversation is still here");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches "Send now" starting a run of its own behind the running one (the engine's did) instead of steering it.
    it.effect("Send now puts a waiting message into the running turn", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        chat.fixture().run("story-run", "running");
        yield* chat.then.control("Stop generation");
        yield* chat.when.send("Change of plan: keep it under 120 words");
        yield* chat.when.press("Send now");
        yield* chat.then.once("Change of plan: keep it under 120 words");
        expect(chat.fixture().sentTurnCount()).toBe(1);
        chat.fixture().reply("story-run", "A short story about a lighthouse cat");
        chat.fixture().run("story-run", "completed");
        yield* chat.then.text("A short story about a lighthouse cat");
        // The message went into that turn: when it ends, nothing else works.
        yield* chat.then.control("Stop generation", "button", false);
        // A retained answer is a message outside the folding work. Seeing its text inside
        // the closing card alone does not prove that completion kept the answer.
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            () =>
              [...document.querySelectorAll('[data-message-role="assistant"]')].some(
                (row) =>
                  row.textContent?.includes("A short story about a lighthouse cat") &&
                  row.getBoundingClientRect().height > 0,
              ),
            { timeout: 8000 },
          ),
        );
        // The virtualized list recycles its DOM out of display order. Read the actual
        // message boxes: the sent message stays above the run and its retained answer.
        const messages = yield* Effect.promise(() =>
          s.page.evaluate(() =>
            [...document.querySelectorAll("[data-message-role]")].map((row) => ({
              role: row.getAttribute("data-message-role"),
              text: row.textContent,
              top: row.getBoundingClientRect().top,
              bottom: row.getBoundingClientRect().bottom,
            })),
          ),
        );
        const sent = messages.filter(
          (row) =>
            row.role === "user" && row.text?.includes("Change of plan: keep it under 120 words"),
        );
        const answers = messages.filter(
          (row) =>
            row.role === "assistant" && row.text?.includes("A short story about a lighthouse cat"),
        );
        expect(sent).toHaveLength(1);
        expect(answers).toHaveLength(1);
        expect(sent[0]!.bottom).toBeLessThanOrEqual(answers[0]!.top);
        yield* chat.then.once("Change of plan: keep it under 120 words");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an agent's approval never appearing or Approve failing to release the pending command.
    it.effect("approve an agent command and see it resolve", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        chat.fixture().approval();
        yield* chat.then.text("Command approval");
        yield* chat.then.text("vp run build");
        yield* chat.when.click("Approve");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noButton("Approve");
        expect(chat.fixture().commandDecisions()).toEqual(["approved"]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches Decline silently approving the command or leaving the approval stuck in the composer.
    it.effect("decline an agent command and see it resolve", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().approval();
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("vp run build");
        yield* chat.when.click("Decline");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noButton("Decline");
        expect(chat.fixture().commandDecisions()).toEqual(["declined"]);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches an agent question disappearing, sending the display label instead of its answer, or remaining unanswered after selection.
    it.effect("answer an agent question with a suggested option", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.enabledControl("GPT-5.4");
        chat.fixture().question();
        yield* chat.then.text("Which environment should I inspect?");
        yield* chat.when.click("Staging");
        yield* chat.then.text("Agent received your response");
        yield* chat.then.noText("Which environment should I inspect?");
        expect(chat.fixture().receivedStagingAnswer()).toBe(true);
        expect(chat.fixture().responseCount()).toBe(1);
        yield* chat.step(
          "a free answer carries only the picture attached to that question",
          Effect.gen(function* () {
            chat.fixture().run("question-custom-run", "running");
            chat.fixture().question("question-custom", "question-custom-run");
            yield* chat.then.text("Which environment should I inspect?");
            yield* chat.when.type("Inspect the preview shown here");
            yield* chat.when.pastePicture("question-preview.png");
            yield* chat.then.text("Attached to this answer");
            chat.fixture().responseRefusal = "Your answer was refused. Sign in and retry.";
            yield* chat.when.key("Enter");
            yield* chat.then.text("Your answer was refused. Sign in and retry.");
            yield* chat.then.composerText("Inspect the preview shown here");
            yield* chat.then.text("question-preview.png");
            chat.fixture().responseRefusal = null;
            yield* chat.when.key("Enter");
            const answer = yield* Effect.promise(() =>
              chat.fixture().waitForAnswer("question-custom"),
            );
            expect(answer).toMatchObject({
              requestId: "question-custom",
              answers: { target: "Inspect the preview shown here" },
              attachmentsByQuestionId: { target: [{ name: "question-preview.png" }] },
            });
            // Counted in the live run, before it settles and folds its work away.
            yield* chat.then.once("Inspect the preview shown here");
            chat.fixture().run("question-custom-run", "completed");
            yield* chat.when.activateLast("Show work");
            yield* chat.when.press("Open question-preview.png");
            yield* chat.then.text("question-preview.png");
            yield* chat.when.key("Escape");
            yield* chat.then.noText("Attached to this answer");
            yield* chat.then.draft("");
            yield* chat.when.reload();
            yield* chat.when.activateLast("Show work");
            yield* chat.then.once("Inspect the preview shown here");
            yield* chat.then.control("Open question-preview.png");
          }),
        );
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a picked effort not reaching the agent with the next message, or not staying picked.
    it.effect(
      "the effort a person picks goes with their next message and stays picked after reload",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup;
          chat.fixture().effortCatalog();
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.when.press("GPT-5.4 · Extra High");
          yield* chat.when.press("High", "radio");
          yield* chat.when.key("Escape");
          yield* chat.when.send("Inspect it at high effort");
          yield* chat.then.once("Inspect it at high effort");
          const sent = yield* Effect.promise(() =>
            chat.fixture().waitForTurn("Inspect it at high effort"),
          );
          expect(sent.effort).toBe("high");
          yield* chat.when.reload("Ada", "Inspect it at high effort");
          yield* chat.when.press("GPT-5.4 · High");
          yield* chat.then.selected("High");
          yield* chat.when.key("Escape");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches a picked access snapping back, or never reaching the Mate before the next message.
    it.effect(
      "the access a person picks reaches the Mate with their next message and stays picked after reload",
      () =>
        Effect.gen(function* () {
          const { s, chat } = yield* setup;
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* chat.when.press("GPT-5.4");
          yield* chat.when.press("Supervised", "radio");
          yield* chat.when.key("Escape");
          yield* chat.when.send("Ask before you change anything");
          yield* chat.then.once("Ask before you change anything");
          yield* Effect.promise(() => chat.fixture().waitForTurn("Ask before you change anything"));
          expect(chat.fixture().accessModes()).toEqual(["approval-required"]);
          yield* chat.when.reload("Ada", "Ask before you change anything");
          yield* chat.then.text("Supervised");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Catches plan mode, turned on in settings, not reaching the agent with the message it was picked for.
    it.effect("with plan mode on, a message sent in plan mode goes to the agent as a plan", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.when.visit("/settings/general");
        yield* chat.when.press("Legacy features");
        yield* chat.when.press("Plan mode (legacy)", "switch");
        yield* chat.when.visit("/env-Ada/thread-Ada");
        yield* chat.then.ready("Ada");
        yield* chat.when.press("Default mode — click to enter plan mode");
        yield* chat.then.control("Plan mode — click to return to normal build mode");
        yield* chat.when.send("Plan the worker's migration");
        yield* chat.then.once("Plan the worker's migration");
        const sent = yield* Effect.promise(() =>
          chat.fixture().waitForTurn("Plan the worker's migration"),
        );
        expect(sent.plan).toBe(true);
        expect(chat.fixture().sentTurnCount()).toBe(1);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a removed signer's login leaving Send enabled in an open chat.
    it.effect("offboarding the signer blocks new turns without losing history", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        chat.fixture().ownership = "owner";
        yield* s.given.signedIn;
        yield* chat.when.open();
        const sent = chat.fixture().sentTurnCount();
        chat.fixture().offboardSigner();
        yield* chat.then.signInRequired;
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.when.attemptSend("Do not start a turn on the removed login");
        yield* chat.then.noText("Do not start a turn on the removed login");
        expect(chat.fixture().sentTurnCount()).toBe(sent);
        expect(chat.fixture().responseCount()).toBe(0);
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );

    // Catches a still-ponging platform receiver keeping a revoked conversation or write controls.
    it.effect("project revocation withdraws the open Mate while its receiver still pongs", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* setup;
        yield* s.given.project("Bea", { mate: true });
        yield* Effect.promise(() => s.clock.install());
        yield* s.given.signedIn;
        yield* chat.when.open();
        yield* chat.then.text("The existing conversation is still here");
        const sent = chat.fixture().sentTurnCount();
        yield* projectAccessRevoked(s, "Ada");
        yield* chat.then.noText("The existing conversation is still here");
        yield* chat.then.noComposer;
        yield* s.then.menu.row("Bea").appears();
        expect(chat.fixture().sentTurnCount()).toBe(sent);
        yield* s.then.noReload;
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
