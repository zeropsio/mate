import type { Page } from "puppeteer-core";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { installArea as installChanges, hqFramesFor } from "../d-change/fake.ts";

/** Runs the page's animations at `rate` of their speed until restored (CDP's own timeline). */
async function slowAnimations(page: Page, rate: number) {
  const cdp = await page.createCDPSession();
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  return {
    restore: async () => {
      await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
      await cdp.detach();
    },
  };
}

async function menuAt(page: Page, target: number) {
  const rail = (await page.$('[data-sidebar="rail"]'))!;
  const box = (await rail.boundingBox())!;
  const width = await page.$eval(
    '[data-sidebar="sidebar"]',
    (element) => element.getBoundingClientRect().width,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + target - width, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForFunction(
    (target) =>
      document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width === target,
    {},
    target,
  );
}

async function ownerMenu(page: Page) {
  await menuAt(page, 435);
}

describe("owner-reported layout regressions", () => {
  // Cyd: delayed HQ app detail inserted an old landing above the painted final answer,
  // dropping its words 79 px before the end follower glided back. The source stays unchanged.
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("historical landings preserve painted words while live arrivals still follow", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installChanges], { mate: "real" });
        yield* Effect.promise(async () => {
          await s.page.setViewport({ width: 1786, height: 1000 });
          await s.page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
        });
        const change = yield* changeFixture(s);
        const ada = s.drivers.realMates.get("Ada")!;
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        const exchange = Effect.fn(function* (
          question: string,
          answer: string,
          providerInput = question,
        ) {
          yield* ada.provider.turn([{ kind: "say", text: answer }]);
          yield* s.when.conversation.sends(question);
          expect(
            (yield* ada.provider.received).input.input,
            "ASSERTION: the provider receives the person's words with the observed landing context",
          ).toBe(providerInput);
          yield* s.then.conversation.showsMessage(answer.trim().split("\n\n").at(-1)!);
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () => !document.querySelector('button[aria-label="Stop generation"]'),
            ),
          );
        });
        yield* exchange(
          "Review the linked work",
          `Review [the order change](https://hqzone.prg1-zerops.zone${change.direct.replace("/change/", "/changes/")}).\n\n` +
            "The shop's deploy built, its logs are clean and the storefront answers.\n\n".repeat(
              24,
            ),
        );
        yield* change.colleagueMerges;
        // Core's merge receipt precedes the browser's app-detail reflection. Observe that fact
        // before sending: the agent hears it as context, while the person's transcript stays bare.
        yield* Effect.promise(() =>
          s.page.waitForSelector('[data-timeline-row-id="event:zerops:change-landed:appdev#1"]'),
        );
        const answer = "The final contact line stays where it was read.";
        yield* exchange(
          "And the contact line?",
          answer,
          `<zerops-update>\nappdev #1 landed: ${change.title}\n</zerops-update>\n\nAnd the contact line?`,
        );
        const frames = hqFramesFor(s.drivers);
        frames.hold((frame) => {
          const input = JSON.parse(frame);
          return input.scope?.kind === "app-detail";
        });
        yield* Effect.promise(() => s.page.reload());
        yield* s.then.conversation.showsMessage(answer);
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate((answer) => {
              const timeline = document.querySelector(".timeline-legend-list")!;
              const person = [...timeline.querySelectorAll("[data-user-message-body]")].at(-1)!;
              const words = document.createTreeWalker(timeline, NodeFilter.SHOW_TEXT);
              let reply: Node | null = null;
              while (words.nextNode()) {
                if (words.currentNode.textContent === answer) reply = words.currentNode;
              }
              return {
                person: person.textContent,
                contextVisible: timeline.textContent?.includes("<zerops-update>"),
                answerFollows:
                  reply !== null &&
                  (person.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              };
            }, answer),
          ),
          "ASSERTION: the reloaded conversation paints the person's exact words before the answer without agent context",
        ).toEqual({ person: "And the contact line?", contextVisible: false, answerFollows: true });
        yield* Effect.promise(() => frames.received());
        yield* Effect.promise(() => waitForStillFrames(s.page));
        const trace = yield* Effect.promise(async () => {
          const capture = await s.page.evaluateHandle((answer) => {
            const readings: { top: number; height: number; scroll: number; count: number }[] = [];
            let active = true;
            const read = () => {
              const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
              const row = [...scroll.querySelectorAll<HTMLElement>("[data-timeline-row-id]")].find(
                (row) => row.textContent?.includes(answer),
              )!;
              readings.push({
                top: row.getBoundingClientRect().top,
                height: scroll.scrollHeight,
                scroll: scroll.scrollTop,
                count: scroll.querySelectorAll("[data-timeline-row-id]").length,
              });
              if (active) requestAnimationFrame(read);
            };
            read();
            return {
              readings,
              stop: () => {
                active = false;
              },
            };
          }, answer);
          frames.resume();
          await s.page.waitForFunction(() =>
            document.querySelector('[data-timeline-row-id^="event:zerops:"]'),
          );
          await waitForStillFrames(s.page);
          const result = await capture.evaluate((capture) => {
            capture.stop();
            return capture.readings;
          });
          await capture.dispose();
          return result;
        });
        expect(
          trace.at(-1)!.height - trace[0]!.height,
          "ASSERTION: the delayed linked historical landing added its real row above the answer",
        ).toBeGreaterThan(40);
        const jumps = trace.slice(1).map((frame, index) => Math.abs(frame.top - trace[index]!.top));
        expect(
          Math.max(...jumps),
          `ASSERTION: delayed historical landing moves painted words by at most 1 px: ${trace.map((frame) => frame.top).join(" ")}`,
        ).toBeLessThanOrEqual(1);
        yield* exchange("One live update", "A live arrival still follows.\n\n".repeat(12));
        yield* Effect.promise(() => waitForStillFrames(s.page));
        const gap = yield* Effect.promise(() =>
          s.page.evaluate(() => {
            const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
            return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
          }),
        );
        expect(
          gap,
          "ASSERTION: a live arrival is followed to the conversation end",
        ).toBeLessThanOrEqual(2);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("the Chief's first message and composer enter the conversation without a jump", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
        yield* s.given.project("Chief", { mate: true });
        const { zerops, core, owner } = s.drivers;
        zerops.put("project", {
          ...zerops.rows("project").find((project) => project.id === "Chief")!,
          tagList: ["chief"],
        });
        zerops.put("user-data", {
          id: "chief-token",
          clientId: "ORG",
          serviceStackId: "service-Chief",
          projectId: "Chief",
          key: "ZCP_ORG_TOKEN",
          type: "USER",
          sensitive: true,
          editable: true,
          content: "scenario-chief-token",
        });
        const registered = yield* core.call("POST", "/api/chief", {
          session: owner,
          body: { projectId: "Chief" },
        });
        expect(registered.status, "ASSERTION: HQ names the person's Chief").toBe(200);
        yield* s.given.signedIn;
        yield* Effect.promise(() => ownerMenu(s.page));
        yield* Effect.promise(() =>
          s.page
            .locator('[data-sidebar="sidebar"] [data-zerops-surface="sidebar-chief-row"]')
            .click(),
        );
        yield* Effect.promise(() =>
          s.page.waitForSelector('[role="textbox"]', { visible: true, timeout: 8000 }),
        );
        const question = "Look into my organization.";
        const answer = "I will look into your organization.";
        const mate = s.drivers.realMates.get("Chief")!;
        const answerArrives = yield* Deferred.make<void>();
        yield* mate.provider.turn([
          { kind: "wait", until: answerArrives },
          { kind: "say", text: answer },
        ]);
        yield* Effect.promise(async () => {
          await s.page.locator('[role="textbox"]').fill(question);
          await waitForStillFrames(s.page);
        });
        const slowed = yield* Effect.promise(() => slowAnimations(s.page, 0.1));
        const trace = yield* Effect.promise(() =>
          s.page.evaluateHandle(() => {
            const state = {
              active: true,
              frames: [] as Array<{
                at: number;
                composer: number;
                message: number | null;
                path: string;
                opacity: number;
              }>,
            };
            const sample = () =>
              setTimeout(() => {
                const composer = document.querySelector('[data-slot="composer-shell"]');
                const message = document.querySelector('[data-message-role="user"]');
                let opacity = 1;
                for (let element = message; element !== null; element = element.parentElement)
                  opacity *= Number(getComputedStyle(element).opacity);
                if (composer)
                  state.frames.push({
                    at: performance.now(),
                    composer: composer.getBoundingClientRect().top,
                    message: message?.getBoundingClientRect().top ?? null,
                    path: location.pathname,
                    opacity,
                  });
                if (state.active) requestAnimationFrame(sample);
              }, 0);
            requestAnimationFrame(sample);
            return state;
          }),
        );
        yield* s.when.conversation.sends(question);
        expect((yield* mate.provider.received).input.input).toBe(question);
        // The answer is real server data arriving after the saved conversation's first paint.
        yield* Effect.promise(() =>
          s.page.waitForFunction(
            (state) =>
              state.frames.some(
                (frame) =>
                  !frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
              ),
            { polling: "raf" },
            trace,
          ),
        );
        yield* Deferred.succeed(answerArrives, undefined);
        yield* s.then.conversation.showsMessage(answer);
        yield* Effect.promise(() => waitForStillFrames(s.page, { stillFrames: 24 }));
        const frames = yield* Effect.promise(() =>
          trace.evaluate((state) => {
            state.active = false;
            return state.frames;
          }),
        );
        yield* Effect.promise(() => trace.dispose());
        yield* Effect.promise(() => slowed.restore());
        const steps = (read: (frame: (typeof frames)[number]) => number | null) =>
          frames.slice(1).flatMap((frame, index) => {
            const previous = frames[index]!;
            const [to, from] = [read(frame), read(previous)];
            return to === null || from === null
              ? []
              : [(Math.abs(to - from) * (1000 / 60)) / Math.max(1000 / 60, frame.at - previous.at)];
          });
        const draftVisible = frames.filter(
          (frame) =>
            frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
        );
        const savedVisible = frames.filter(
          (frame) =>
            !frame.path.includes("/draft/") && frame.opacity === 1 && frame.message !== null,
        );
        expect(
          draftVisible.length,
          "ASSERTION: the draft's message is visibly sampled",
        ).toBeGreaterThan(0);
        expect(
          savedVisible.length,
          "ASSERTION: the saved conversation's message is visibly sampled",
        ).toBeGreaterThan(0);
        const firstMessageLine = draftVisible.at(-1)!.message!;
        const promotionShift = Math.max(
          ...savedVisible.map((frame) => Math.abs(frame.message! - firstMessageLine)),
        );
        yield* Effect.log("CHIEF GEOMETRY", {
          firstMessageLine,
          promotionShift,
          composerStep: Math.max(0, ...steps((frame) => frame.composer)),
        });
        expect(
          promotionShift,
          "ASSERTION: promotion keeps the Chief's first message on its visible line",
        ).toBeLessThanOrEqual(1);
        if (process.env.MATE_LAYOUT_EVIDENCE)
          yield* Effect.promise(() =>
            s.page.screenshot({
              path: `${process.env.MATE_LAYOUT_EVIDENCE}/chief-first-send-full.png`,
            }),
          );
        expect(
          frames.length,
          "ASSERTION: the first send is sampled through its docking",
        ).toBeGreaterThan(10);
        expect(
          Math.max(0, ...steps((frame) => frame.composer)),
          "ASSERTION: the Chief's composer docks by a glide, never a jump",
        ).toBeLessThan(60);
        expect(
          Math.max(0, ...steps((frame) => frame.message)),
          "ASSERTION: the Chief's first message settles by a glide, never a jump",
        ).toBeLessThan(60);
        yield* s.then.noExternalNetwork;
      }),
    );
  });
});
