import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderDriverKind } from "@t3tools/contracts";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { CLAUDE_SCENARIO_CODE } from "../../../../../server/integration/scriptedClaudeSignIn.ts";
import { createScenario } from "../../harness/scenario.ts";
import { transportGate } from "../../harness/transportGate.ts";
import { waitForStillFrames } from "../../harness/stillFrames.ts";
import { mateChat } from "./dsl.ts";
import { ownerViewport } from "./ownerViewport.ts";
import { installArea } from "./fake.ts";

interface OwnershipPaints {
  controls: number;
  history: number;
  answers: number[];
  footers: number[];
  rooms: number[];
}

describe("owner-reported layout regressions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("a read-only Mate shows one honest line, no fake input area", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        mateChat(s).fixture().history();
        s.given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
        const colleague = yield* s.given.browserActor({ person: "dev" });
        yield* colleague.given.signedIn;
        const chat = mateChat({ ...s, ...colleague });
        yield* chat.when.openReadOnly("Ada");
        yield* Effect.promise(() => ownerViewport(colleague.page));
        yield* chat.then.text("you can read along");
        yield* Effect.promise(async () => {
          await waitForStillFrames(colleague.page);
          const room = await colleague.page.$eval(
            "[data-zerops-read-only-conversation] [data-chat-composer-main-surface]",
            (surface) => {
              const line = surface.querySelector("p")!;
              const padding = getComputedStyle(line.parentElement!);
              return {
                height: surface.getBoundingClientRect().height,
                content:
                  line.getBoundingClientRect().height +
                  parseFloat(padding.paddingTop) +
                  parseFloat(padding.paddingBottom),
              };
            },
          );
          expect(
            Math.abs(room.height - room.content),
            `ASSERTION: read-along box fits its text line and padding with no empty band (height ${room.height}, content ${room.content})`,
          ).toBeLessThanOrEqual(1);
        });
        yield* s.then.noExternalNetwork;
      }),
    );
    const ownershipArrives = (anchor: boolean) =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given.project("Ada", {
          mate: true,
          provider: { driverKind: ProviderDriverKind.make("claudeAgent") },
          claudeSignIn: true,
        });
        const chat = mateChat(s);
        yield* s.given.signedIn;
        yield* chat.when.openReadOnly();
        yield* Effect.promise(async () => {
          await s.page.waitForSelector('button[data-agent-id="claude-code"]', {
            visible: true,
          });
          await waitForStillFrames(s.page);
          await s.page.locator('button[data-agent-id="claude-code"]').click();
          await s.page.waitForSelector(
            '[data-sign-in-open="claude-code"][href^="https://claude.scenario.invalid/oauth/authorize"]',
            { visible: true },
          );
          await s.page.waitForSelector("[data-sign-in-code]", { visible: true });
          await s.page.type("[data-sign-in-code]", CLAUDE_SCENARIO_CODE);
          await s.page.keyboard.press("Enter");
          await s.page.waitForSelector(
            '[data-slot="composer-shell"] [role="textbox"]:not([inert] *)',
            { visible: true },
          );
          await s.page.waitForFunction(
            () => document.querySelector("[data-sign-in-code]") === null,
            { polling: "raf" },
          );
        });
        const mate = s.drivers.realMates.get("Ada")!;
        const answer = "The owner's answer is ready before HQ names its owner.";
        // History reaches the end of the viewport, as Cyd's contact-line answer does.
        const history = Array.from(
          { length: 20 },
          (_, at) => `Verified page ${at + 1}: deployed and working.`,
        ).join("\n\n");
        yield* mate.provider.turn([{ kind: "say", text: `${history}\n\n${answer}` }]);
        yield* chat.when.send("Give me an answer");
        yield* chat.then.text(answer);
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => !location.pathname.startsWith("/draft/"), {
            polling: "raf",
          }),
        );
        const url = s.page.url();
        s.given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
        const colleague = yield* s.given.browserActor({ person: "dev" });
        yield* colleague.given.signedIn;
        yield* Effect.promise(() => colleague.page.setViewport({ width: 1786, height: 1000 }));
        yield* Effect.promise(() => colleague.page.goto(url));
        yield* Effect.promise(() =>
          colleague.page
            .waitForFunction(() => document.body.textContent?.includes("you can read along"), {
              polling: "raf",
            })
            .catch(async (cause) => {
              throw new Error(
                `Read-along did not arrive at ${url}: ${await colleague.page.evaluate(() => document.body.innerText)}`,
                { cause },
              );
            }),
        );
        yield* Effect.promise(() => ownerViewport(colleague.page));
        // Hold the real HQ ticket unchanged, after a cold reload forgets account memory.
        const gate = yield* Effect.acquireRelease(
          Effect.promise(() => transportGate(() => s.drivers.hq.origin, "")),
          (gate) => Effect.promise(gate.close),
        );
        s.drivers.routes["https://hqzone.prg1-zerops.zone"] = gate.origin;
        yield* Effect.promise(() => s.web.setRoutes());
        const held = gate.holdHttp((path) => path.startsWith("/api/stream-ticket"));
        yield* Effect.addFinalizer(() => Effect.sync(held.release));
        yield* Effect.promise(async () => {
          await colleague.page.evaluateOnNewDocument((answer) => {
            const paints: OwnershipPaints = {
              controls: 0,
              history: 0,
              answers: [],
              footers: [],
              rooms: [],
            };
            (window as unknown as { ownershipPaints: OwnershipPaints }).ownershipPaints = paints;
            const painted = (selector: string) =>
              [...document.querySelectorAll(selector)].some((node) => {
                const box = node.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && !node.closest("[inert]");
              });
            const frame = () => {
              if (
                painted(
                  '[data-slot="composer-shell"] [role="textbox"], [data-chat-provider-model-picker], button[aria-label="Send message"]',
                )
              )
                paints.controls++;
              if (document.body?.textContent?.includes(answer)) {
                paints.history++;
                const text = [...document.querySelectorAll("[data-timeline-root] p")].find(
                  (node) => node.textContent === answer,
                );
                const footer = document.querySelector('[data-slot="composer-shell"]');
                if (text !== undefined && footer !== null) {
                  paints.answers.push(text.getBoundingClientRect().top);
                  paints.footers.push(footer.getBoundingClientRect().height);
                  paints.rooms.push(
                    footer.getBoundingClientRect().bottom - text.getBoundingClientRect().bottom,
                  );
                }
              }
              requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          }, answer);
          await colleague.page.reload({ waitUntil: "domcontentloaded" });
          await held.held;
          await colleague.page.waitForFunction(
            (answer) =>
              document.body.textContent?.includes(answer) &&
              document.querySelector('[data-slot="composer-shell"]'),
            { polling: "raf" },
            answer,
          );
          await colleague.page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                let frames = 0;
                const frame = () => (++frames === 60 ? resolve() : requestAnimationFrame(frame));
                requestAnimationFrame(frame);
              }),
          );
          const before = await colleague.page.evaluate(() => {
            const paints = (window as unknown as { ownershipPaints: OwnershipPaints })
              .ownershipPaints;
            return {
              top: paints.answers.at(-1)!,
              footer: paints.footers.at(-1)!,
              room: paints.rooms.at(-1)!,
              count: paints.answers.length,
            };
          });
          held.release();
          await colleague.page.waitForFunction(
            () => document.body.textContent?.includes("you can read along"),
            { polling: "raf" },
          );
          await colleague.page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                let frames = 0;
                const frame = () => (++frames === 60 ? resolve() : requestAnimationFrame(frame));
                requestAnimationFrame(frame);
              }),
          );
          const paints = await colleague.page.evaluate(
            () => (window as unknown as { ownershipPaints: OwnershipPaints }).ownershipPaints,
          );
          if (anchor) {
            expect(
              paints.answers.length - before.count,
              "ASSERTION: the answer stays painted through ownership resolution",
            ).toBeGreaterThanOrEqual(60);
            expect(
              before.count,
              "ASSERTION: the answer has painted before ownership resolves",
            ).toBeGreaterThanOrEqual(60);
            expect(
              Math.max(
                ...paints.answers.slice(before.count).map((top) => Math.abs(top - before.top)),
              ),
              "ASSERTION: resolving ownership moves already-painted answer words by at most 1 px",
            ).toBeLessThanOrEqual(1);
            expect(
              Math.max(
                ...paints.rooms.slice(before.count).map((height) => Math.abs(height - before.room)),
              ),
              "ASSERTION: read-along keeps the room held while ownership was pending",
            ).toBeLessThanOrEqual(1);
            const compact = await colleague.page.$eval(
              "[data-zerops-read-only-conversation] [data-chat-composer-main-surface]",
              (surface) => {
                const line = surface.querySelector("p")!;
                const padding = getComputedStyle(line.parentElement!);
                return {
                  height: surface.getBoundingClientRect().height,
                  content:
                    line.getBoundingClientRect().height +
                    parseFloat(padding.paddingTop) +
                    parseFloat(padding.paddingBottom),
                };
              },
            );
            expect(
              Math.abs(compact.height - compact.content),
              "ASSERTION: delayed ownership shows a compact line below transparent held room",
            ).toBeLessThanOrEqual(1);
            expect(
              before.footer - paints.footers.at(-1)!,
              "ASSERTION: the held room leaves the composer chrome",
            ).toBeGreaterThan(1);
            // A real scroll is the next layout change: the temporary room is released.
            const beforeScroll = await colleague.page.$eval(
              ".timeline-legend-list",
              (list) => list.scrollHeight,
            );
            const list = await colleague.page.$(".timeline-legend-list");
            const box = (await list!.boundingBox())!;
            const beforeTop = await colleague.page.$eval(
              ".timeline-legend-list",
              (list) => list.scrollTop,
            );
            // The side gutter targets the timeline, outside a run's nested scroll surface.
            await colleague.page.mouse.move(box.x + box.width - 80, box.y + box.height / 2);
            await colleague.page.mouse.wheel({ deltaY: -200 });
            await colleague.page.waitForFunction(
              (beforeTop) => document.querySelector(".timeline-legend-list")!.scrollTop < beforeTop,
              { polling: "raf" },
              beforeTop,
            );
            await colleague.page.waitForFunction(
              (beforeScroll) =>
                document.querySelector(".timeline-legend-list")!.scrollHeight < beforeScroll,
              { polling: "raf" },
              beforeScroll,
            );
            const afterScroll = await colleague.page.$eval(
              ".timeline-legend-list",
              (list) => list.scrollHeight,
            );
            expect(
              Math.abs(beforeScroll - afterScroll - (before.footer - paints.footers.at(-1)!)),
              "ASSERTION: scrolling releases the transparent room",
            ).toBeLessThanOrEqual(1);
          }
          expect(
            paints.history,
            "ASSERTION: history paints while HQ ownership waits",
          ).toBeGreaterThanOrEqual(60);
          expect(
            paints.controls,
            "ASSERTION: zero painted frames offer a colleague's editor, model or send controls",
          ).toBe(0);
        });
        yield* s.then.noExternalNetwork;
      });
    it.effect(
      "a colleague's conversation never paints writable controls while HQ ownership arrives after history",
      () => ownershipArrives(false),
    );
    it.effect("resolving ownership keeps already-painted conversation words in place", () =>
      ownershipArrives(true),
    );
  });
});
