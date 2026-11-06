import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";

/** The sent message, each frame: where the page is and how visible the message is. */
interface SendFrame {
  readonly draft: boolean;
  readonly opacity: number | null;
  readonly submitted: boolean;
  readonly composerShowsMessage: boolean;
  readonly top: number | null;
}

describe("owner-reported layout regressions", () => {
  scenarioSuite((it) => {
    // Seen on a first prompt (run 2): the sent message faded out with the draft and faded back in
    // with its conversation, as if it had been thrown away and sent again.
    it.effect(
      "a first message sent from a Mate's draft stays shown as the draft becomes its conversation, never eased in again",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          yield* Effect.promise(() => waitForStillFrames(s.page));
          const trace = yield* Effect.promise(() =>
            s.page.evaluateHandle(() => {
              const state = { active: true, submitted: false, frames: [] as SendFrame[] };
              const onSend = (event: KeyboardEvent) => {
                if (event.key === "Enter" && !event.shiftKey) state.submitted = true;
              };
              document.addEventListener("keydown", onSend, true);
              const tick = () => {
                if (!state.active) return;
                const message = [...document.querySelectorAll('[data-message-role="user"]')].at(-1);
                let opacity: number | null = message === undefined ? null : 1;
                for (
                  let at = message ?? null;
                  at !== null && opacity !== null;
                  at = at.parentElement
                ) {
                  const style = getComputedStyle(at);
                  opacity =
                    style.display === "none" || style.visibility === "hidden"
                      ? 0
                      : opacity * Number(style.opacity);
                }
                state.frames.push({
                  draft: location.pathname.includes("/draft/"),
                  opacity,
                  submitted: state.submitted,
                  top: message?.getBoundingClientRect().top ?? null,
                  composerShowsMessage: [
                    ...document.querySelectorAll<HTMLElement>('[role="textbox"]'),
                  ].some((box) => {
                    if (!box.textContent?.includes("Keep the message in sight")) return false;
                    for (let at: HTMLElement | null = box; at !== null; at = at.parentElement) {
                      const style = getComputedStyle(at);
                      if (
                        style.display === "none" ||
                        style.visibility === "hidden" ||
                        Number(style.opacity) !== 1
                      )
                        return false;
                    }
                    return true;
                  }),
                });
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
              return {
                frames: state.frames,
                stop: () => {
                  state.active = false;
                  document.removeEventListener("keydown", onSend, true);
                },
              };
            }),
          );
          yield* s.drivers.realMates
            .get("Ada")!
            .provider.turn([{ kind: "say", text: "The conversation is here." }]);
          yield* s.when.conversation.sends("Keep the message in sight");
          yield* s.then.conversation.showsMessage("The conversation is here.");
          yield* Effect.promise(() => waitForStillFrames(s.page));
          const frames = yield* Effect.promise(async () => {
            const frames = await trace.evaluate((recording) => {
              recording.stop();
              return recording.frames;
            });
            await trace.dispose();
            return frames;
          });
          const promoted = frames.findIndex((frame) => !frame.draft);
          expect(promoted, "ASSERTION: the draft became its conversation").toBeGreaterThan(0);
          expect(
            frames.slice(0, promoted).some((frame) => (frame.opacity ?? 0) > 0),
            "ASSERTION: the draft showed the sent message",
          ).toBe(true);
          const trail = frames
            .slice(promoted, promoted + 16)
            .map((frame) => (frame.opacity === null ? "-" : frame.opacity.toFixed(2)))
            .join(" ");
          expect(
            frames.slice(promoted).filter((frame) => frame.opacity !== 1),
            `The conversation shows the message as the draft did, never easing it in again: ${trail}`,
          ).toEqual([]);
          expect(
            frames.some((frame) => frame.submitted),
            "ASSERTION: the send was observed",
          ).toBe(true);
          expect(
            frames.filter(
              (frame) => frame.submitted && frame.opacity !== 1 && !frame.composerShowsMessage,
            ),
            "The submitted words stay visible in the composer or the conversation in every frame",
          ).toEqual([]);
          const messageTops = frames.flatMap((frame) =>
            frame.submitted && frame.opacity === 1 && frame.top !== null ? [frame.top] : [],
          );
          expect(messageTops.length, "ASSERTION: the sent message was visible").toBeGreaterThan(0);
          expect(
            Math.max(...messageTops) - Math.min(...messageTops),
            "The sent message stays in place as its draft becomes the conversation",
          ).toBeLessThanOrEqual(1);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
