import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";

const longConversation = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  const wire = chat.fixture();
  for (const round of [1, 2, 3])
    wire.exchange(`Deploy ${round}`, "Deployment logs are clean.\n\n".repeat(30));
  wire.exchange("And now?", "The existing conversation is still here");
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  yield* s.given.signedIn;
  yield* Effect.promise(() => ownerViewport(s.page));
  yield* chat.when.open();
  yield* Effect.promise(() => waitForStillFrames(s.page));
  return { s, chat, wire };
});

describe("C: an engine Mate's run card in a live conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a reload paints the conversation's end first and nothing it takes back", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* longConversation;
        yield* Effect.promise(() =>
          s.page.evaluateOnNewDocument(() => {
            const ends: number[] = [];
            Reflect.set(window, "reloadEnds", ends);
            const sample = () => {
              const list = document.querySelector<HTMLElement>(".timeline-legend-list");
              if (
                list &&
                list.getBoundingClientRect().height > 0 &&
                !list.closest("[data-timeline-placing]")
              ) {
                let visible = true;
                for (let node: HTMLElement | null = list; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (
                    style.opacity === "0" ||
                    style.visibility === "hidden" ||
                    node.hasAttribute("inert")
                  )
                    visible = false;
                }
                if (visible) ends.push(list.scrollHeight - list.clientHeight - list.scrollTop);
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }),
        );
        yield* Effect.promise(() => s.page.reload());
        yield* chat.then.text("The existing conversation is still here");
        yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 12 }));
        const ends = yield* Effect.promise(() =>
          s.page.evaluate(() => Reflect.get(window, "reloadEnds") as number[]),
        );
        expect(ends.length).toBeGreaterThan(10);
        expect(
          Math.max(...ends),
          "ASSERTION: every visible reload frame is already at the conversation end",
        ).toBeLessThanOrEqual(2);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
