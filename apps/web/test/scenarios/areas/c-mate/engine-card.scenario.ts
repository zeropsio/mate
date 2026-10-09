import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { EngineChatWire } from "./engine.ts";
import { installArea } from "./fake.ts";
import { TARGET_QUESTION } from "./wire.ts";

/** What the conversation shows, frame by frame, while something happens to it. */
interface Frame {
  /** The list's scroll position. */
  readonly top: number;
  /** How far the view stands from the list's end. */
  readonly end: number;
  /** The last card's height. */
  readonly card: number;
  /** Where the person's message the journey watches stands on screen; null off it. */
  readonly anchor: number | null;
}

/** A conversation long enough to scroll, at its end, with a run of the stress test's shape. */
const longConversation = Effect.gen(function* () {
  const s = yield* createScenario([installArea]);
  yield* s.given.project("Ada", { mate: true });
  const chat = mateChat(s);
  for (const round of [1, 2, 3])
    chat
      .fixture()
      .exchange(
        `How did deploy ${round} go?`,
        "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(30),
      );
  chat.fixture().exchange("And now?", "The existing conversation is still here");
  yield* s.given.signedIn;
  yield* chat.when.open();
  yield* chat.then.text("The existing conversation is still here");
  const wire = chat.fixture().wire;
  if (!(wire instanceof EngineChatWire)) throw new Error("This journey runs on the engine's wire");
  return { s, chat, engine: wire.engine };
});

/** Starts sampling every frame; `read` stops and returns what it saw. */
const trace = (page: import("puppeteer-core").Page, anchorText: string) =>
  Effect.promise(() =>
    page.evaluate((anchorText) => {
      const frames: Frame[] = [];
      const state = { active: true };
      const anchorOf = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.includes(anchorText)) continue;
          const box = node.parentElement?.getBoundingClientRect();
          if (box && box.height > 0) return box.top;
        }
        return null;
      };
      const sample = () => {
        const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
        const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
        if (outer)
          frames.push({
            top: outer.scrollTop,
            end: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
            card: card?.getBoundingClientRect().height ?? 0,
            anchor: anchorOf(),
          });
        if (state.active) requestAnimationFrame(sample);
      };
      (window as unknown as { engineCardTrace: unknown }).engineCardTrace = { frames, state };
      sample();
    }, anchorText),
  );

const readTrace = (page: import("puppeteer-core").Page, ms: number) =>
  Effect.promise(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return page.evaluate(() => {
      const held = (
        window as unknown as {
          engineCardTrace: { frames: Frame[]; state: { active: boolean } };
        }
      ).engineCardTrace;
      held.state.active = false;
      return held.frames;
    });
  });

/**
 * The largest move between two frames running, of what `of` reads. A glide to the end steps a few
 * tens of pixels a frame; a jump moves the whole of what changed at once (250 px in Milo's run).
 */
const largestStep = (frames: ReadonlyArray<Frame>, of: (frame: Frame) => number | null) => {
  let largest = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const before = of(frames[index - 1]!);
    const after = of(frames[index]!);
    if (before === null || after === null) continue;
    largest = Math.max(largest, Math.abs(after - before));
  }
  return largest;
};

