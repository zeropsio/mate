import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
  RuntimeItemId,
  RuntimeTaskId,
  TurnId,
} from "@t3tools/contracts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { TARGET_QUESTION } from "./wire.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";

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
  /** The follower acknowledged a glide since this trace started. */
  readonly glided: boolean;
}

// Real history is authored by the provider and committed by the same engine the browser reads.
const realLongConversation = Effect.gen(function* () {
  const s = yield* createScenario([], { mate: "real" });
  yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
  yield* s.given.project("Ada", { mate: true });
  const { provider, server } = s.drivers.realMates.get("Ada")!;
  const frames = yield* Queue.unbounded<EngineConversationFrame>();
  const ended = (ordinal: number) =>
    Effect.gen(function* () {
      while (true) {
        const frame = yield* Queue.take(frames);
        if (
          (frame.type === "snapshot" || frame.type === "changes") &&
          frame.runs.some((run) => run.ordinal === ordinal && run.state === "ended")
        )
          return;
      }
    }).pipe(Effect.timeout("8 seconds"));
  const chat = mateChat(s);
  yield* s.given.signedIn;
  yield* Effect.promise(() => ownerViewport(s.page));
  yield* s.when.menu.opensMate("Ada");
  yield* s.then.conversation.appears;
  for (const round of [1, 2, 3]) {
    const answer =
      "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(30);
    yield* provider.turn([{ kind: "say", text: answer }]);
    yield* s.when.conversation.sends(`How did deploy ${round} go?`);
    expect((yield* provider.received).input.input).toBe(`How did deploy ${round} go?`);
    if (round === 1) {
      yield* Effect.promise(() =>
        s.page.waitForFunction(() => !location.pathname.startsWith("/draft/")),
      );
      const conversationId = ConversationId.make(new URL(s.page.url()).pathname.split("/").at(-1)!);
      yield* server.engine.wire
        .subscribe(
          { protocol: MATE_ENGINE_PROTOCOLS[0]!, conversationId },
          { subject: "scenario-person", environmentId: "scenario", epoch: 1 },
        )
        .pipe(
          Stream.runForEach((frame) => Queue.offer(frames, frame)),
          Effect.forkScoped,
        );
    }
    yield* ended(round);
    yield* s.then.conversation.showsMessage(
      "The shop's deploy built, its logs are clean and the storefront answers.",
    );
  }
  yield* provider.turn([{ kind: "say", text: "The existing conversation is still here" }]);
  yield* s.when.conversation.sends("And now?");
  expect((yield* provider.received).input.input).toBe("And now?");
  yield* ended(4);
  yield* s.then.conversation.showsMessage("The existing conversation is still here");
  return { s, chat, provider };
});

/** Starts sampling every frame; `read` stops and returns what it saw. */
const trace = (page: import("puppeteer-core").Page, anchorText: string) =>
  Effect.promise(() =>
    page.evaluate((anchorText) => {
      const frames: Frame[] = [];
      const state = { active: true, glided: false };
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
            glided: state.glided,
          });
        if (state.active) requestAnimationFrame(sample);
      };
      const observer = new MutationObserver((records) => {
        state.glided ||= records.some(
          (record) =>
            record.oldValue !== null ||
            (record.target as Element).hasAttribute("data-timeline-gliding"),
        );
      });
      const outer = document.querySelector(".timeline-legend-list");
      if (outer)
        observer.observe(outer, {
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["data-timeline-gliding"],
        });
      (window as unknown as { engineCardTrace: unknown }).engineCardTrace = {
        frames,
        state,
        observer,
      };
      sample();
    }, anchorText),
  );

const readTrace = (page: import("puppeteer-core").Page) =>
  Effect.promise(async () => {
    await waitForStillFrames(page);
    return page.evaluate(() => {
      const held = (
        window as unknown as {
          engineCardTrace: {
            frames: Frame[];
            state: { active: boolean };
            observer: MutationObserver;
          };
        }
      ).engineCardTrace;
      held.state.active = false;
      held.observer.disconnect();
      return held.frames;
    });
  });

