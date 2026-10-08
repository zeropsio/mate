import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const cases = ["owner", "colleague", "reader"] as const;

describe("C: the conversation opening follows readiness", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a slow empty conversation stays behind one waking face, and a warm return never waits",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          yield* s.given.project("Sage", { mate: true });
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture("Sage");
          const conversationSelector = "[data-chat-column-maximized-away]";
          const openingFinished = (name: string) =>
            Effect.promise(() =>
              s.page.waitForFunction(
                (name, conversationSelector) => {
                  const column = document.querySelector(conversationSelector);
                  const body = column?.querySelector(
                    "[data-conversation-content]:not([data-kept-timeline] *)",
                  );
                  return (
                    location.pathname === `/env-${name}/thread-${name}` &&
                    Boolean(
                      column?.querySelector(
                        '[data-conversation-avatar] [data-opening-actor="complete"]',
                      ),
                    ) &&
                    body !== null &&
                    body !== undefined &&
                    getComputedStyle(body).opacity === "1"
                  );
                },
                {},
                name,
                conversationSelector,
              ),
            );
          wire.holdReplay = true;
          const read = wire.holdPage("", s.drivers.mates.get("Sage")!.snapshot());
          yield* Effect.addFinalizer(() => Effect.sync(() => read.release()));
          yield* s.given.signedIn;
          yield* chat.when.openReadOnly("Sage");
          yield* Effect.promise(() => read.requested());
          const stage = yield* Effect.promise(() =>
            s.page.waitForSelector(
              '[data-chat-workspace-drop-target] [data-conversation-opening="waiting"]',
            ),
          );
          yield* Effect.promise(() =>
            s.page.evaluate(
              (stage, conversationSelector) => {
                const samples: Array<{
                  phase: string | undefined;
                  bodyOpacity: string | undefined;
                  faces: number;
                  transform: string | undefined;
                }> = [];
                Reflect.set(window, "emptyOpeningSamples", samples);
                const column = stage?.closest("[data-chat-workspace-drop-target]");
                // The complete face lands in the header, outside the timeline column.
                const conversation = stage?.closest(conversationSelector);
                const sample = () => {
                  const phase = stage?.getAttribute("data-conversation-opening") ?? undefined;
                  const body = column?.querySelector(
                    "[data-conversation-content]:not([data-kept-timeline] *)",
                  );
                  const actor = conversation?.querySelector("[data-opening-actor]");
                  const visible = (face: Element) => {
                    for (
                      let node: Element | null = face;
                      node !== null;
                      node = node.parentElement
                    ) {
                      const style = getComputedStyle(node);
                      if (
                        style.opacity === "0" ||
                        style.visibility === "hidden" ||
                        node.hasAttribute("inert")
                      )
                        return false;
                    }
                    return face.getBoundingClientRect().width > 0;
                  };
                  samples.push({
                    phase,
                    bodyOpacity: body ? getComputedStyle(body).opacity : undefined,
                    faces: [
                      ...(conversation?.querySelectorAll("[data-mate-face-state]") ?? []),
                    ].filter(visible).length,
                    transform: actor ? getComputedStyle(actor).transform : undefined,
                  });
                  if (phase !== "complete") requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              },
              stage,
              conversationSelector,
            ),
          );
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                (Reflect.get(window, "emptyOpeningSamples") as Array<{ phase?: string }>).length >
                0,
            ),
          );
          read.release();
          yield* Effect.promise(() => wire.replaySubscribed());
          wire.ready();
          // DOM completion can precede the sampler's next frame; consume its own receipt.
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                (Reflect.get(window, "emptyOpeningSamples") as Array<{ phase?: string }>).at(-1)
                  ?.phase === "complete",
            ),
          );
          const samples = yield* Effect.promise(() =>
            s.page.evaluate(
              () =>
                Reflect.get(window, "emptyOpeningSamples") as Array<{
                  phase: string | undefined;
                  bodyOpacity: string | undefined;
                  faces: number;
                  transform: string | undefined;
                }>,
            ),
          );
          expect(samples[0]?.phase).toBe("waiting");
          expect(samples.at(-1)?.phase).toBe("complete");
          expect(
            samples
              .filter(
                (sample) =>
                  sample.phase === "wake" ||
                  sample.phase === "hand-off" ||
                  sample.phase === "complete",
              )
              .every((sample) => sample.faces === 1),
          ).toBe(true);
          const waking = samples.filter((sample) => sample.phase === "wake");
          expect(waking.length).toBeGreaterThan(0);
          expect(
            waking.every(
              (sample) =>
                sample.bodyOpacity === "0" && sample.faces === 1 && sample.transform === "none",
            ),
          ).toBe(true);
          yield* chat.when.openReadOnly("Ada");
          yield* chat.then.ready("Ada");
          yield* openingFinished("Ada");
          yield* Effect.promise(() =>
            s.page.evaluate((conversationSelector) => {
              const phases: string[] = [];
              Reflect.set(window, "warmOpeningPhases", phases);
              const sample = () => {
                const phase = document
                  .querySelector(conversationSelector)
                  ?.querySelector<HTMLElement>("[data-conversation-opening]")
                  ?.dataset.conversationOpening;
                if (phase) phases.push(phase);
                requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }, conversationSelector),
          );
          yield* chat.when.openReadOnly("Sage");
          yield* chat.then.ready("Sage");
          yield* openingFinished("Sage");
          const phases = yield* Effect.promise(() =>
            s.page.evaluate(() => Reflect.get(window, "warmOpeningPhases") as string[]),
          );
          expect(phases).not.toContain("waiting");
          expect(phases).not.toContain("wake");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
  it.layer(Layer.merge(tempPostgresLayer, NodeServices.layer), { excludeTestServices: true })(
    (it) => {
      for (const entry of ["menu", "project"] as const)
        for (const person of cases)
          for (const theme of ["light", "dark"] as const)
            for (const narrow of [false, true])
              for (const sidebar of [true, false]) {
                const label = `${entry === "project" ? "project-" : ""}${person}-${theme}-${narrow ? "narrow" : "wide"}-${sidebar ? "sidebar" : "closed"}`;
                it.effect(
                  `${person === "reader" ? "a refused member keeps one stage and sees no protected history" : "one waiting stage hands over to the ready conversation"}: ${label}`,
                  () =>
                    Effect.gen(function* () {
                      const fs = yield* FileSystem.FileSystem;
                      const path = yield* Path.Path;
                      const s = yield* createScenario([installArea]);
                      yield* s.given.project("Sage", { mate: true });
                      const chat = mateChat(s);
                      const wire = chat.fixture("Sage");
                      wire.history("Sage's conversation is ready");
                      wire.ownership = person === "colleague" ? "colleague" : "project-token";
                      wire.holdReplay = true;
                      const read = wire.holdPage("", s.drivers.mates.get("Sage")!.snapshot());
                      yield* Effect.addFinalizer(() => Effect.sync(() => read.release()));
                      if (person === "reader") s.given.asPerson("reader");
                      yield* Effect.promise(() =>
                        s.page.setViewport({ width: narrow ? 900 : 1786, height: 1000 }),
                      );
                      yield* Effect.promise(() =>
                        s.page.emulateMediaFeatures([
                          { name: "prefers-color-scheme", value: theme },
                        ]),
                      );
                      yield* Effect.promise(() => s.clock.install());
                      const output = process.env.MATE_STAGE_EVIDENCE;
                      yield* Effect.promise(() =>
                        s.page.evaluateOnNewDocument(() => {
                          const samples: Array<{
                            phase: string;
                            x: number;
                            y: number;
                            width: number;
                            columnX: number;
                            columnWidth: number;
                            stages: number;
                            leadY: number;
                            leadHeight: number;
                            areaHeight: number;
                          }> = [];
                          let seenStage = false;
                          let conversationReady = false;
                          Object.assign(window, {
                            openingStageGap: false,
                            openingEyesAtReady: null,
                          });
                          const visible = (node: Element) =>
                            node.getBoundingClientRect().height > 0 &&
                            getComputedStyle(node).visibility !== "hidden" &&
                            !node.closest('[aria-hidden="true"]');
                          const sample = () => {
                            const timeline = [
                              ...document.querySelectorAll<HTMLElement>(
                                "[data-timeline-thread]:not([data-timeline-placing])",
                              ),
                            ].find(
                              (node) => !node.closest("[data-kept-timeline]") && visible(node),
                            );
                            if (timeline) conversationReady = true;
                            const stages = [
                              ...document.querySelectorAll<HTMLElement>(
                                '[data-zerops-surface="mate-empty-state"]',
                              ),
                            ].filter((node) => !node.closest("[data-kept-timeline]"));
                            const stage = stages[0];
                            const column =
                              document.querySelector<HTMLElement>(
                                "[data-chat-workspace-drop-target]",
                              ) ??
                              document.querySelector<HTMLElement>(
                                '[data-zerops-surface="mate-coming-page"]',
                              );
                            if (stage && column) {
                              const box = stage.getBoundingClientRect();
                              const pane = column.getBoundingClientRect();
                              const lead = stage
                                .querySelector("[data-mate-empty-lead]")!
                                .getBoundingClientRect();
                              const phase = stage
                                .closest("[data-conversation-opening]")
                                ?.getAttribute("data-conversation-opening");
                              if (
                                phase === "hand-off" &&
                                Reflect.get(window, "openingEyesAtReady") === null
                              ) {
                                const eyes = [...stage.querySelectorAll("[data-mate-face-eye]")];
                                const shut = [...stage.querySelectorAll("[data-mate-face-shut]")];
                                Reflect.set(window, "openingEyesAtReady", {
                                  open:
                                    eyes.length === 2 &&
                                    eyes.every((eye) => getComputedStyle(eye).opacity === "1"),
                                  shut: shut.some((eye) => getComputedStyle(eye).opacity !== "0"),
                                });
                              }
                              if (box.width > 0 && visible(stage)) seenStage = true;
                              else if (seenStage && !conversationReady && phase !== "complete")
                                Reflect.set(window, "openingStageGap", true);
                              samples.push({
                                phase:
                                  stage
                                    .closest("[data-conversation-opening]")
                                    ?.getAttribute("data-conversation-opening") ?? "route",
                                x: box.x,
                                y: box.y,
                                width: box.width,
                                columnX: pane.x,
                                columnWidth: pane.width,
                                stages: stages.length,
                                leadY: lead.y,
                                leadHeight: lead.height,
                                areaHeight: box.height,
                              });
                            } else if (seenStage && !conversationReady) {
                              Reflect.set(window, "openingStageGap", true);
                            }
                            requestAnimationFrame(sample);
                          };
                          Object.assign(window, { stageSamples: samples });
                          requestAnimationFrame(sample);
                        }),
                      );
                      yield* s.given.signedIn;
                      const frames: Array<{ data: string; timestamp: number | undefined }> = [];
                      const cdp = output
                        ? yield* Effect.promise(() => s.page.createCDPSession())
                        : undefined;
                      if (cdp) {
                        cdp.on("Page.screencastFrame", (frame) => {
                          frames.push({ data: frame.data, timestamp: frame.metadata.timestamp });
                          void cdp
                            .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
                            .catch(() => undefined);
                        });
                        yield* Effect.promise(() =>
                          cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 }),
                        );
                      }
                      if (entry === "project") yield* chat.when.visit("/mate/Sage");
                      else yield* chat.when.openReadOnly("Sage");
                      if (person === "reader")
                        yield* chat.then.text("Sage isn't available with your access.");
                      else {
                        yield* Effect.promise(() => read.requested());
                        yield* Effect.promise(() =>
                          s.page.waitForSelector('[data-conversation-opening="waiting"]', {
                            timeout: 8000,
                          }),
                        );
                      }
                      if (!sidebar) yield* chat.when.press("Collapse sidebar");
                      const stage = yield* Effect.promise(() =>
                        s.page.$('[data-zerops-surface="mate-empty-state"]'),
                      );
                      expect(stage).not.toBeNull();
                      yield* Effect.promise(async () => {
                        const waiting = await s.page.$$('[data-zerops-surface="mate-empty-state"]');
                        expect(waiting).toHaveLength(1);
                        expect(
                          await stage!.evaluate((node) =>
                            node
                              .querySelector("[data-mate-face-state]")
                              ?.getAttribute("data-mate-face-state"),
                          ),
                        ).toBe(person === "reader" ? "sleep" : "waking");
                        // Time passing and a finished face animation cannot make the held source read ready.
                        if (person !== "reader") {
                          expect(
                            await s.page.evaluate(() => {
                              const footer = document.querySelector("[data-conversation-footer]");
                              const held = document.querySelector("[data-composer-room-held]");
                              return footer !== null
                                ? getComputedStyle(footer).opacity !== "0"
                                : held !== null && getComputedStyle(held).visibility !== "hidden";
                            }),
                          ).toBe(false);
                          await s.clock.advance(10_000);
                          expect(
                            await stage!.evaluate((node) =>
                              node
                                .closest("[data-conversation-opening]")
                                ?.getAttribute("data-conversation-opening"),
                            ),
                          ).toBe("waiting");
                        }
                      });
                      if (output) {
                        yield* fs.remove(path.join(output, label), {
                          recursive: true,
                          force: true,
                        });
                        yield* fs.makeDirectory(path.join(output, label), { recursive: true });
                        yield* Effect.promise(() =>
                          s.page.screenshot({ path: path.join(output, label, "waiting.png") }),
                        );
                      }
                      if (person === "reader") {
                        yield* chat.then.text("Sage isn't available with your access.");
                        yield* Effect.promise(async () => {
                          expect(
                            await s.page.evaluate(() =>
                              document.body.innerText.includes("Sage's conversation is ready"),
                            ),
                          ).toBe(false);
                          expect(
                            await s.page.$$('[data-zerops-surface="mate-empty-state"]'),
                          ).toHaveLength(1);
                        });
                      } else {
                        read.release();
                        wire.ready();
                        yield* chat.then.text("Sage's conversation is ready");
                        yield* Effect.promise(async () => {
                          await s.page.waitForSelector('[data-conversation-opening="complete"]');
                          expect(
                            await s.page.$eval(
                              "[data-conversation-footer]",
                              (node) => getComputedStyle(node).visibility,
                            ),
                          ).toBe("visible");
                          const exposure = await s.page.evaluate(() => {
                            const footer = document.querySelector("[data-conversation-footer]")!;
                            const input = footer.querySelector('[role="textbox"]')!;
                            const box = input.getBoundingClientRect();
                            return {
                              width: box.width,
                              height: box.height,
                              exposed: [0.2, 0.5, 0.8].every((fraction) =>
                                input.contains(
                                  document.elementFromPoint(
                                    box.left + box.width * fraction,
                                    box.top + box.height / 2,
                                  ),
                                ),
                              ),
                            };
                          });
                          expect(
                            exposure.width,
                            "ASSERTION: ready composer has a visible input",
                          ).toBeGreaterThan(32);
                          expect(
                            exposure.height,
                            "ASSERTION: ready composer has a visible input",
                          ).toBeGreaterThan(8);
                          expect(
                            exposure.exposed,
                            "ASSERTION: nothing covers the ready composer",
                          ).toBe(true);
                          if (entry === "menu")
                            expect(
                              await stage!.evaluate(
                                (node) =>
                                  node ===
                                  document.querySelector(
                                    '[data-conversation-opening] [data-zerops-surface="mate-empty-state"]',
                                  ),
                              ),
                            ).toBe(true);
                          expect(
                            await s.page.$eval("[data-conversation-avatar]", (node) =>
                              node
                                .querySelector("[data-mate-face-state]")
                                ?.getAttribute("data-mate-face-state"),
                            ),
                          ).toBe("idle");
                          expect(await s.page.$$("[data-conversation-opening]")).toHaveLength(1);
                          await s.page.waitForFunction(() => {
                            const stage = document.querySelector(
                              '[data-conversation-opening="complete"]',
                            );
                            return stage && getComputedStyle(stage).visibility === "hidden";
                          });
                        });
                      }
                      if (cdp) yield* Effect.promise(() => cdp.send("Page.stopScreencast"));
                      if (output) {
                        const dir = path.join(output, label);
                        yield* Effect.promise(() =>
                          s.page.screenshot({ path: path.join(dir, "ready.png") }),
                        );
                        yield* Effect.all(
                          frames.map((frame, i) =>
                            fs.writeFile(
                              path.join(dir, `${String(i).padStart(4, "0")}.png`),
                              Buffer.from(frame.data, "base64"),
                            ),
                          ),
                        );
                        const samples = yield* Effect.promise(() =>
                          s.page.evaluate(() => Reflect.get(window, "stageSamples")),
                        );
                        yield* fs.writeFileString(
                          path.join(dir, "positions.json"),
                          encodeJson(samples),
                        );
                        yield* fs.writeFileString(
                          path.join(dir, "eyes-at-ready.json"),
                          encodeJson(
                            yield* Effect.promise(() =>
                              s.page.evaluate(() => Reflect.get(window, "openingEyesAtReady")),
                            ),
                          ),
                        );
                        yield* fs.writeFileString(
                          path.join(dir, "frames.json"),
                          encodeJson(
                            frames.map(({ timestamp }, i) => ({
                              frame: i,
                              timestamp: timestamp ?? null,
                            })),
                          ),
                        );
                      }
                      expect(
                        yield* Effect.promise(() =>
                          s.page.evaluate(() => Reflect.get(window, "openingStageGap")),
                        ),
                      ).toBe(false);
                      if (person !== "reader")
                        expect(
                          yield* Effect.promise(() =>
                            s.page.evaluate(() => Reflect.get(window, "openingEyesAtReady")),
                          ),
                        ).toEqual({ open: true, shut: false });
                      if (cdp) yield* Effect.promise(() => cdp.detach());
                      yield* s.then.noExternalNetwork;
                    }),
                );
              }
    },
  );
});
