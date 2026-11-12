import { scenarioSuite } from "../../harness/suite.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { ownerMenu, recordSwitch, type SwitchFrame } from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  describe("Decision: geometry relations only; no style pins.", () => {
    scenarioSuite((it) => {
      // The owner, 2026-11-12: "it's not just reload, similar problems have even switching between
      // cold mates", and of the empty box that then stood through the switch: "why is the composer
      // getting stuck when switching between mates? and then disappears before the actual convo
      // loads". The header's bar stays; the composer comes with its conversation.
      // witness: apps/web/src/components/chat/ConversationOpeningStage.tsx | "data-opening-waits-foot": wait === "" ? undefined : wait, → "data-opening-waits-foot": undefined,
      it.effect(
        "a switch to a Mate not opened here keeps the header's bar, and no composer stands before its conversation",
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([installArea]);
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            yield* s.given.project("Ada", { mate: true });
            yield* s.given.project("Bea", { mate: true });
            const chat = mateChat(s);
            for (const name of ["Ada", "Bea"])
              chat
                .fixture(name)
                .exchange("Previous navigation", "The existing conversation is still here.");
            yield* s.given.signedIn;
            yield* Effect.promise(() => ownerMenu(s.page));
            yield* chat.when.open();
            yield* Effect.promise(async () => {
              await s.page.waitForSelector('main [data-testid="composer-editor"]', {
                visible: true,
              });
              await waitForStillFrames(s.page, { stillFrames: 30 });
              await s.page.evaluate(recordSwitch);
            });
            // Bea's conversation was never opened in this page, nor remembered by this browser.
            yield* chat.when.open("Bea");
            const frames = yield* Effect.promise(async () => {
              await waitForStillFrames(s.page, { stillFrames: 30 });
              return s.page.evaluate(() => {
                const frames = (
                  window as unknown as { switchFrames: SwitchFrame[] & { stop?: boolean } }
                ).switchFrames;
                frames.stop = true;
                return [...frames];
              });
            });
            const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
            const first = frames[0]!;
            expect(
              frames.filter((frame, at) => at > 0 && frame.shown !== frames[at - 1]!.shown).length,
              `ASSERTION: the conversation left for a stage, and the next came once:\n${trace}`,
            ).toBe(2);
            for (const part of ["header", "controls"] as const)
              expect(
                new Set(frames.map((frame) => frame[part])),
                `ASSERTION: the header's ${part} stay where they stood, through the switch:\n${trace}`,
              ).toEqual(new Set([first[part]]));
            expect(first.composer, `ASSERTION: a composer stood:\n${trace}`).not.toBeNull();
            expect(
              frames.filter((frame) => !frame.shown && frame.composer !== null).length,
              `ASSERTION: under the stage no composer stands, empty or not:\n${trace}`,
            ).toBe(0);
            expect(
              frames.filter(
                (frame, at) =>
                  at > 0 && (frame.composer === null) !== (frames[at - 1]!.composer === null),
              ).length,
              `ASSERTION: the composer leaves once and comes once, with the conversation:\n${trace}`,
            ).toBe(2);
          }),
      );
    });
  });
});
