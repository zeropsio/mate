import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HqStreamMessage } from "@t3tools/shared/hqStream";
import { createScenario } from "../../harness/scenario.ts";
import { transportGate } from "../../harness/transportGate.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";

describe("a remembered conversation's Mate identity", () => {
  scenarioSuite((it) => {
    it.effect(
      "a remembered Mate keeps its name and face while navigation precedes its overview",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          yield* s.given.project("Cyd", { mate: true });
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Cyd");
          yield* s.then.conversation.appears;
          const mate = s.drivers.realMates.get("Cyd")!;
          yield* mate.provider.turn([
            { kind: "tool", title: "Inspect the existing project" },
            { kind: "say", text: "The completed inspection stays in history." },
          ]);
          yield* s.when.conversation.sends("Inspect this project");
          expect((yield* mate.provider.received).input.input).toBe("Inspect this project");
          yield* s.then.conversation.showsMessage("The completed inspection stays in history.");
          yield* Effect.promise(async () => {
            const rail = (await s.page.$('[data-sidebar="rail"]'))!;
            const box = (await rail.boundingBox())!;
            const width = await s.page.$eval(
              '[data-sidebar="sidebar"]',
              (node) => node.getBoundingClientRect().width,
            );
            await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await s.page.mouse.down();
            await s.page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
            await s.page.mouse.up();
            await s.page.waitForFunction(
              () =>
                document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect()
                  .width === 435,
            );
            await s.page.waitForFunction(() =>
              [...document.querySelectorAll("[data-run-head]")].some(
                (head) =>
                  head.textContent?.includes("Cyd") && head.closest('[data-run-fold="folded"]'),
              ),
            );
            await waitForStillFrames(s.page);
          });
          const before = yield* Effect.promise(() =>
            s.page.$eval('[data-run-head] [data-zerops-primitive="mate-face"]', (face) => ({
              shape: face.getAttribute("data-mate-face-shape"),
              tint: face.getAttribute("data-mate-face-tint"),
            })),
          );
          // Hold exact Core overview deliveries; complete navigation and real Mate history pass.
          const hq = yield* Effect.promise(() => transportGate(() => s.drivers.hq.origin, ""));
          s.drivers.cleanup.push(hq.close);
          s.drivers.routes["https://hqzone.prg1-zerops.zone"] = hq.origin;
          yield* Effect.promise(() => s.web.setRoutes());
          const overview = hq.holdFrames((frame) => {
            if (frame.isBinary) return false;
            const message = Schema.decodeUnknownSync(HqStreamMessage)(
              JSON.parse(Buffer.from(frame.bytes).toString()),
            );
            return (
              "scope" in message &&
              message.scope.kind === "attention" &&
              message.scope.projectId === "Cyd"
            );
          });
          yield* Effect.promise(() => s.page.reload());
          yield* Effect.promise(() => overview.held);
          yield* s.then.conversation.showsMessage("The completed inspection stays in history.");
          const trace = yield* Effect.promise(() =>
            s.page.evaluateHandle(() => {
              const state = {
                active: true,
                frames: [] as Array<{
                  text: string;
                  shape: string | null;
                  tint: string | null;
                  animations: string[];
                }>,
              };
              const sample = () => {
                const head = [...document.querySelectorAll("[data-run-head]")].find(
                  (node) => node.getBoundingClientRect().height > 0,
                );
                if (head) {
                  const face = head.querySelector('[data-zerops-primitive="mate-face"]');
                  state.frames.push({
                    text: head.textContent ?? "",
                    shape: face?.getAttribute("data-mate-face-shape") ?? null,
                    tint: face?.getAttribute("data-mate-face-tint") ?? null,
                    animations: document
                      .getAnimations()
                      .flatMap((animation) =>
                        "animationName" in animation &&
                        typeof animation.animationName === "string" &&
                        head.contains(
                          animation.effect instanceof KeyframeEffect
                            ? animation.effect.target
                            : null,
                        )
                          ? [animation.animationName]
                          : [],
                      ),
                  });
                }
                if (state.active) requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
              return state;
            }),
          );
          yield* Effect.promise(() =>
            s.page.waitForFunction((state) => state.frames.length >= 30, { polling: "raf" }, trace),
          );
          overview.release();
          yield* Effect.promise(() =>
            s.page.waitForFunction((state) => state.frames.length >= 60, { polling: "raf" }, trace),
          );
          yield* Effect.promise(() => waitForStillFrames(s.page));
          const frames = yield* Effect.promise(() =>
            trace.evaluate((state) => {
              state.active = false;
              return state.frames;
            }),
          );
          expect(
            frames.filter((frame) => !frame.text.includes("Cyd")),
            "ASSERTION: every painted historical summary retains Cyd while HQ's overview arrives",
          ).toEqual([]);
          expect(
            frames.filter((frame) => frame.shape !== before.shape || frame.tint !== before.tint),
            "ASSERTION: the remembered summary never wears a placeholder face",
          ).toEqual([]);
          expect(
            frames
              .flatMap((frame) => frame.animations)
              .filter((name) => name === "run-now-in" || name === "run-now-out"),
            "ASSERTION: overview arrival never replays historical summary entrances",
          ).toEqual([]);
          yield* Effect.promise(() => trace.dispose());
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
