// @effect-diagnostics nodeBuiltinImport:off -- Optional acceptance frames are local test artifacts.
// @effect-diagnostics preferSchemaOverJson:off -- Human-readable geometry evidence.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const encodeStatus = Schema.encodeSync(VcsStatusResult);
const report = '[data-timeline-row-kind="outcome"] .run-band';
type Reading = {
  height: number;
  content: number;
  held: boolean;
  top: number;
  end: number;
  decoded: boolean;
};
type Trace = { active: boolean; readings: Reading[] };

describe("C: panel to report rooms", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    describe("Decision: one derivation per state; consumers never recompute it; no new domain concepts; mobile stays out (later).", () => {
      for (const [mode, follows] of [
        ["immediate", true],
        ["immediate", false],
        ["late", true],
        ["late", false],
        ["reduced motion", true],
        ["kept", true],
        ["hidden", true],
        ["first layout", true],
      ] as const) {
        it.effect(
          `report content has its full room through ${mode} replacement, following ${follows}`,
          () =>
            Effect.gen(function* () {
              const s = yield* createScenario([installArea]);
              yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
              if (mode === "reduced motion")
                yield* Effect.promise(() =>
                  s.page.emulateMediaFeatures([
                    { name: "prefers-reduced-motion", value: "reduce" },
                  ]),
                );
              let release!: () => void;
              const bytesReady = new Promise<void>((resolve) => {
                release = resolve;
              });
              yield* Effect.addFinalizer(() => Effect.sync(release));
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
              s.drivers.onMate.push((mate) => {
                mate.rpcHandlers.push((request, socket) => {
                  if (request.tag !== WS_METHODS.vcsRefreshStatus) return false;
                  mate.reply(
                    socket,
                    request.id,
                    encodeStatus({
                      isRepo: false,
                      hasPrimaryRemote: false,
                      isDefaultRef: true,
                      refName: null,
                      hasWorkingTreeChanges: false,
                      workingTree: { files: [], insertions: 0, deletions: 0 },
                      hasUpstream: false,
                      aheadCount: 0,
                      behindCount: 0,
                      pr: null,
                    }),
                  );
                  return true;
                });
                const handle = mate.handle;
                mate.handle = async (request) => {
                  if (!request.url.pathname.includes("/api/chat-assets/")) return handle(request);
                  await bytesReady;
                  return { bytes, headers: { "content-type": "image/png" } };
                };
              });
              yield* s.given.project("Ada", { mate: true });
              const chat = mateChat(s);
              const wire = chat.fixture();
              // Enough real earlier content to exercise reading away from the outer end.
              for (let index = 0; index < 20; index++)
                wire.exchange(`Earlier question ${index}`, "Earlier answer.\n\n".repeat(30));
              wire.history("Inspect the report room", "room-run");
              wire.run("room-run", "running");
              for (let index = 0; index < 12; index++)
                wire.activity(
                  "task.started",
                  `Helper ${index}`,
                  {
                    taskId: `helper-${index}`,
                    agentKind: "agent",
                    title: `Helper ${index}`,
                    role: "explorer",
                  },
                  "room-run",
                );
              const picture = (id: string) =>
                wire.tool(
                  id,
                  "tool.completed",
                  {
                    toolName: "Read",
                    input: { file_path: `/tmp/${id}.png` },
                    imagePath: `/tmp/${id}.png`,
                  },
                  "room-run",
                  { itemType: "image_view" },
                );
              const checkedPage = () =>
                wire.tool(
                  "checked-page",
                  "tool.completed",
                  {
                    toolName: "mcp__zerops__zerops_browser",
                    input: { commands: [["open", "https://store.example/orders"]] },
                    zerops: {
                      toolName: "zerops_browser",
                      resultText: '{"url":"https://store.example/orders","steps":[]}',
                    },
                  },
                  "room-run",
                  { itemType: "mcp_tool_call" },
                );
              const settle = () => {
                for (let index = 0; index < 12; index++)
                  wire.activity(
                    "task.completed",
                    `Helper ${index} finished`,
                    {
                      taskId: `helper-${index}`,
                      agentKind: "agent",
                      title: `Helper ${index}`,
                      role: "explorer",
                      status: "completed",
                    },
                    "room-run",
                  );
                wire.message("room-answer", "assistant", "The report is ready", "room-run");
                wire.run("room-run", "completed", null, "room-answer");
              };
              if (mode === "first layout") {
                checkedPage();
                picture("first");
                settle();
              }
              yield* s.given.signedIn;
              yield* chat.when.open("Ada", "Inspect the report room");
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
                      return panel !== null && panel.getBoundingClientRect().height > 300;
                    },
                    { timeout: 8000 },
                  );
                });
              if (mode !== "first layout")
                yield* Effect.promise(async () => {
                  const viewport = await s.page.$(".timeline-legend-list");
                  const box = (await viewport!.boundingBox())!;
                  await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await s.page.mouse.wheel({ deltaY: 10000 });
                });
              yield* Effect.promise(() =>
                s.page.waitForFunction(
                  () => {
                    const scroll = document.querySelector<HTMLElement>(".timeline-legend-list")!;
                    return (
                      Math.abs(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop) <= 2
                    );
                  },
                  { timeout: 8000, polling: "raf" },
                ),
              );
              if (!follows)
                yield* Effect.promise(async () => {
                  const viewport = await s.page.$(".timeline-legend-list");
                  const box = (await viewport!.boundingBox())!;
                  await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
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
                        decoded: [...marker.querySelectorAll("img")].some(
                          (image) => image.naturalWidth === 640,
                        ),
                      });
                    if (trace.active) requestAnimationFrame(sample);
                  };
                  sample();
                }, report),
              );
              if (mode !== "first layout") {
                if (mode !== "late") checkedPage();
                settle();
                if (mode === "late") {
                  yield* chat.then.text("The report is ready");
                  // Exercise the existing late geometry window, not a second animation clock.
                  yield* Effect.promise(() =>
                    s.page.evaluate(() => {
                      const now = performance.now.bind(performance);
                      performance.now = () => now() + 1600;
                    }),
                  );
                  picture("first");
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
              if (mode !== "late" && mode !== "first layout") picture("first");
              picture("second");
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
                        (image) => image.naturalWidth === 640,
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
              const readings = yield* Effect.promise(() =>
                s.page.evaluate(async () => {
                  const trace = (window as unknown as { reportTrace: Trace }).reportTrace;
                  for (let index = 0; index < 30; index++)
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                  trace.active = false;
                  return trace.readings;
                }),
              );
              if (directory)
                yield* Effect.promise(() =>
                  NodeFSP.writeFile(
                    NodePath.join(directory, "geometry.json"),
                    JSON.stringify(readings),
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
              else
                // The virtualizer unmounted the offscreen panel and discarded its geometry.
                expect(
                  readings.some((reading) => reading.held),
                  "ASSERTION: a report without a mounted panel starts at its natural height",
                ).toBe(false);
              if (follows)
                expect(
                  laidOut.at(-1)!.end,
                  "ASSERTION: outer follow reaches the conversation end after report layout",
                ).toBeLessThanOrEqual(2);
              else
                expect(
                  Math.max(...laidOut.map((reading) => reading.top)) -
                    Math.min(...laidOut.map((reading) => reading.top)),
                  "ASSERTION: report growth never pulls a reading conversation toward its end",
                ).toBeLessThanOrEqual(2);

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
                        (image) => image.naturalWidth === 640,
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
