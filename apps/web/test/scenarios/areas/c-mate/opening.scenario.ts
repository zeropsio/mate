import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";

describe("C: the conversation opening follows readiness", () => {
  scenarioSuite((it) => {
    it.effect(
      "one waiting stage hands over to the ready conversation: owner-light-wide-sidebar",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture("Sage");
          wire.exchange("Earlier question", "Sage's conversation is ready");
          const read = wire.engine.holdOpen();
          yield* Effect.addFinalizer(() => Effect.sync(read.release));
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* Effect.promise(() =>
            s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]),
          );
          // The engine's read receipt keeps readiness pending. A second CDP Fetch session
          // competes with the scenario router's request interception and can strand the chunk.
          // Route transfer itself is pinned by ConversationOpeningStage.test.tsx.
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerViewport(s.page));
          yield* chat.when.openReadOnly("Sage");
          yield* Effect.promise(read.requested);
          yield* Effect.promise(() =>
            s.page.waitForSelector('[data-conversation-opening="waiting"]'),
          );
          const stage = yield* Effect.promise(() =>
            s.page.$('[data-conversation-opening="waiting"]'),
          );
          expect(stage).not.toBeNull();
          const count = () =>
            s.page.$$eval(
              ':is([data-chat-workspace-drop-target], [data-zerops-surface="mate-coming-page"]) [data-mate-face-state]',
              (faces) =>
                faces.filter(
                  (face) =>
                    face.getBoundingClientRect().height > 0 &&
                    getComputedStyle(face).opacity !== "0",
                ).length,
            );
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => {
                const face = document.querySelector<HTMLElement>(
                  '[data-conversation-opening="waiting"] [data-mate-face-state]',
                );
                return (
                  face !== null &&
                  face.getBoundingClientRect().height > 0 &&
                  getComputedStyle(face).opacity !== "0"
                );
              },
              { polling: "raf" },
            ),
          );
          expect(yield* Effect.promise(count)).toBe(1);
          yield* chat.then.noText("Sage's conversation is ready");
          const trace = yield* Effect.promise(() =>
            s.page.evaluateHandle(() => {
              const state = {
                active: true,
                gap: false,
                eyes: null as null | { open: boolean; shut: boolean },
              };
              const sample = () => {
                if (!state.active) return;
                const stage = document.querySelector<HTMLElement>("[data-conversation-opening]")!;
                const phase = stage.getAttribute("data-conversation-opening");
                if (
                  phase !== "complete" &&
                  (stage.getBoundingClientRect().height === 0 ||
                    getComputedStyle(stage).visibility === "hidden")
                )
                  state.gap = true;
                if (phase === "hand-off" && state.eyes === null) {
                  const eyes = [...stage.querySelectorAll("[data-mate-face-eye]")];
                  state.eyes = {
                    open:
                      eyes.length === 2 &&
                      eyes.every((eye) => getComputedStyle(eye).opacity === "1"),
                    shut: [...stage.querySelectorAll("[data-mate-face-shut]")].some(
                      (eye) => getComputedStyle(eye).opacity !== "0",
                    ),
                  };
                }
                requestAnimationFrame(sample);
              };
              sample();
              return state;
            }),
          );
          read.release();
          yield* chat.then.text("Sage's conversation is ready");
          yield* Effect.promise(() => waitForStillFrames(s.page));
          expect(
            yield* Effect.promise(() =>
              stage!.evaluate((node) => node.getAttribute("data-conversation-opening")),
            ),
          ).toBe("complete");
          expect(yield* Effect.promise(count)).toBe(1);
          expect(
            yield* Effect.promise(() =>
              trace.evaluate((state) => {
                state.active = false;
                return { gap: state.gap, eyes: state.eyes };
              }),
            ),
          ).toEqual({ gap: false, eyes: { open: true, shut: false } });
          yield* Effect.promise(() => trace.dispose());
          const exposure = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const input = document.querySelector('[data-conversation-footer] [role="textbox"]')!;
              const box = input.getBoundingClientRect();
              return {
                width: box.width,
                height: box.height,
                visible: input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
                exposed: [0.2, 0.5, 0.8].every((fraction) =>
                  input.contains(
                    document.elementFromPoint(
                      box.left + box.width * fraction,
                      box.top + box.height / 2,
                    ),
                  ),
                ),
              };
            }),
          );
          expect(exposure.width).toBeGreaterThan(32);
          expect(exposure.height).toBeGreaterThan(8);
          expect(exposure.visible).toBe(true);
          expect(exposure.exposed, "ASSERTION: nothing covers the ready composer").toBe(true);
          yield* s.then.noExternalNetwork;
        }),
      10_000,
    );
  });
});