const restingEnd = (page: import("puppeteer-core").Page) =>
  Effect.promise(async () => {
    await waitForStillFrames(page);
    return page.evaluate(() => {
      const outer = document.querySelector<HTMLElement>(".timeline-legend-list")!;
      return outer.scrollHeight - outer.clientHeight - outer.scrollTop;
    });
  });

/** Geometry spans are independent of how many browser frames the runner delivered. */
const span = (frames: ReadonlyArray<Frame>, of: (frame: Frame) => number) =>
  Math.max(...frames.map(of)) - Math.min(...frames.map(of));

// The follower's interpolation is driven by explicit frame timestamps in timelineEndFollow.test.ts.
// Here its own mark proves the real send/ask consumer requested that glide, regardless of host cadence.
const expectGlide = (frames: ReadonlyArray<Frame>) =>
  expect(
    frames.some((frame) => frame.glided),
    "ASSERTION: the real conversation requested a glide",
  ).toBe(true);

/**
 * The person's run that leaves a command waiting in the background, ended with `answer` (or with
 * no words), its job ended since. The person watches it run before it ends, as on a loaded runner
 * where its events arrive frames apart: the card folds from the height they watched.
 */
const jobRun = (
  page: import("puppeteer-core").Page,
  chat: ReturnType<typeof mateChat>,
  provider: Effect.Success<typeof realLongConversation>["provider"],
  answer: string | null,
) =>
  Effect.gen(function* () {
    const watched = yield* Deferred.make<void>();
    yield* provider.turn([
      {
        kind: "event",
        event: {
          type: "item.completed",
          itemId: RuntimeItemId.make("background-command"),
          payload: {
            itemType: "command_execution",
            status: "completed",
            detail: "sleep 45 && echo done",
            data: {
              tool: "Bash",
              state: {
                status: "completed",
                input: { command: "sleep 45 && echo done" },
                output:
                  "Command running in background with ID: b1job. Output is being written to: /tmp/x",
              },
            },
          },
        },
      },
      {
        kind: "event",
        event: {
          type: "task.started",
          payload: {
            taskId: RuntimeTaskId.make("background-wait"),
            taskType: "local_bash",
            description: "Wait 45 seconds in the background, then print done",
          },
        },
      },
      { kind: "wait", until: watched },
      ...(answer === null ? [] : [{ kind: "say" as const, text: answer }]),
    ]);
    yield* chat.when.send("Start the wait in the background");
    const native = yield* provider.received;
    expect(native.input.input).toBe("Start the wait in the background");
    yield* Effect.promise(() =>
      page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1)?.dataset.runLive ===
          "",
        { polling: "raf" },
      ),
    );
    yield* Deferred.succeed(watched, undefined);
    // Its run over, the card is done; the conversation's bottom says the command still runs.
    yield* chat.then.text("Still working in the background");
    yield* provider.event(native.threadId, {
      type: "task.completed",
      turnId: native.turnId,
      payload: {
        taskId: RuntimeTaskId.make("background-wait"),
        taskType: "local_bash",
        status: "completed",
      },
    });
    yield* chat.then.noText("Still working in the background");
    yield* chat.then.noText("running in the background");
    return native;
  });

/**
 * The last card folds as its wait ends; the page is still once it has. Its mark says folded in the
 * commit the card folds, while the card still eases to its line and the list glides to its end
 * after it: the wake is traced from the still page, never over that ease's tail.
 */
