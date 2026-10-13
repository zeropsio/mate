// @effect-diagnostics nodeBuiltinImport:off -- Optional acceptance frames are local test artifacts.
// @effect-diagnostics preferSchemaOverJson:off -- Human-readable geometry evidence.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import {
  type AssetCreateUrlInput,
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  RuntimeItemId,
  RuntimeTaskId,
  WS_METHODS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import type {
  ScriptedEvent,
  ScriptedStep,
} from "../../../../../server/integration/scriptedProviderDriver.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";

// Authored external tool facts; real SPI readers own the call, picture and report projections.
const roomTool = (id: string, picture?: string): ScriptedEvent => {
  const input = picture
    ? { file_path: picture }
    : { commands: [["open", "https://store.example/orders"]] };
  const output = picture ? undefined : '{"url":"https://store.example/orders","steps":[]}';
  return {
    type: "item.completed",
    itemId: RuntimeItemId.make(id),
    payload: {
      itemType: picture ? "image_view" : "mcp_tool_call",
      status: "completed",
      data: {
        tool: picture ? "Read" : "zerops_zerops_browser",
        state: { status: "completed", input, output },
        toolName: picture ? "Read" : "mcp__zerops__zerops_browser",
        input,
        ...(picture
          ? { imagePath: picture }
          : { result: { content: [{ type: "text", text: output }] } }),
      },
    },
  };
};
const roomHelper = (index: number, completed = false): ScriptedStep => ({
  kind: "event",
  event: completed
    ? {
        type: "task.completed",
        payload: {
          taskId: RuntimeTaskId.make(`helper-${index}`),
          taskType: "subagent",
          status: "completed",
        },
      }
    : {
        type: "task.started",
        payload: {
          taskId: RuntimeTaskId.make(`helper-${index}`),
          taskType: "subagent",
          title: `Helper ${index}`,
        },
      },
});

// The tile's own native RPC demand is the decode oracle, not the original fixture size.
type PictureWitness = {
  requests: Record<string, { width: number; height: number }>;
  decoded: (image: HTMLImageElement) => boolean;
};
const installPictureWitness = () => {
  const requests: PictureWitness["requests"] = {};
  (window as unknown as { reportPictures: PictureWitness }).reportPictures = {
    requests,
    decoded: (image) => {
      const source = image.dataset.imageSrc;
      if (!source?.startsWith("mate-image:")) return false;
      const reference = JSON.parse(decodeURIComponent(source.slice("mate-image:".length))) as {
        resource: AssetCreateUrlInput["resource"];
      };
      const expected =
        reference.resource._tag === "workspace-file"
          ? requests[reference.resource.path]
          : undefined;
      return (
        expected !== undefined &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalWidth === expected.width &&
        image.naturalHeight === expected.height
      );
    },
  };
};

const report = '[data-timeline-row-kind="outcome"] .run-band';
type Reading = {
  height: number;
  content: number;
  held: boolean;
  top: number;
  end: number;
  decoded: boolean;
  /** When it was read (`performance.now()`), and where the report stood in the view. */
  at: number;
  y: number;
};
/** `arrivedAt`: the first reading after a reader away from the end scrolled to the report's card. */
type Trace = { active: boolean; readings: Reading[]; arrivedAt?: number; grownAt?: number };

