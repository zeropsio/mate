import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createScenario } from "../../harness/scenario.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { installArea } from "./fake.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { mateChat } from "./dsl.ts";
import * as Schema from "effect/Schema";
import { HqStreamMessage } from "@t3tools/shared/hqStream";
import { transportGate } from "../../harness/transportGate.ts";

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
    );

    it.effect(
      "a reload while the platform's socket is still logging in opens the Mate's conversation and never says it isn't in your projects",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          chat.fixture("Sage").exchange("Earlier question", "Sage's conversation is ready");
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly("Sage");
          yield* chat.then.text("Sage's conversation is ready");
          // Every listing reads behind the platform's socket: its login never answers now.
          s.drivers.zerops.faults.set("POST /web-socket/login", { silence: true });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => s.drivers.zerops.faults.delete("POST /web-socket/login")),
          );
          // From the reload's first frame: whether the page ever said the Mate is absent, and how
          // many opening stages it drew on its way to the conversation.
          yield* Effect.promise(() =>
            s.page.evaluateOnNewDocument(() => {
              const seen = { absent: false, stages: new Set<Element>() };
              (window as unknown as { __opening: typeof seen }).__opening = seen;
              const sample = () => {
                if (document.body?.innerText.includes("isn't in your Zerops projects"))
                  seen.absent = true;
                const stage = document.querySelector("[data-conversation-opening]");
                if (
                  stage !== null &&
                  stage.getAttribute("data-conversation-opening") !== "complete"
                )
                  seen.stages.add(stage);
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }),
          );

          yield* Effect.promise(() => s.page.reload());
          yield* chat.then.text("Sage's conversation is ready");

          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const seen = (
                  window as unknown as {
                    __opening: { absent: boolean; stages: Set<Element> };
                  }
                ).__opening;
                return { absent: seen.absent, stages: seen.stages.size };
              }),
            ),
            "ASSERTION: one opening stage, and no absence said, from the reload to the conversation",
          ).toEqual({ absent: false, stages: 1 });
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "a reload of a remembered Mate's conversation opens it before HQ names its environment, and never says it isn't in your projects",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          chat.fixture("Sage").exchange("Earlier question", "Sage's conversation is ready");
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly("Sage");
          yield* chat.then.text("Sage's conversation is ready");
          // This device remembers where Sage lives; HQ is slow to say it again: each Mate's
          // attention — the overview naming its environment — waits until the case lets it go.
          const hq = yield* Effect.promise(() => transportGate(() => s.drivers.hq.origin, ""));
          s.drivers.cleanup.push(hq.close);
          s.drivers.routes["https://hqzone.prg1-zerops.zone"] = hq.origin;
          yield* Effect.promise(() => s.web.setRoutes());
          yield* Effect.promise(() =>
            s.page.evaluateOnNewDocument(() => {
              const seen = { absent: false };
              (window as unknown as { __opening: typeof seen }).__opening = seen;
              const sample = () => {
                if (document.body?.innerText.includes("isn't in your Zerops projects"))
                  seen.absent = true;
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }),
          );
          const attention = hq.holdFrames((frame) => {
            if (frame.isBinary) return false;
            const message = Schema.decodeUnknownSync(HqStreamMessage)(
              JSON.parse(Buffer.from(frame.bytes).toString()),
            );
            return "scope" in message && message.scope.kind === "attention";
          });
          yield* Effect.addFinalizer(() => Effect.sync(attention.release));

          yield* Effect.promise(() => s.page.reload());
          yield* Effect.promise(() => attention.held);
          // What this device remembers opens the conversation while HQ still says nothing of it.
          yield* chat.then.text("Sage's conversation is ready");
          const absentWhileHeld = yield* Effect.promise(() =>
            s.page.evaluate(
              () => (window as unknown as { __opening: { absent: boolean } }).__opening.absent,
            ),
          );
          attention.release();

          expect(
            absentWhileHeld,
            "ASSERTION: a remembered Mate's conversation is never said absent while HQ is slow",
          ).toBe(false);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "a reload on a device that remembers no Mate, HQ naming its environment late, never says the conversation isn't in your projects and opens it once HQ does",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          chat.fixture("Sage").exchange("Earlier question", "Sage's conversation is ready");
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly("Sage");
          yield* chat.then.text("Sage's conversation is ready");
          // HQ's navigation answers at once; Sage's attention — the overview naming its
          // environment — waits until the case lets it go.
          const hq = yield* Effect.promise(() => transportGate(() => s.drivers.hq.origin, ""));
          s.drivers.cleanup.push(hq.close);
          s.drivers.routes["https://hqzone.prg1-zerops.zone"] = hq.origin;
          yield* Effect.promise(() => s.web.setRoutes());
          // The device forgets which Mate lives where (`mate:identities`); its sign-in stays.
          yield* Effect.promise(() =>
            s.page.evaluateOnNewDocument(() => {
              for (const key of Object.keys(localStorage))
                if (key.includes("mate:identities")) localStorage.removeItem(key);
              const seen = { absent: false };
              (window as unknown as { __opening: typeof seen }).__opening = seen;
              const sample = () => {
                if (document.body?.innerText.includes("isn't in your Zerops projects"))
                  seen.absent = true;
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }),
          );
          const attention = hq.holdFrames((frame) => {
            if (frame.isBinary) return false;
            const message = Schema.decodeUnknownSync(HqStreamMessage)(
              JSON.parse(Buffer.from(frame.bytes).toString()),
            );
            return "scope" in message && message.scope.kind === "attention";
          });
          yield* Effect.addFinalizer(() => Effect.sync(attention.release));

          const zerops = s.drivers.zerops;
          const searches = () => zerops.requests.get("POST /project/search") ?? 0;
          const before = searches();
          // The projects are asked for again on the reload, and answer while attention is held.
          const rosterAsked = new Promise<void>((resolve) => {
            const heard = () => {
              if (searches() <= before) return;
              zerops.events.off("request", heard);
              resolve();
            };
            zerops.events.on("request", heard);
          });
          yield* Effect.promise(() => s.page.reload());
          yield* Effect.promise(() => attention.held);
          yield* Effect.promise(() => rosterAsked);
          // HQ's navigation lists Sage while its attention is still on its way.
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => document.body?.innerText.includes("Sage")),
          );
          yield* Effect.promise(() =>
            s.page.evaluate(
              () =>
                new Promise<void>((resolve) => {
                  let frames = 0;
                  const step = () => (++frames >= 60 ? resolve() : requestAnimationFrame(step));
                  requestAnimationFrame(step);
                }),
            ),
          );
          attention.release();
          yield* chat.then.text("Sage's conversation is ready");

          expect(
            yield* Effect.promise(() =>
              s.page.evaluate(
                () => (window as unknown as { __opening: { absent: boolean } }).__opening.absent,
              ),
            ),
            "ASSERTION: no absence said while HQ's attention for the route's Mate was on its way",
          ).toBe(false);
          yield* s.then.noExternalNetwork;
        }),
    );

    it.effect(
      "a conversation HQ answered for every Mate without naming its environment says it isn't in your Zerops projects",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          const chat = mateChat(s);
          chat.fixture("Sage").exchange("Earlier question", "Sage's conversation is ready");
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly("Sage");
          yield* chat.then.text("Sage's conversation is ready");
          // The same conversation's address under an environment no Mate of the account serves.
          const url = new URL(s.page.url());
          const segments = url.pathname.split("/");
          segments[segments.length - 2] = "environment-served-by-no-mate";
          url.pathname = segments.join("/");

          yield* Effect.promise(() => s.page.goto(url.href));
          yield* chat.then.text("This conversation isn't in your Zerops projects.");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
