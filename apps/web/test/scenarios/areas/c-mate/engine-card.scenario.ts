import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import type { EngineChatWire } from "./engine.ts";
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
  return { s, chat, engine: wire.engine };
});

// Real history is authored by the provider and committed by the same engine the browser reads.
const realLongConversation = Effect.gen(function* () {
  const s = yield* createScenario([], { mate: "real" });
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  yield* s.given.project("Ada", { mate: true });
  const provider = s.drivers.realMates.get("Ada")!.provider;
  const chat = mateChat(s);
  yield* s.given.signedIn;
  yield* s.when.menu.opensMate("Ada");
  yield* s.then.conversation.appears;
  for (const round of [1, 2, 3]) {
    const answer =
      "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(30);
    yield* provider.turn([{ kind: "say", text: answer }]);
    yield* s.when.conversation.sends(`How did deploy ${round} go?`);
    yield* s.then.conversation.showsMessage(
      "The shop's deploy built, its logs are clean and the storefront answers.",
    );
  }
  yield* provider.turn([{ kind: "say", text: "The existing conversation is still here" }]);
  yield* s.when.conversation.sends("And now?");
  yield* s.then.conversation.showsMessage("The existing conversation is still here");
  return { s, chat, provider };
});

/** Calls `step` with 1, 2, 3… every tenth of a second, on the page's own time, until stopped. */
function everyTenth(step: (count: number) => void): { readonly stop: () => void } {
  let count = 0;
  const timer = setInterval(() => step((count += 1)), 100);
  return { stop: () => clearInterval(timer) };
}

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
          if (!node.parentElement?.closest("[data-timeline-thread]")) continue;
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

/** The list's distance from its end once it has come to rest: the glide out of the room a settle
 * held can still be landing when a trace ends, on a slow runner by a few pixels. */
const restingEnd = (page: import("puppeteer-core").Page) =>
  Effect.promise(async () => {
    const gap = () =>
      page.evaluate(() => {
        const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
        return outer ? outer.scrollHeight - outer.clientHeight - outer.scrollTop : Number.NaN;
      });
    let last = await gap();
    for (let waited = 0; waited < 3000 && !(last <= 1); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      last = await gap();
    }
    return last;
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

/**
 * The person's run that leaves a command waiting in the background, ended with `answer` (or with
 * no words), its job ended since.
 */
const jobRun = (
  chat: ReturnType<typeof mateChat>,
  engine: EngineChatWire["engine"],
  answer: string | null,
) =>
  Effect.gen(function* () {
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
    if (answer === null) engine.end(run);
    else engine.note(run, answer, { kind: "completed" });
    yield* chat.then.text("Waiting for its background command");
    engine.update(job, { status: "completed" });
    yield* chat.then.noText("Waiting for its background command");
    yield* chat.then.noText("running in the background");
    return run;
  });

/** The last card folds as its wait ends; the page is still once it has. */
const foldedCard = (page: import("puppeteer-core").Page) =>
  Effect.promise(() =>
    page.waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1)?.dataset.runFold ===
        "folded",
      { polling: "raf", timeout: 8000 },
    ),
  );