const foldedCard = (page: import("puppeteer-core").Page) =>
  Effect.promise(() =>
    waitForStillFrames(page, {
      phaseStarted: () =>
        [...document.querySelectorAll<HTMLElement>("[data-run-chat]")].at(-1)?.dataset.runFold ===
        "folded",
    }),
  );

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
  scenarioSuite((it) => {
    it.effect("a run its job's end wakes goes on in the folded card without moving the page", () =>
      Effect.gen(function* () {
        const { s, chat, provider } = yield* realLongConversation;
        // The run ends with no answer: the run the job's end wakes is the same card's to go on in.
        const run = yield* jobRun(s.page, chat, provider, null);
        yield* foldedCard(s.page);
        yield* trace(s.page, "Start the wait in the background");
        yield* provider.event(run.threadId, {
          type: "turn.started",
          turnId: TurnId.make("native-wake"),
          payload: {},
        });
        yield* provider.event(run.threadId, {
          type: "content.delta",
          itemId: RuntimeItemId.make("wake-answer"),
          payload: {
            streamKind: "assistant_text",
            delta: "The background wait finished and printed done.",
          },
        });
        yield* provider.event(run.threadId, {
          type: "item.completed",
          itemId: RuntimeItemId.make("wake-answer"),
          payload: { itemType: "assistant_message", status: "completed" },
        });
        yield* provider.event(run.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        });
        yield* chat.then.text("The background wait finished and printed done.");
        const frames = yield* readTrace(s.page);
        expect(frames.length, "ASSERTION: the wake was sampled").toBeGreaterThan(0);
        expect(
          Math.max(...frames.map((frame) => frame.card)) -
            Math.min(...frames.map((frame) => frame.card)),
          "ASSERTION: the folded card keeps its height while the woken run goes on in it",
        ).toBeLessThan(48);
        expect(
          span(frames, (frame) => frame.top),
          "ASSERTION: the folded card's wake keeps the view in place",
        ).toBeLessThan(120);
        expect(
          yield* restingEnd(s.page),
          "ASSERTION: the view ends at the conversation's end",
        ).toBeLessThanOrEqual(1);
        yield* s.then.noExternalNetwork;
      }),
    );
    it.effect("a message the person sends moves the conversation by a glide, never a jump", () =>
      Effect.gen(function* () {
        const { s, chat, provider } = yield* realLongConversation;
        yield* Effect.promise(() => waitForStillFrames(s.page));
        yield* trace(s.page, "The existing conversation is still here");
        const working = yield* Deferred.make<void>();
        yield* provider.turn([{ kind: "wait", until: working }]);
        yield* chat.when.send("Check the storefront again");
        const frames = yield* readTrace(s.page);
        expect(frames.length, "ASSERTION: the send was sampled").toBeGreaterThan(0);
        expectGlide(frames);
        expect(
          yield* restingEnd(s.page),
          "ASSERTION: the send reaches the conversation's end",
        ).toBeLessThanOrEqual(1);
        yield* s.then.noExternalNetwork;
      }),
    );

    // Milo's third stress run: a steer landing in the running run moved the conversation 105 px.
    it.effect(
      "a message steered into the running run lands above its card without moving the page",
      () =>
        Effect.gen(function* () {
          const { s, chat, provider } = yield* realLongConversation;
          const working = yield* Deferred.make<void>();
          yield* provider.turn([
            { kind: "say", text: "Checking the first page now." },
            { kind: "wait", until: working },
          ]);
          yield* chat.when.send("Check both pages");
          const running = yield* provider.received;
          yield* chat.then.text("Checking the first page now.");
          yield* Effect.promise(() => waitForStillFrames(s.page));
          yield* trace(s.page, "Checking the first page now.");
          yield* chat.when.send("also tell me the page title");
          yield* chat.when.press("Send now");
          const steered = yield* provider.received;
          // The agent gets the person's words first, then the engine's note to answer them where
          // the person reads; the record keeps only what they typed.
          expect(
            {
              turnId: steered.turnId,
              text: steered.input.input?.split("\n\n<zerops-note>")[0],
            },
            "ASSERTION: the message was steered into the running run",
          ).toEqual({ turnId: running.turnId, text: "also tell me the page title" });
          const frames = yield* readTrace(s.page);
          const copies = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const containsSteer = (element: Element) =>
                element.textContent?.includes("also tell me the page title") === true;
              return {
                outer: [...document.querySelectorAll('[data-message-role="user"]')].filter(
                  containsSteer,
                ).length,
                inCard: [
                  ...document.querySelectorAll('[data-run-chat] [data-chat-kind="person"]'),
                ].filter(containsSteer).length,
              };
            }),
          );
          expect(copies.outer, "ASSERTION: the steer has exactly one outer user row").toBe(1);
          expect(copies.inCard, "ASSERTION: the running card marks the steer exactly once").toBe(1);
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
          expect(frames.length, "ASSERTION: the steer was sampled").toBeGreaterThan(0);
          expectGlide(frames);
          expect(
            frames.every((frame) => frame.anchor !== null),
            "ASSERTION: the words already being read remain on screen as the steer lands",
          ).toBe(true);
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
        yield* Effect.promise(() => waitForStillFrames(s.page));
        yield* trace(s.page, "Step 8: your choice of format.");
        yield* Deferred.succeed(questionReady, undefined);
        yield* chat.then.text("Which environment should I inspect?");
        const asked = yield* readTrace(s.page);
        const anchored = asked.flatMap((frame) => (frame.anchor === null ? [] : [frame]));
        expect(anchored.length, "ASSERTION: the conversation's last words stayed on screen").toBe(
          asked.length,
        );
        expectGlide(asked);
        yield* trace(s.page, "Step 8: your choice of format.");
        yield* chat.when.click("Staging");
        yield* chat.then.text("You chose staging.");
        const answered = yield* readTrace(s.page);
        expect(answered.filter((frame) => frame.anchor !== null).length).toBeGreaterThan(0);
        expectGlide(answered);
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("a reload during a streaming run paints at the end first", () =>
      Effect.gen(function* () {
        const { s, chat, provider } = yield* realLongConversation;
        const release = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        yield* provider.turn([{ kind: "wait", until: release }]);
        yield* chat.when.send("Write me the long report");
        const native = yield* provider.received;
        const note = RuntimeItemId.make("long-report");
        const append = (words: string) =>
          provider.event(native.threadId, {
            type: "content.delta",
            itemId: note,
            payload: { streamKind: "assistant_text", delta: `${words}\n\n` },
          });
        yield* append("The report, section by section.");
        yield* chat.then.text("The report, section by section.");
        yield* Effect.promise(() => waitForStillFrames(s.page));
        yield* Effect.promise(() =>
          s.page.evaluateOnNewDocument(() => {
            const frames: Array<{ end: number; shown: boolean }> = [];
            Reflect.set(window, "streamingReloadFrames", frames);
            const sample = () => {
              const outer = document.querySelector<HTMLElement>(".timeline-legend-list");
              if (outer && outer.scrollHeight > outer.clientHeight + 4) {
                let shown = outer.closest("[data-timeline-placing]") === null;
                for (let node: HTMLElement | null = outer; node; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (
                    style.opacity === "0" ||
                    style.visibility === "hidden" ||
                    node.hasAttribute("inert")
                  )
                    shown = false;
                }
                frames.push({
                  end: outer.scrollHeight - outer.clientHeight - outer.scrollTop,
                  shown,
                });
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }),
        );
        yield* Effect.promise(async () => {
          const reloading = s.page.reload();
          await Effect.runPromise(append("Section 0 reads well and its numbers add up."));
          await reloading;
        });
        yield* chat.then.text("The report, section by section.");
        yield* Effect.promise(() => waitForStillFrames(s.page));
        // Source receipts arrive after first paint; each append is observed before the next input.
        for (const section of [1, 2, 3]) {
          const words = `Section ${section} reads well and its numbers add up.`;
          yield* append(words);
          yield* chat.then.text(words);
          yield* Effect.promise(() => waitForStillFrames(s.page));
        }
        const shown = yield* Effect.promise(() =>
          s.page.evaluate(() =>
            (
              Reflect.get(window, "streamingReloadFrames") as Array<{ end: number; shown: boolean }>
            ).filter((frame) => frame.shown),
          ),
        );
        expect(shown.length, "ASSERTION: the reload's paint was sampled").toBeGreaterThan(0);
        expect(
          Math.max(...shown.map((frame) => frame.end)),
          `ASSERTION: every painted frame stands at the streaming end: ${shown.map((frame) => Math.round(frame.end)).join(", ")}`,
        ).toBeLessThan(40);
        yield* s.then.noExternalNetwork;
      }),
    );
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
        yield* Effect.promise(() => waitForStillFrames(s.page));
        const ends = yield* Effect.promise(() =>
          s.page.evaluate(() => Reflect.get(window, "reloadEnds") as number[]),
        );
        expect(ends.length).toBeGreaterThan(0);
        expect(
          Math.max(...ends),
          "ASSERTION: every visible reload frame is already at the conversation end",
        ).toBeLessThanOrEqual(2);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