describe("C: an engine Mate's run card in a live conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Milo's stress run: the card waited on a background job, folded when the job ended, and the
    // run the job's end woke snapped it open 532 px in one frame and scrolled the page 768 px.
    it.effect(
      "a run its job's end wakes goes on in the folded card without moving the page, its answer under the reply the person was reading",
      () =>
        Effect.gen(function* () {
          const { s, chat, engine } = yield* longConversation;
          const run = engine.personRun("Start the wait in the background");
          engine.item(run, {
            kind: "call",
            step: "command",
            tool: { name: "Bash" },
            words: "Command run",
            state: "done",
            endedAt: 1791552412202,
            input: "Bash: sleep 45 && echo done",
            shows: {
              toolName: "Bash",
              command: "sleep 45 && echo done",
              input: { description: "Wait 45 seconds in the background, then print done" },
              rawOutput: {
                content:
                  "Command running in background with ID: b1job. Output is being written to: /tmp/x",
              },
            },
          });
          const job = engine.item(run, {
            kind: "work",
            work: "session.w2",
            workKind: "shell",
            status: "running",
            title: "Wait 45 seconds in the background, then print done",
          });
          engine.note(run, "The background wait hasn't printed yet.", { kind: "completed" });
          yield* chat.then.text("Waiting for its background command");
          engine.update(job, { status: "completed" });
          yield* chat.then.noText("Waiting for its background command");
          yield* chat.then.noText("running in the background");
          // The fold eases shut; the page is still once it has.
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1)?.dataset
                  .runFold === "folded",
              { polling: "raf", timeout: 8000 },
            ),
          );
          // Milo's third stress run: the reply under the folded card vanished into it at the wake,
          // and the wake's answer landed 798 px below the view.
          yield* trace(s.page, "The background wait hasn't printed yet.");
          const wake = engine.startRun(run);
          engine.note(wake, "The background wait finished and printed done.", {
            kind: "completed",
          });
          yield* chat.then.text("The background wait finished and printed done.");
          const frames = yield* readTrace(s.page, 1500);
          expect(frames.length, "ASSERTION: the wake was sampled").toBeGreaterThan(20);
          expect(
            largestStep(frames, (frame) => frame.card),
            "ASSERTION: the card never snaps open in one frame",
          ).toBeLessThan(48);
          expect(
            Math.max(...frames.map((frame) => frame.card)) -
              Math.min(...frames.map((frame) => frame.card)),
            "ASSERTION: the folded card keeps its height while the woken run goes on in it",
          ).toBeLessThan(48);
          expect(
            largestStep(frames, (frame) => frame.top),
            "ASSERTION: the list never jumps",
          ).toBeLessThan(120);
          expect(frames.at(-1)!.end, "ASSERTION: the view ends at the conversation's end").toBe(0);
          expect(
            frames.every((frame) => frame.anchor !== null),
            "ASSERTION: the reply the person was reading stays on screen through the wake",
          ).toBe(true);
          expect(
            largestStep(frames, (frame) => frame.anchor),
            "ASSERTION: the reply the person was reading never jumps as the wake answers",
          ).toBeLessThan(120);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Milo's stress run: the question opening in the composer pushed the conversation up 250 px in
    // one frame, and the answer pulled it back down.
    it.effect("a question opening in the composer and its answer never move the conversation", () =>
      Effect.gen(function* () {
        const { s, chat, engine } = yield* longConversation;
        // The agent works on after the answer, as Milo did: the run neither ends nor settles.
        engine.onAnswer.splice(0, engine.onAnswer.length, (request) => {
          engine.note(request.runId, "You chose staging.");
        });
        const run = engine.personRun("Lay out the summary for me");
        engine.note(run, "Step 8: your choice of format.");
        yield* chat.then.text("Step 8: your choice of format.");
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
        yield* trace(s.page, "Step 8: your choice of format.");
        engine.ask(
          { kind: "question", questions: [TARGET_QUESTION], dismissible: false },
          { runId: run },
        );
        yield* chat.then.text("Which environment should I inspect?");
        const asked = yield* readTrace(s.page, 600);
        const anchored = asked.flatMap((frame) => (frame.anchor === null ? [] : [frame]));
        expect(anchored.length, "ASSERTION: the conversation's last words stayed on screen").toBe(
          asked.length,
        );
        // The card's own line takes the question as it comes; the composer's question moves nothing.
        const grew = Math.max(...asked.map((f) => f.card)) - Math.min(...asked.map((f) => f.card));
        expect(
          Math.max(...anchored.map((f) => f.anchor!)) - Math.min(...anchored.map((f) => f.anchor!)),
          `ASSERTION: the question opening moves the conversation no more than the card grew`,
        ).toBeLessThanOrEqual(grew + 2);
        expect(
          largestStep(asked, (frame) => frame.anchor),
          "ASSERTION: the conversation never jumps as the question opens",
        ).toBeLessThan(60);
        yield* trace(s.page, "Step 8: your choice of format.");
        yield* chat.when.click("Staging");
        yield* chat.then.text("You chose staging.");
        const answered = yield* readTrace(s.page, 600);
        expect(answered.filter((frame) => frame.anchor !== null).length).toBeGreaterThan(10);
        // What the answer brings eases in at the end; the question closing moves nothing at once.
        expect(
          largestStep(answered, (frame) => frame.anchor),
          `ASSERTION: the conversation never jumps as the answer closes the question`,
        ).toBeLessThan(60);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Milo's stress run: a reload painted older turns first, then scrolled about 1,000 px to the
    // end over 1.5 s.
    it.effect("a reload paints the conversation's end first and nothing it takes back", () =>
      Effect.gen(function* () {
        const { s, chat } = yield* longConversation;
        yield* Effect.promise(() =>
          s.page.evaluateOnNewDocument(() => {
            const frames: Array<{ end: number; top: number }> = [];
            const sample = () => {
              const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
              if (outer && outer.scrollHeight > outer.clientHeight + 4)
                frames.push({
                  end: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                  top: outer.scrollTop,
                });
              if (frames.length < 240) requestAnimationFrame(sample);
            };
            (window as unknown as { reloadFrames: unknown }).reloadFrames = frames;
            requestAnimationFrame(sample);
          }),
        );
        yield* chat.when.reload();
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 1500)));
        const frames = yield* Effect.promise(() =>
          s.page.evaluate(
            () =>
              (window as unknown as { reloadFrames: Array<{ end: number; top: number }> })
                .reloadFrames,
          ),
        );
        expect(frames.length, "ASSERTION: the reload's paint was sampled").toBeGreaterThan(10);
        expect(
          Math.max(...frames.map((frame) => frame.end)),
          "ASSERTION: every painted frame stands at the conversation's end",
        ).toBeLessThanOrEqual(2);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