describe("C: an engine Mate's run card in a live conversation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // Milo's stress run: the card waited on a background job, folded when the job ended, and the
    // run the job's end woke snapped it open 532 px in one frame and scrolled the page 768 px.
    it.effect("a run its job's end wakes goes on in the folded card without moving the page", () =>
      Effect.gen(function* () {
        const { s, chat, engine } = yield* longConversation;
        // The run ends with no answer: the run the job's end wakes is the same card's to go on in.
        const run = yield* jobRun(chat, engine, null);
        yield* foldedCard(s.page);
        yield* trace(s.page, "Start the wait in the background");
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
        expect(
          yield* restingEnd(s.page),
          "ASSERTION: the view ends at the conversation's end",
        ).toBeLessThanOrEqual(1);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Milo's stress run 4A: the job's end woke Milo, and the card holding the wake's work stood
    // above the answer Milo gave before it. Milo's third: the reply under the folded card vanished
    // into it at the wake, and the wake's answer landed 798 px below the view.
    it.effect(
      "a turn the agent opens itself after a background job ends stands below the answer it gave before",
      () =>
        Effect.gen(function* () {
          const { s, chat, engine } = yield* longConversation;
          const before = "Now waiting for the jobs to end.";
          const after = "The background wait finished and printed done.";
          const run = yield* jobRun(chat, engine, before);
          yield* foldedCard(s.page);
          yield* trace(s.page, before);
          const wake = engine.startRun(run);
          engine.item(wake, {
            kind: "call",
            step: "command",
            tool: { name: "Bash" },
            words: "Command run",
            state: "done",
            endedAt: 1791552412202,
            input: "Bash: cat /tmp/x",
            shows: { toolName: "Bash", command: "cat /tmp/x" },
          });
          engine.note(wake, after, { kind: "completed" });
          yield* chat.then.text(after);
          const frames = yield* readTrace(s.page, 1500);
          expect(frames.length, "ASSERTION: the wake was sampled").toBeGreaterThan(20);
          const order = yield* Effect.promise(() =>
            s.page.evaluate(
              (texts) => {
                const topOf = (text: string) => {
                  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                  while (walker.nextNode()) {
                    const node = walker.currentNode;
                    if (!node.textContent?.includes(text)) continue;
                    const box = node.parentElement?.getBoundingClientRect();
                    if (box && box.height > 0) return box.top;
                  }
                  return null;
                };
                const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
                return {
                  before: topOf(texts.before),
                  card: card?.getBoundingClientRect().top ?? null,
                  after: topOf(texts.after),
                };
              },
              { before, after },
            ),
          );
          expect(
            order.before !== null && order.card !== null && order.before < order.card,
            "ASSERTION: the wake's card stands below the answer given before it",
          ).toBe(true);
          expect(
            order.after !== null && order.card !== null && order.card < order.after,
            "ASSERTION: the wake's answer stands below its card",
          ).toBe(true);
          expect(
            frames.every((frame) => frame.anchor !== null),
            "ASSERTION: the reply the person was reading stays on screen through the wake",
          ).toBe(true);
          expect(
            largestStep(frames, (frame) => frame.anchor),
            "ASSERTION: the reply the person was reading never jumps as the wake answers",
          ).toBeLessThan(120);
          expect(
            yield* restingEnd(s.page),
            "ASSERTION: the view ends at the conversation's end",
          ).toBeLessThanOrEqual(1);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Milo's third stress run: each message sent moved the conversation 130 px in one frame.
    it.effect("a message the person sends moves the conversation by a glide, never a jump", () =>
      Effect.gen(function* () {
        const { s, chat, provider } = yield* realLongConversation;
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
        yield* trace(s.page, "The existing conversation is still here");
        const working = yield* Deferred.make<void>();
        yield* provider.turn([{ kind: "wait", until: working }]);
        yield* chat.when.send("Check the storefront again");
        const frames = yield* readTrace(s.page, 1500);
        expect(frames.length, "ASSERTION: the send was sampled").toBeGreaterThan(20);
        expect(
          largestStep(frames, (frame) => frame.anchor),
          "ASSERTION: the conversation never jumps as the message goes",
        ).toBeLessThan(60);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Milo's third stress run: a steer landing in the running run moved the conversation 105 px.
    it.effect(
      "a message steered into the running run lands above its card without moving the page",
      () =>
        Effect.gen(function* () {
          const { s, chat, engine } = yield* longConversation;
          const run = engine.personRun("Check both pages");
          engine.session();
          engine.note(run, "Checking the first page now.");
          yield* chat.then.text("Checking the first page now.");
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
          yield* trace(s.page, "Checking the first page now.");
          yield* chat.when.send("also tell me the page title");
          yield* chat.when.press("Send now");
          yield* chat.then.once("also tell me the page title");
          expect(
            engine.applied
              .filter(({ op }) => op === "steer")
              .map(({ payload }) => ({ runId: payload.runId, text: payload.text })),
            "ASSERTION: the message was steered into the running run",
          ).toEqual([{ runId: run, text: "also tell me the page title" }]);
          const frames = yield* readTrace(s.page, 1500);
          const order = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              let message: number | null = null;
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (!node.textContent?.includes("also tell me the page title")) continue;
                if (node.parentElement?.closest('[data-message-role="user"]') === null) continue;
                const box = node.parentElement?.getBoundingClientRect();
                if (box && box.height > 0) {
                  message = box.top;
                  break;
                }
              }
              const card = [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1);
              return { message, card: card?.getBoundingClientRect().top ?? null };
            }),
          );
          expect(
            order.message !== null && order.card !== null && order.message < order.card,
            "ASSERTION: the steered message stands above the running run's card",
          ).toBe(true);
          expect(frames.length, "ASSERTION: the steer was sampled").toBeGreaterThan(20);
          expect(
            largestStep(frames, (frame) => frame.anchor),
            "ASSERTION: the conversation never jumps as the steer lands",
          ).toBeLessThan(60);
          yield* s.then.noExternalNetwork;
        }),
    );

    // Milo's stress run: the question opening in the composer pushed the conversation up 250 px in
    // one frame, and the answer pulled it back down.
    it.effect("a question opening in the composer and its answer never move the conversation", () =>
      Effect.gen(function* () {
        const { s, chat, provider } = yield* realLongConversation;
        const questionReady = yield* Deferred.make<void>();
        const keepWorking = yield* Deferred.make<void>();
        yield* provider.turn([
          { kind: "say", text: "Step 8: your choice of format." },
          { kind: "wait", until: questionReady },
          { kind: "ask", question: TARGET_QUESTION.question, options: ["Staging", "Production"] },
          { kind: "say", text: "You chose staging." },
          { kind: "wait", until: keepWorking },
        ]);
        yield* s.when.conversation.sends("Lay out the summary for me");
        yield* chat.then.text("Step 8: your choice of format.");
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 600)));
        yield* trace(s.page, "Step 8: your choice of format.");
        yield* Deferred.succeed(questionReady, undefined);
        yield* chat.then.text("Which environment should I inspect?");
        const asked = yield* readTrace(s.page, 600);
        const anchored = asked.flatMap((frame) => (frame.anchor === null ? [] : [frame]));
        expect(anchored.length, "ASSERTION: the conversation's last words stayed on screen").toBe(
          asked.length,
        );
        // The card's own line takes the question as it comes, and the conversation glides up clear
        // of the composer's question (engine final run, C1): it never jumps there.
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
        const { s } = yield* realLongConversation;
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
        yield* Effect.promise(() => s.page.reload());
        yield* s.then.conversation.showsMessage("The existing conversation is still here");
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

    // Engine final run, A5: reloaded while the answer streamed, the page painted the live card at
    // its end, then the older history came and the view glided 1,338 px through it for 0.85 s.
    it.effect("a reload during a streaming run paints at the end first", () =>
      Effect.gen(function* () {
        const { s, chat, engine } = yield* longConversation;
        const run = engine.personRun("Write me the long report");
        const note = engine.item(run, { kind: "note", text: "", streaming: true, answer: false });
        engine.stream(note, "The report, section by section.\n\n");
        yield* chat.then.text("The report, section by section.");
        // The answer goes on streaming through the reload, a line every tenth of a second.
        const streaming = everyTenth((line) =>
          engine.stream(note, `Section ${line} reads well and its numbers add up.\n\n`),
        );
        yield* Effect.promise(() =>
          s.page.evaluateOnNewDocument(() => {
            const frames: Array<{ end: number; shown: boolean }> = [];
            const sample = () => {
              const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
              if (outer && outer.scrollHeight > outer.clientHeight + 4)
                frames.push({
                  end: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                  shown: document.querySelector("[data-timeline-placing]") === null,
                });
              if (frames.length < 240) requestAnimationFrame(sample);
            };
            (window as unknown as { reloadFrames: unknown }).reloadFrames = frames;
            requestAnimationFrame(sample);
          }),
        );
        yield* chat.when.reload();
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 2000)));
        streaming.stop();
        const frames = yield* Effect.promise(() =>
          s.page.evaluate(
            () =>
              (window as unknown as { reloadFrames: Array<{ end: number; shown: boolean }> })
                .reloadFrames,
          ),
        );
        const shown = frames.filter((frame) => frame.shown);
        expect(shown.length, "ASSERTION: the reload's paint was sampled").toBeGreaterThan(10);
        // A streamed line moves the end a line at a time, and the view stands at it at once.
        expect(
          Math.max(...shown.map((frame) => frame.end)),
          `ASSERTION: every painted frame stands at the streaming end: ${shown.map((frame) => Math.round(frame.end)).join(", ")}`,
        ).toBeLessThan(40);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