describe("C: panel to report rooms", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    describe("Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).", () => {
      for (const [mode, follows] of [["late", true]] as ReadonlyArray<
        readonly [
          "immediate" | "late" | "reduced motion" | "kept" | "hidden" | "first layout",
          boolean,
        ]
      >) {
        it.effect(
          `report content has its full room through ${mode} replacement, following ${follows}`,
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([], { mate: "real" });
              yield* Effect.promise(() => s.page.evaluateOnNewDocument(installPictureWitness));
              const requests = yield* Effect.promise(() => s.page.createCDPSession());
              const observed: Promise<unknown>[] = [];
              requests.on("Network.webSocketFrameSent", ({ response }) => {
                for (const line of response.payloadData.trim().split("\n")) {
                  const request = JSON.parse(line) as {
                    tag?: string;
                    payload?: AssetCreateUrlInput;
                  };
                  if (
                    request.tag !== WS_METHODS.assetsCreateUrl ||
                    !request.payload?.preview ||
                    request.payload.resource._tag !== "workspace-file"
                  )
                    continue;
                  observed.push(
                    s.page.evaluate(
                      ({ path, preview }) => {
                        (
                          window as unknown as { reportPictures: PictureWitness }
                        ).reportPictures.requests[path] = preview;
                      },
                      { path: request.payload.resource.path, preview: request.payload.preview },
                    ),
                  );
                }
              });
              yield* Effect.promise(() => requests.send("Network.enable"));
              yield* Effect.addFinalizer(() =>
                Effect.promise(async () => {
                  await requests.detach();
                  await Promise.all(observed);
                }),
              );
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              if (mode === "reduced motion")
                yield* Effect.promise(() =>
                  s.page.emulateMediaFeatures([
                    { name: "prefers-reduced-motion", value: "reduce" },
                  ]),
                );
              const bytes = Buffer.from(
                yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    const canvas = document.createElement("canvas");
                    canvas.width = 640;
                    canvas.height = 400;
                    canvas.getContext("2d")!.fillRect(0, 0, 640, 400);
                    return canvas.toDataURL("image/png").split(",")[1]!;
                  }),
                ),
                "base64",
              );
              yield* s.given.project("Ada", { mate: true });
              const chat = mateChat(s);
              const { server, provider, gate } = s.drivers.realMates.get("Ada")!;
              const heldPictures = gate.holdHttp(
                (path) => path.includes("/api/") && path.includes("assets/"),
              );
              const release = () => heldPictures.release();
              yield* Effect.addFinalizer(() => Effect.sync(release));
              for (const id of ["first", "second"])
                yield* Effect.promise(() =>
                  NodeFSP.writeFile(NodePath.join(server.root, "workspace", `${id}.png`), bytes),
                );
              const conversationId = ConversationId.make("thread-Ada");
              const protocol = MATE_ENGINE_PROTOCOLS[0]!;
              const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
              yield* server.engine.assignAgent(conversationId, {
                instanceId: "opencode",
                driver: "opencode",
                model: "gpt-5.4",
                profile: { kind: "mate" },
              });
              const changes = yield* Queue.unbounded<EngineConversationFrame>();
              yield* server.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
                Stream.runForEach((frame) => Queue.offer(changes, frame)),
                Effect.forkScoped,
              );
              while ((yield* Queue.take(changes)).type !== "synchronized") {}
              const send = (text: string, id: string) =>
                server.engine.wire.send(
                  { protocol, conversationId, commandId: CommandId.make(id), text },
                  caller,
                );
              for (let index = 0; index < 20; index++) {
                yield* provider.turn([{ kind: "say", text: "Earlier answer.\n\n".repeat(30) }]);
                expect((yield* send(`Earlier question ${index}`, `history-${index}`))._tag).toBe(
                  "Accepted",
                );
                while (true) {
                  const frame = yield* Queue.take(changes);
                  if (
                    frame.type === "changes" &&
                    frame.runs.some((run) => run.ordinal === index + 1 && run.state === "ended")
                  )
                    break;
                }
              }
              const settlement = yield* Deferred.make<void>();
              yield* provider.turn([
                ...Array.from({ length: 12 }, (_, index) => roomHelper(index)),
                { kind: "wait", until: settlement },
                ...Array.from({ length: 12 }, (_, index) => roomHelper(index, true)),
                { kind: "say", text: "The report is ready" },
              ]);
              expect((yield* send("Inspect the report room", "room-run"))._tag).toBe("Accepted");
              // Earlier sends have already passed through the same real driver.
              for (let index = 0; index < 20; index++) yield* provider.received;
              const native = yield* provider.received;
              const picture = (id: string) =>
                provider.event(native.threadId, {
                  ...roomTool(id, NodePath.join(server.root, "workspace", `${id}.png`)),
                  turnId: native.turnId,
                });
              const checkedPage = () =>
                provider.event(native.threadId, {
                  ...roomTool("checked-page"),
                  turnId: native.turnId,
                });
              const settle = () => Deferred.succeed(settlement, undefined);
              if (mode === "first layout") {
                yield* checkedPage();
                yield* picture("first");
                yield* settle();
                while (true) {
                  const frame = yield* Queue.take(changes);
                  if (
                    frame.type === "changes" &&
                    frame.runs.some((run) => run.ordinal === 21 && run.state === "ended")
                  )
                    break;
                }
              }
              yield* s.given.signedIn;
              yield* Effect.promise(async () => {
                const rail = (await s.page.$('[data-sidebar="rail"]'))!;
                const box = (await rail.boundingBox())!;
                const width = await s.page.$eval(
                  '[data-sidebar="sidebar"]',
                  (sidebar) => sidebar.getBoundingClientRect().width,
                );
                await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await s.page.mouse.down();
                await s.page.mouse.move(
                  box.x + box.width / 2 + 435 - width,
                  box.y + box.height / 2,
                );
                await s.page.mouse.up();
                await s.page.waitForFunction(
                  () =>
                    document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect()
                      .width === 435,
                );
              });
              yield* s.when.menu.opensMate("Ada");
              yield* s.then.conversation.showsMessage("Inspect the report room");
              if (mode !== "first layout")
                yield* Effect.promise(() =>
                  s.page.waitForSelector('[data-timeline-row-kind="working"]'),
                );
              if (mode !== "first layout")
                yield* Effect.promise(async () => {
                  await s.page.locator('button[aria-label^="Helpers:"]').click();
                  await s.page.waitForFunction(
                    () => {
                      const panel = document.querySelector('[data-timeline-row-kind="working"]');
                      return (
                        panel !== null &&
                        panel.getBoundingClientRect().height > 300 &&
                        panel
                          .getAnimations({ subtree: true })
                          .every(
                            (animation) =>
                              animation.effect?.getComputedTiming().iterations === Infinity ||
                              animation.playState === "finished",
                          )
                      );
                    },
                    { timeout: 8000 },
                  );
                });
              if (mode !== "first layout")
                yield* Effect.promise(async () => {
                  // Put work at its end without relying on a nested wheel chaining to the timeline.
                  await s.page.$eval("[data-run-scroll]", (work) => {
                    work.scrollTop = work.scrollHeight;
                  });
                  await s.page.waitForFunction(
                    () => {
                      const work = document.querySelector<HTMLElement>("[data-run-scroll]")!;
                      return Math.abs(work.scrollHeight - work.clientHeight - work.scrollTop) <= 2;
                    },
                    { timeout: 8000, polling: "raf" },
                  );
                  const viewport = await s.page.$(".timeline-legend-list");
                  const box = (await viewport!.boundingBox())!;
                  await s.page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
                  await s.page.mouse.wheel({ deltaY: 10000 });
                });
              yield* Effect.promise(() =>
                expect
                  .poll(
                    () =>
                      s.page.evaluate(() => {
                        const scroll =
                          document.querySelector<HTMLElement>(".timeline-legend-list")!;
                        return Math.abs(
                          scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
                        );
                      }),
                    {
                      timeout: 8000,
                      message: "ASSERTION: the outer gesture reaches the timeline end",
                    },
                  )
                  .toBeLessThanOrEqual(2),
              );
              yield* Effect.promise(() =>
                s.page.waitForSelector("[data-timeline-follows-end]", { timeout: 8000 }),
              );
              if (!follows)
                yield* Effect.promise(async () => {
                  const viewport = await s.page.$(".timeline-legend-list");
                  const box = (await viewport!.boundingBox())!;
                  await s.page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
                  await s.page.mouse.wheel({ deltaY: -1600 });
                  await s.page.waitForFunction(
                    () => !document.querySelector("[data-timeline-follows-end]"),
                  );
                });
              // KeptTimelines freezes its remote snapshot while away. Exercise the room's
              // existing DOM visibility marker directly so the real report can change beneath it.
              if (mode === "kept")
                yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    const timeline = document.querySelector<HTMLElement>("[data-timeline-thread]")!;
                    timeline.setAttribute("data-kept-timeline", "");
                    timeline.classList.add("invisible");
                  }),
                );
              if (mode === "hidden")
                yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    Object.defineProperty(document, "visibilityState", {
                      configurable: true,
                      value: "hidden",
                    });
                    document.dispatchEvent(new Event("visibilitychange"));
                  }),
                );
              const frames = process.env.MATE_REPORT_FRAMES;
              const directory = frames
                ? NodePath.join(frames, `${mode.replaceAll(" ", "-")}-${follows}`)
                : undefined;
              const recording = yield* Effect.promise(() => s.page.createCDPSession());
              const saved: Promise<unknown>[] = [];
              let frame = 0;
              if (directory) {
                yield* Effect.promise(() => NodeFSP.mkdir(directory, { recursive: true }));
                recording.on("Page.screencastFrame", (event) => {
                  saved.push(
                    NodeFSP.writeFile(
                      NodePath.join(directory, `${String(frame++).padStart(5, "0")}.png`),
                      Buffer.from(event.data, "base64"),
                    ),
                  );
                  saved.push(
                    recording.send("Page.screencastFrameAck", { sessionId: event.sessionId }),
                  );
                });
                yield* Effect.promise(() =>
                  recording.send("Page.startScreencast", { format: "png", everyNthFrame: 1 }),
                );
              }
              yield* Effect.addFinalizer(() =>
                Effect.promise(async () => {
                  if (directory) await recording.send("Page.stopScreencast");
                  await Promise.all(saved);
                  await recording.detach();
                }),
              );
              // Start before replacement so the witness includes the first obstructed frame.
              yield* Effect.promise(() =>
                s.page.evaluate((report) => {
                  const trace: Trace = { active: true, readings: [] };
                  (window as unknown as { reportTrace: Trace }).reportTrace = trace;
                  const sample = () => {
                    const marker = document.querySelector<HTMLElement>(report);
                    const root = marker?.parentElement;
                    const scroll = root
                      ?.closest("[data-timeline-thread]")
                      ?.querySelector<HTMLElement>(".timeline-legend-list");
                    if (root && marker && scroll)
                      trace.readings.push({
                        height: root.offsetHeight,
                        content: marker.offsetHeight,
                        held: root.style.height !== "",
                        top: scroll.scrollTop,
                        end: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
                        decoded: [...marker.querySelectorAll("img")].some((image) =>
                          (
                            window as unknown as { reportPictures: PictureWitness }
                          ).reportPictures.decoded(image),
                        ),
                        at: performance.now(),
                        y: marker.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
                      });
                    if (trace.active) requestAnimationFrame(sample);
                  };
                  sample();
                }, report),
              );
              if (mode !== "first layout") {
                if (mode !== "late") yield* checkedPage();
                yield* settle();
                // Away from the end, the report lands where the reader is not: they scroll to its
                // card, and it shows there (the list builds rows near the view, not 700 px off it).
                if (!follows)
                  yield* Effect.promise(async () => {
                    await s.page.waitForFunction(() => {
                      const records = document.querySelectorAll(
                        '[data-timeline-row-kind="record"]',
                      );
                      return records.length > 0;
                    });
                    // The reader's own wheel brings the card into view, a step at a time.
                    const viewport = (await s.page.$(".timeline-legend-list"))!;
                    const box = (await viewport.boundingBox())!;
                    await s.page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
                    const cardTop = () =>
                      s.page.evaluate(() => {
                        const scroll =
                          document.querySelector<HTMLElement>(".timeline-legend-list")!;
                        const tops = [
                          ...document.querySelectorAll<HTMLElement>(
                            '[data-timeline-row-kind="record"]',
                          ),
                        ].map(
                          (card) =>
                            card.getBoundingClientRect().top - scroll.getBoundingClientRect().top,
                        );
                        return Math.max(...tops);
                      });
                    // Until the card stands in the view's lower part: below it, only its report
                    // and answer, so any further is the end, where the list follows again.
                    const inView = box.height - 300;
                    for (
                      let step = 0, left = (await cardTop()) - inView;
                      step < 40 && left > 0;
                      step++
                    ) {
                      const beforeWheel = await s.page.evaluate(
                        () =>
                          document.querySelector<HTMLElement>(".timeline-legend-list")!.scrollTop,
                      );
                      await s.page.mouse.wheel({ deltaY: Math.min(100, left + 4) });
                      await s.page.waitForFunction(
                        (before) =>
                          document.querySelector<HTMLElement>(".timeline-legend-list")!.scrollTop >
                          before,
                        { timeout: 8000, polling: "raf" },
                        beforeWheel,
                      );
                      left = (await cardTop()) - inView;
                    }
                    // Arrived once the view stands still: what moves after is the page's doing.
                    await s.page.evaluate(async () => {
                      const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                      let still = 0;
                      let last = scroll.scrollTop;
                      for (let frame = 0; frame < 120 && still < 5; frame++) {
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        still = scroll.scrollTop === last ? still + 1 : 0;
                        last = scroll.scrollTop;
                      }
                      const trace = (window as unknown as { reportTrace: Trace }).reportTrace;
                      trace.arrivedAt = trace.readings.length;
                    });
                    expect(
                      await s.page.$("[data-timeline-follows-end]"),
                      "ASSERTION: a reader who scrolled to the card still reads away from the end",
                    ).toBeNull();
                  });
                if (mode === "late") {
                  yield* chat.then.text("The report is ready");
                  // Exercise the existing late geometry window, not a second animation clock.
                  yield* Effect.promise(() =>
                    s.page.evaluate(() => {
                      const now = performance.now.bind(performance);
                      performance.now = () => now() + 1600;
                    }),
                  );
                  yield* picture("first");
                }
              }
              yield* Effect.promise(() => s.page.waitForSelector(report));
              yield* Effect.promise(async () => {
                await s.page.waitForFunction(
                  (report) => {
                    const marker = document.querySelector<HTMLElement>(report)!;
                    const trace = (window as unknown as { reportTrace: Trace }).reportTrace;
                    // Picture insertion follows a sampled, laid-out report frame.
                    return (
                      marker.parentElement!.style.height === "" &&
                      trace.readings.some((reading) => reading.content > 0 && !reading.held)
                    );
                  },
                  { polling: "raf", timeout: 8000 },
                  report,
                );
              });
              // A tool picture joins the checked-page report after its measured shrink.
              // What the test grows the report by from here is content, not the arrival.
              yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const trace = (window as unknown as { reportTrace: Trace }).reportTrace;
                  trace.grownAt = trace.readings.length;
                }),
              );
              if (mode !== "late" && mode !== "first layout") yield* picture("first");
              yield* picture("second");
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  (report) =>
                    document.querySelectorAll(`${report} [data-result-picture]`).length >= 2,
                  { timeout: 8000 },
                  report,
                ),
              );
              release();
              if (mode === "kept")
                yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    const timeline = document.querySelector<HTMLElement>("[data-timeline-thread]")!;
                    timeline.removeAttribute("data-kept-timeline");
                    timeline.classList.remove("invisible");
                  }),
                );
              if (mode === "hidden")
                yield* Effect.promise(() =>
                  s.page.evaluate(() => {
                    Object.defineProperty(document, "visibilityState", {
                      configurable: true,
                      value: "visible",
                    });
                    document.dispatchEvent(new Event("visibilitychange"));
                  }),
                );
              // Away pictures reserve their room but defer bytes until they are near the view.
              if (follows)
                yield* Effect.promise(() =>
                  s.page.waitForFunction(
                    (report) =>
                      [...document.querySelectorAll<HTMLImageElement>(`${report} img`)].length >=
                        2 &&
                      [...document.querySelectorAll<HTMLImageElement>(`${report} img`)].every(
                        (image) =>
                          (
                            window as unknown as { reportPictures: PictureWitness }
                          ).reportPictures.decoded(image),
                      ),
                    { timeout: 8000 },
                    report,
                  ),
                );
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () => {
                    const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                    return (
                      !scroll.hasAttribute("data-timeline-gliding") &&
                      !scroll.querySelector('[data-run-fold="folding"], [data-room-easing]') &&
                      [...scroll.querySelectorAll<HTMLElement>("[data-fold-room]")].every(
                        (room) => room.style.height === "",
                      )
                    );
                  },
                  { timeout: 8000, polling: "raf" },
                ),
              );
              const { readings, settledFrom, arrivedAt, grownAt } = yield* Effect.promise(() =>
                s.page.evaluate(async () => {
                  const trace = (window as unknown as { reportTrace: Trace }).reportTrace;
                  const settledFrom = trace.readings.length;
                  // Sampled until ten laid-out frames read the same, at least 30 frames and at
                  // most 180: a stalled runner still finishing its last layout settles later, and
                  // what alternates never reads the same ten frames running.
                  const still = () => {
                    const last = trace.readings.filter((reading) => reading.content > 0).slice(-10);
                    return (
                      last.length === 10 &&
                      new Set(
                        last.map(({ height, content, top, end }) =>
                          JSON.stringify([height, content, top, end]),
                        ),
                      ).size === 1
                    );
                  };
                  for (let index = 0; index < 180 && (index < 30 || !still()); index++)
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  trace.active = false;
                  return {
                    readings: trace.readings,
                    settledFrom,
                    arrivedAt: trace.arrivedAt,
                    grownAt: trace.grownAt,
                  };
                }),
              );
              if (directory)
                yield* Effect.promise(() =>
                  NodeFSP.writeFile(
                    NodePath.join(directory, "geometry.json"),
                    JSON.stringify({ arrivedAt, readings }),
                  ),
                );
              expect(
                readings.length,
                "ASSERTION: first, intermediate and final report frames were sampled",
              ).toBeGreaterThan(1);
              const laidOut = readings.filter((reading) => reading.content > 0);
              expect(
                laidOut.every((reading) => reading.height >= reading.content),
                "ASSERTION: no frame clips report content beneath a departed panel height",
              ).toBe(true);
              expect(
                laidOut.at(-1)!.held,
                "ASSERTION: the report finishes at its natural height",
              ).toBe(false);
              if (follows) expect(laidOut.at(-1)!.decoded).toBe(true);
              // Each layout the report and the viewport stood at once all motion was over, in order,
              // a repeat dropped: one standing again after another is the alternation.
              const states = readings
                .slice(settledFrom)
                .filter((reading) => reading.content > 0)
                .map(({ height, content, top, end }) => JSON.stringify([height, content, top, end]))
                .filter((state, index, all) => index === 0 || state !== all[index - 1]);
              expect(
                states.filter((state, index) => states.indexOf(state) !== index),
                "ASSERTION: no report layout or viewport stands again after another took its place",
              ).toEqual([]);
              const finalFrames = laidOut.slice(-10);
              expect(
                new Set(
                  finalFrames.map(({ height, content, top, end }) =>
                    JSON.stringify([height, content, top, end]),
                  ),
                ).size,
                "ASSERTION: final report layout and outer viewport settle without alternating",
              ).toBe(1);
              if (mode !== "late" && mode !== "first layout")
                expect(
                  laidOut.at(-1)!.content,
                  "ASSERTION: a subsequent tool picture grows the assembled report",
                ).toBeGreaterThan(Math.min(...laidOut.map((reading) => reading.content)));

              if (
                mode === "late" ||
                mode === "reduced motion" ||
                mode === "first layout" ||
                mode === "hidden" ||
                mode === "kept"
              )
                expect(
                  readings.some((reading) => reading.held),
                  "ASSERTION: growth and unseen or reduced-motion handoffs never hold a height",
                ).toBe(false);
              else if (follows)
                expect(
                  readings.some((reading) => reading.held),
                  "ASSERTION: the measured panel handoff includes shrinking frames",
                ).toBe(true);
              else {
                // The reader arrives at the card as it settles: whatever the hand-off holds, the
                // report never jumps — its largest step a frame at a 60 Hz pace stays small.
                const arrived = readings
                  .slice(arrivedAt ?? 0, grownAt)
                  .filter((reading) => reading.content > 0);
                const steps = arrived.slice(1).map((reading, index) => {
                  const before = arrived[index]!;
                  const frames = Math.max(1, (reading.at - before.at) / (1000 / 60));
                  return (
                    Math.max(
                      Math.abs(reading.height - before.height),
                      Math.abs(reading.y - before.y),
                    ) / frames
                  );
                });
                expect(
                  Math.max(0, ...steps),
                  "ASSERTION: the report the reader comes to never steps 24 px in a frame",
                ).toBeLessThan(24);
                // What it replaced left out of the reader's view: nothing of it is handed over.
                expect(
                  readings.some((reading) => reading.held),
                  "ASSERTION: a report without a mounted panel starts at its natural height",
                ).toBe(false);
                const shown = yield* Effect.promise(() =>
                  s.page.evaluate((report) => {
                    const marker = document.querySelector<HTMLElement>(report)!.parentElement!;
                    const view = marker
                      .closest("[data-timeline-thread]")!
                      .querySelector<HTMLElement>(".timeline-legend-list")!
                      .getBoundingClientRect();
                    const box = marker.getBoundingClientRect();
                    return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
                  }, report),
                );
                expect(shown, "ASSERTION: the report the reader came to is in full view").toBe(
                  true,
                );
              }
              if (follows)
                expect(
                  laidOut.at(-1)!.end,
                  "ASSERTION: outer follow reaches the conversation end after report layout",
                ).toBeLessThanOrEqual(2);
              else {
                // From where the reader stopped: their own wheel is no pull.
                const read = readings
                  .slice(arrivedAt ?? 0)
                  .filter((reading) => reading.content > 0);
                expect(
                  Math.max(...read.map((reading) => reading.top)) -
                    Math.min(...read.map((reading) => reading.top)),
                  "ASSERTION: report growth never pulls a reading conversation toward its end",
                ).toBeLessThanOrEqual(2);
              }

              if (!follows) {
                yield* Effect.promise(async () => {
                  const marker = await s.page.$(report);
                  await marker!.scrollIntoView();
                });
                yield* Effect.promise(() =>
                  s.page.waitForFunction(
                    (report) =>
                      [...document.querySelectorAll<HTMLImageElement>(`${report} img`)].length >=
                        2 &&
                      [...document.querySelectorAll<HTMLImageElement>(`${report} img`)].every(
                        (image) =>
                          (
                            window as unknown as { reportPictures: PictureWitness }
                          ).reportPictures.decoded(image),
                      ),
                    { timeout: 8000 },
                    report,
                  ),
                );
                const full = yield* Effect.promise(() =>
                  s.page.evaluate((report) => {
                    const marker = document.querySelector<HTMLElement>(report)!;
                    return (
                      marker.parentElement!.offsetHeight >= marker.offsetHeight &&
                      marker.parentElement!.style.height === ""
                    );
                  }, report),
                );
                expect(
                  full,
                  "ASSERTION: revealing decoded report pictures keeps their full natural room",
                ).toBe(true);
              }
              yield* s.then.noExternalNetwork;
            }),
        );
      }
    });
  });
});
