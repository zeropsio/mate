import { scenarioSuite } from "../../harness/suite.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";
import { ownerMenu, recordReload, type ReloadFrame } from "./ownerReportedLayout.ts";

describe("owner-reported layout regressions", () => {
  describe("Decision: geometry relations only; no style pins.", () => {
    scenarioSuite((it) => {
      // The owner, 2026-11-11: "the load experience is horrible … things are popping up in random,
      // there is no system, no coordination". One frame, then the menu's fill and the page's.
      // witness: apps/web/src/components/zerops/MateLinkStage.tsx | {panel === null && opens ? <HeaderControlsStandIn /> : null} → {null}
      it.effect("a reload paints the whole frame first and moves nothing after", () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
          // Three Mates: the menu remembers three rows, not the one it draws knowing nothing.
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.project("Bea", { mate: true });
          yield* s.given.project("Cyd", { mate: true });
          const chat = mateChat(s);
          chat
            .fixture()
            .exchange("Previous navigation", "The existing conversation is still here.");
          yield* s.given.signedIn;
          yield* Effect.promise(() => ownerMenu(s.page));
          yield* chat.when.open();
          // The visit a reload remembers: the conversation shown, with its composer.
          yield* Effect.promise(async () => {
            await s.page.waitForSelector('main [data-testid="composer-editor"]', { visible: true });
            await waitForStillFrames(s.page, { stillFrames: 30 });
          });
          const frames = yield* Effect.promise(async () => {
            await s.page.evaluateOnNewDocument(recordReload);
            await s.page.reload({ waitUntil: "domcontentloaded" });
            await s.page.waitForFunction(() => {
              const frames = (window as unknown as { reloadFrames?: ReloadFrame[] }).reloadFrames;
              const last = frames?.at(-1);
              return last !== undefined && last.shown && last.rows > 0;
            });
            await waitForStillFrames(s.page, { stillFrames: 30 });
            return s.page.evaluate(
              () => (window as unknown as { reloadFrames: ReloadFrame[] }).reloadFrames,
            );
          });
          const trace = frames.map((frame) => JSON.stringify(frame)).join("\n");
          const first = frames[0]!;
          const last = frames.at(-1)!;
          for (const [part, box] of Object.entries(first.parts)) {
            expect(box, `ASSERTION: the first frame draws ${part}:\n${trace}`).not.toBeNull();
            expect(
              new Set(frames.map((frame) => frame.parts[part])).size,
              `ASSERTION: ${part} stays where the first frame drew it, and never leaves:\n${trace}`,
            ).toBe(1);
          }
          expect(last.rows, `ASSERTION: the menu lists its three Mates:\n${trace}`).toBe(3);
          expect(
            first.rows === 0 ? first.loadingRows : first.rows,
            `ASSERTION: the menu waits with as many rows as it then draws:\n${trace}`,
          ).toBe(last.rows);
          expect(
            new Set(frames.map((frame) => frame.rows)).size,
            `ASSERTION: the menu's rows come in one frame:\n${trace}`,
          ).toBeLessThanOrEqual(2);
          // Inside the frame: once a row, a control or a line is painted it stays where it is,
          // and what it says of the person and of each Mate is said once.
          for (const name of new Set(frames.flatMap((frame) => Object.keys(frame.inner)))) {
            const from = frames.findIndex((frame) => (frame.inner[name] ?? null) !== null);
            expect(
              new Set(frames.slice(from).map((frame) => frame.inner[name] ?? null)).size,
              `ASSERTION: ${name}, once painted, neither moves nor leaves:\n${trace}`,
            ).toBe(1);
          }
          for (const name of new Set(frames.flatMap((frame) => Object.keys(frame.words)))) {
            expect(
              new Set(frames.map((frame) => frame.words[name] ?? "").filter((word) => word !== ""))
                .size,
              `ASSERTION: ${name} says one thing, never replaced:\n${trace}`,
            ).toBeLessThanOrEqual(1);
          }
          for (const control of ["control0", "control1"])
            expect(
              first.inner[control] ?? null,
              `ASSERTION: the first frame draws the header's ${control}:\n${trace}`,
            ).not.toBeNull();
          expect(
            frames.filter((frame, at) => at > 0 && frame.shown !== frames[at - 1]!.shown).length,
            `ASSERTION: the conversation comes once, and is not taken back:\n${trace}`,
          ).toBeLessThanOrEqual(1);
          // The composer comes with its conversation: no box stands for it before.
          expect(
            frames.filter((frame) => !frame.shown && (frame.inner["composer"] ?? null) !== null)
              .length,
            `ASSERTION: no composer stands before the conversation, empty or not:\n${trace}`,
          ).toBe(0);
        }),
      );
    });
  });
});
