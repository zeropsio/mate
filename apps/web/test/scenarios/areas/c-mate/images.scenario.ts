// @effect-diagnostics nodeBuiltinImport:off -- Optional frame recording uses Node filesystem tools.
import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import { RuntimeItemId, RuntimeRequestId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import type { RealMate } from "../../harness/scenario.ts";
import type {
  ScriptedEvent,
  ScriptedStep,
} from "../../../../../server/integration/scriptedProviderDriver.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { waitForStillFrames } from "../../harness/stillFrames.ts";

// Authored OpenCode tool facts; the real SPI and engine derive the call and image records.
const nativeCall = (
  type: "item.started" | "item.updated" | "item.completed",
  id: string,
  itemType: "command_execution" | "image_view",
  input: Record<string, string>,
): ScriptedEvent => ({
  type,
  itemId: RuntimeItemId.make(id),
  payload: {
    itemType,
    status: type === "item.completed" ? "completed" : "inProgress",
    detail: input.command ?? input.file_path,
    data: {
      tool: itemType === "image_view" ? "Read" : "Bash",
      state: { status: type === "item.completed" ? "completed" : "running", input },
    },
  },
});
const nativeStep = (event: ScriptedEvent): ScriptedStep => ({ kind: "event", event });
const pastePng = (page: Parameters<typeof mateChat>[0]["page"], encoded: string, name: string) =>
  Effect.promise(async () => {
    await page
      .locator(
        '[role="textbox"]:not([inert], [inert] *, [aria-hidden="true"], [aria-hidden="true"] *)',
      )
      .waitHandle();
    await page.evaluate(
      (encoded, name) => {
        const blob = new Blob([Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0))], {
          type: "image/png",
        });
        const clipboard = new DataTransfer();
        clipboard.items.add(new File([blob], name, { type: "image/png" }));
        const composer = document.querySelector<HTMLElement>(
          '[role="textbox"]:not([inert], [inert] *, [aria-hidden="true"], [aria-hidden="true"] *)',
        )!;
        composer.focus();
        composer.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: clipboard,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      encoded,
      name,
    );
    await page.waitForSelector(
      `button[aria-label$=", ${name}. Opens it to crop or add notes."], button[aria-label="Remove ${name} from this answer"]`,
    );
  });
const assetReads = (mate: RealMate) =>
  mate.gate.requests.filter(
    (request) => request.startsWith("GET ") && request.includes("/api/assets/"),
  );

function expectBoxWithinHalfPixel(
  actual: Record<string, number>,
  expected: Record<string, number>,
) {
  for (const [dimension, value] of Object.entries(expected)) {
    expect(
      Math.abs(actual[dimension]! - value),
      `ASSERTION: ${dimension} stays within 0.5 px of its reserved dimension`,
    ).toBeLessThanOrEqual(0.5);
  }
}
describe("C: conversation images", () => {
  scenarioSuite((it) => {
    it.effect("a steering picture lands intact while the turn continues", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        const bytes = Buffer.from(
          yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = 160;
              canvas.height = 80;
              canvas.getContext("2d")!.fillRect(0, 0, 160, 80);
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          ),
          "base64",
        );
        yield* s.given.project("Ada", { mate: true });
        const mate = s.drivers.realMates.get("Ada")!;
        const chat = mateChat(s);
        // The answer record also draws a compact rendition; its initial read may outlast the chat picture.
        const answerPreviews: Array<{ width: number; height: number; path: string }> = [];
        const answerPicture = mate.gate.holdFrames((frame) => {
          if (frame.isBinary) return false;
          const preview = Buffer.from(frame.bytes)
            .toString()
            .match(/"representation":\{[^}]*"width":(\d+),"height":(\d+),"relativeUrl":"([^"]+)"/);
          if (preview === null || Number(preview[1]) >= 160) return false;
          answerPreviews.push({
            width: Number(preview[1]),
            height: Number(preview[2]),
            path: preview[3]!,
          });
          return true;
        });
        yield* Effect.addFinalizer(() => Effect.sync(answerPicture.release));
        const keepWorking = yield* Deferred.make<void>();
        yield* mate.provider.turn([
          nativeStep(
            nativeCall("item.completed", "earlier", "command_execution", {
              command: "printf earlier-work",
            }),
          ),
          nativeStep({
            type: "user-input.requested",
            requestId: RuntimeRequestId.make("picture-answer"),
            payload: {
              responseMode: "message",
              questions: [
                {
                  id: "picture",
                  header: "Picture",
                  question: "Which picture should I use?",
                  allowCustomAnswer: true,
                  multiSelect: false,
                  options: [],
                },
              ],
            },
          }),
          { kind: "wait", until: keepWorking },
        ]);
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* chat.when.type("Watch the steering picture");
        yield* chat.when.press("Send message");
        const native = yield* mate.provider.received;
        yield* chat.then.text("printf earlier-work");
        yield* chat.then.text("Which picture should I use?");
        yield* chat.when.type("Use this steering picture");
        yield* pastePng(s.page, bytes.toString("base64"), "steering.png");
        yield* chat.then.text("Attached to this answer");
        yield* chat.when.key("Enter");
        const answer = yield* mate.provider.received;
        expect(answer.turnId).toBe(native.turnId);
        expect(answer.input.attachments?.map((attachment) => attachment.name)).toEqual([
          "steering.png",
        ]);
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => {
            const image = document.querySelector<HTMLImageElement>(
              '[data-message-role="user"] img[data-image-src]',
            );
            if (image?.naturalWidth !== 160) return false;
            return true;
          }),
        );
        yield* Effect.promise(() => waitForStillFrames(s.page));
        yield* Effect.promise(() => answerPicture.held);
        const answerSlot = yield* Effect.promise(() =>
          s.page.$eval('[data-person-pictures] img[alt="steering.png"]', (image) => {
            const box = image.getBoundingClientRect();
            return {
              width: Math.round(box.width * devicePixelRatio),
              height: Math.round(box.height * devicePixelRatio),
            };
          }),
        );
        // A resize can cancel earlier demands. Wait for the rendition of the settled answer slot.
        const answerPreview = answerPreviews
          .filter(
            (preview) => preview.width >= answerSlot.width && preview.height >= answerSlot.height,
          )
          .sort((a, b) => a.width * a.height - b.width * b.height)[0]!.path;
        yield* Effect.promise(async () => {
          const read = s.page
            .waitForResponse(
              (response) =>
                response.request().method() === "GET" && response.url().endsWith(answerPreview),
            )
            .then((response) => response.buffer());
          answerPicture.release();
          await read;
          await waitForStillFrames(s.page);
        });
        const before = yield* Effect.promise(() =>
          s.page.$eval(
            '[data-message-role="user"] img[data-image-src]',
            (image) => (image as HTMLImageElement).src,
          ),
        );
        const reads = assetReads(mate).length;
        yield* mate.provider.event(
          native.threadId,
          nativeCall("item.started", "later", "command_execution", { command: "printf later" }),
        );
        yield* chat.then.text("printf later");
        yield* Effect.promise(() => waitForStillFrames(s.page));
        expect(
          yield* Effect.promise(() =>
            s.page.$eval(
              '[data-message-role="user"] img[data-image-src]',
              (image) => (image as HTMLImageElement).src,
            ),
          ),
        ).toBe(before);
        expect(
          assetReads(mate).length,
          "ASSERTION: continuing the turn starts no new asset read after its pictures settle",
        ).toBe(reads);
        const landing = yield* Effect.promise(() =>
          s.page.evaluate(() => {
            const images = document.querySelectorAll<HTMLImageElement>(
              '[data-message-role="user"] img[data-image-src]',
            );
            const image = images[0]!;
            const row = image.closest('[data-message-role="user"]')!;
            const card = document.querySelector("[data-run-chat][data-run-live]")!;
            return {
              count: images.length,
              insideCard: card.contains(image),
              overlap: row.getBoundingClientRect().bottom - card.getBoundingClientRect().top,
            };
          }),
        );
        expect(landing.count, "ASSERTION: the steering picture is drawn once").toBe(1);
        expect(
          landing.insideCard,
          "ASSERTION: the steering picture lands outside the work card",
        ).toBe(false);
        expect(
          landing.overlap,
          "ASSERTION: the steering picture lands above its active work card",
        ).toBeLessThanOrEqual(0.5);
        yield* s.then.noExternalNetwork;
      }),
    );

    it.effect("decoded conversation and work pictures stay in place while a turn streams", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([], { mate: "real" });
        yield* Effect.promise(() =>
          s.page.setViewport({ width: 1786, height: 1000, deviceScaleFactor: 2 }),
        );
        const bytes = Buffer.from(
          yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = 160;
              canvas.height = 80;
              const ctx = canvas.getContext("2d")!;
              ctx.fillStyle = "#e66432";
              ctx.fillRect(0, 0, 160, 80);
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          ),
          "base64",
        );
        yield* s.given.project("Ada", { mate: true });
        const mate = s.drivers.realMates.get("Ada")!;
        const chat = mateChat(s);
        const wait = yield* Deferred.make<void>();
        const work = NodePath.join(mate.server.root, "workspace", "work.png");
        const secondWork = NodePath.join(mate.server.root, "workspace", "second-work.png");
        yield* Effect.promise(() =>
          Promise.all([work, secondWork].map((path) => NodeFSP.writeFile(path, bytes))),
        );
        yield* mate.provider.turn([
          nativeStep(
            nativeCall("item.started", "progress", "command_execution", {
              command: "printf work-update-0",
            }),
          ),
          nativeStep(nativeCall("item.completed", "work-image", "image_view", { file_path: work })),
          nativeStep(
            nativeCall("item.completed", "second-work-image", "image_view", {
              file_path: secondWork,
            }),
          ),
          { kind: "wait", until: wait },
        ]);
        yield* s.given.signedIn;
        yield* s.when.menu.opensMate("Ada");
        yield* s.then.conversation.appears;
        yield* chat.when.type("Watch these pictures while you work");
        for (const id of ["one", "two", "three"])
          yield* pastePng(s.page, bytes.toString("base64"), `${id}.png`);
        yield* chat.when.press("Send message");
        const native = yield* mate.provider.received;
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => {
            const images = [...document.querySelectorAll<HTMLImageElement>("img[data-image-src]")];
            return (
              images.length === 5 &&
              images.every(
                (image) =>
                  image.getBoundingClientRect().top >= 0 &&
                  image.getBoundingClientRect().bottom <= innerHeight &&
                  image.naturalWidth === 160 &&
                  [
                    image,
                    ...Array.from(
                      (function* () {
                        for (
                          let parent = image.parentElement;
                          parent !== null;
                          parent = parent.parentElement
                        )
                          yield parent;
                      })(),
                    ),
                  ].every((node) => Number(getComputedStyle(node).opacity) === 1),
              )
            );
          }),
        );
        const initialRequests = assetReads(mate).length;
        const frames = process.env.MATE_IMAGE_FRAMES;
        const recording = yield* Effect.promise(() => s.page.createCDPSession());
        const recorded: Promise<unknown>[] = [];
        let frame = 0;
        if (frames) {
          yield* Effect.promise(() => NodeFSP.mkdir(frames, { recursive: true }));
          recording.on("Page.screencastFrame", (event) => {
            recorded.push(
              NodeFSP.writeFile(
                NodePath.join(frames, `${String(frame++).padStart(5, "0")}.png`),
                Buffer.from(event.data, "base64"),
              ),
            );
            recorded.push(
              recording.send("Page.screencastFrameAck", { sessionId: event.sessionId }),
            );
          });
          yield* Effect.promise(() =>
            recording.send("Page.startScreencast", { format: "png", everyNthFrame: 1 }),
          );
        }
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            if (frames) await recording.send("Page.stopScreencast");
            await Promise.all(recorded);
            await recording.detach();
          }),
        );
        const watched = yield* Effect.promise(() =>
          s.page.evaluateHandle(() => {
            const images = [...document.querySelectorAll<HTMLImageElement>("img[data-image-src]")];
            const held = images.map((image) => ({
              image,
              src: image.src,
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
            }));
            const violations = new Set<string>();
            let frame = 0;
            let running = true;
            const sample = () => {
              frame++;
              for (const { image: previous, src, width, height } of held) {
                const image = document.querySelector<HTMLImageElement>(
                  `img[data-image-src="${previous.dataset.imageSrc}"]`,
                );
                if (!image) {
                  violations.add(`${previous.alt}: missing`);
                  continue;
                }
                if (image.naturalWidth !== 160) violations.add(`${image.alt}: undecoded`);
                if (image.src !== src) violations.add(`${image.alt}: src changed`);
                if (image.closest("[hidden]")) continue;
                if (
                  Math.round(image.getBoundingClientRect().width) !== Math.round(width) ||
                  Math.round(image.getBoundingClientRect().height) !== Math.round(height)
                )
                  violations.add(
                    `${image.alt}: size ${width}x${height} -> ${image.getBoundingClientRect().width}x${image.getBoundingClientRect().height}`,
                  );
                for (let node: Element | null = image; node !== null; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (Number(style.opacity) < 1)
                    violations.add(`${image.alt}: faded by ${node.className} (${style.opacity})`);
                  const box = node.getBoundingClientRect();

                  const picture = image.getBoundingClientRect();
                  if (
                    (style.clipPath !== "none" ||
                      ["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) &&
                    (picture.top < box.top - 1 || picture.bottom > box.bottom + 1)
                  ) {
                    violations.add(
                      `${image.alt}: clipped by ${node.className} ${style.overflowY}/${style.clipPath} ${style.height} ${picture.top}:${picture.bottom} vs ${box.top}:${box.bottom}`,
                    );
                  }
                }
              }
              if (running) requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
            return {
              held,
              violations,
              finish: () => {
                running = false;
                return { frames: frame, violations: [...violations] };
              },
            };
          }),
        );
        for (let update = 0; update < 24; update++) {
          yield* mate.provider.event(
            native.threadId,
            nativeCall("item.updated", "progress", "command_execution", {
              command: `printf work-update-${update}${"\necho growing".repeat(update % 4)}`,
            }),
          );
          yield* chat.then.text(`printf work-update-${update}`);
          if (update === 7)
            yield* Effect.promise(() =>
              s.page.waitForFunction(
                () => document.querySelectorAll(".run-scroll img[data-image-src]").length === 2,
              ),
            );
          if (update === 8) yield* chat.when.activate("Hide work");
          if (update === 16) yield* chat.when.activate("Show work");
          const images = yield* Effect.promise(() =>
            s.page.evaluate(
              (watched) =>
                watched.held.map((held) => {
                  const image = document.querySelector<HTMLImageElement>(
                    `img[data-image-src="${held.image.dataset.imageSrc}"]`,
                  );
                  return {
                    sameSrc: image?.src === held.src,
                    hidden: Boolean(image?.closest("[hidden]")),
                    decoded:
                      image?.naturalWidth === 160 && Number(getComputedStyle(image).opacity) === 1,
                    sameSize:
                      Boolean(image?.closest("[hidden]")) ||
                      (Math.round(image?.getBoundingClientRect().width ?? 0) ===
                        Math.round(held.width) &&
                        Math.round(image?.getBoundingClientRect().height ?? 0) ===
                          Math.round(held.height)),
                  };
                }),
              watched,
            ),
          );
          expect(images).toEqual(
            Array.from({ length: 5 }, (_, index) => ({
              sameSrc: true,
              hidden: index >= 3 && update >= 8 && update < 16,
              decoded: true,
              sameSize: true,
            })),
          );
          expect(
            yield* Effect.promise(() =>
              s.page.evaluate((watched) => [...watched.violations], watched),
            ),
          ).toEqual([]);
        }
        expect(assetReads(mate).slice(initialRequests)).toEqual([]);
        const film = yield* Effect.promise(() =>
          s.page.evaluate((watched) => watched.finish(), watched),
        );
        expect(film.frames).toBeGreaterThan(0);
        expect(film.violations).toEqual([]);
        yield* s.then.noExternalNetwork;
      }),
    );
    for (const role of ["assistant", "reasoning"] as const) {
      it.effect(
        `a decoded ${role} image survives markdown restructuring and landing while work continues`,
        () =>
          Effect.gen(function* () {
            const s = yield* createScenario([], { mate: "real" });
            const bytes = Buffer.from(
              yield* Effect.promise(() =>
                s.page.evaluate(() => {
                  const canvas = document.createElement("canvas");
                  canvas.width = 160;
                  canvas.height = 80;
                  canvas.getContext("2d")!.fillRect(0, 0, 160, 80);
                  return canvas.toDataURL("image/png").split(",")[1]!;
                }),
              ),
              "base64",
            );
            yield* s.given.project("Ada", { mate: true });
            const mate = s.drivers.realMates.get("Ada")!;
            const chat = mateChat(s);
            const keepWorking = yield* Deferred.make<void>();
            const imagePath = NodePath.join(mate.server.root, "workspace", "assistant.png");
            yield* Effect.promise(() => NodeFSP.writeFile(imagePath, bytes));
            const itemId = RuntimeItemId.make("illustration");
            const itemType = role === "assistant" ? "assistant_message" : "reasoning";
            const streamKind = role === "assistant" ? "assistant_text" : "reasoning_text";
            const text = `![assistant picture](${imagePath})`;
            yield* mate.provider.turn([
              nativeStep({ type: "item.started", itemId, payload: { itemType } }),
              nativeStep({ type: "content.delta", itemId, payload: { streamKind, delta: text } }),
              { kind: "wait", until: keepWorking },
            ]);
            yield* s.given.signedIn;
            yield* s.when.menu.opensMate("Ada");
            yield* s.then.conversation.appears;
            yield* chat.when.type("Watch the assistant picture");
            yield* chat.when.press("Send message");
            const native = yield* mate.provider.received;
            const append = (delta: string) =>
              mate.provider.event(native.threadId, {
                type: "content.delta",
                itemId,
                payload: { streamKind, delta },
              });
            yield* Effect.promise(() =>
              s.page.waitForFunction(() => {
                const image = document.querySelector<HTMLImageElement>(
                  ".run-slot img[data-image-src]",
                );
                if (image?.naturalWidth !== 160) return false;
                for (let node: Element | null = image; node; node = node.parentElement) {
                  if (Number(getComputedStyle(node).opacity) !== 1) return false;
                }
                return true;
              }),
            );
            const held = yield* Effect.promise(() =>
              s.page.evaluateHandle(() => {
                const image = document.querySelector<HTMLImageElement>(
                  ".run-slot img[data-image-src]",
                )!;
                const src = image.src;
                const failures = new Set<string>();
                let running = true;
                const sample = () => {
                  const current = document.querySelector<HTMLImageElement>(
                    `img[data-image-src="${image.dataset.imageSrc}"]`,
                  );
                  if (!current) {
                    failures.add("missing pixels");
                  } else if (
                    current.naturalWidth !== 160 ||
                    current.closest("[data-image-pending]")
                  )
                    failures.add("undecoded pixels");
                  if (current?.src !== src) failures.add("src changed");
                  for (let node: Element | null = current; node; node = node.parentElement) {
                    if (Number(getComputedStyle(node).opacity) < 1)
                      failures.add(
                        `faded by ${node.tagName} ${node.className} (${getComputedStyle(node).opacity})`,
                      );
                  }
                  if (running) requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
                return {
                  image,
                  src,
                  finish: () => {
                    running = false;
                    return [...failures];
                  },
                };
              }),
            );
            const initialReads = assetReads(mate).filter((request) =>
              request.includes("/preview "),
            ).length;
            // Setext changes the image paragraph into a heading using only a streamed suffix.
            yield* append("\n---");
            yield* Effect.promise(() =>
              s.page.waitForFunction(() =>
                Boolean(
                  document.querySelector(
                    ".run-slot h4 img[data-image-src], .run-slot h2 img[data-image-src]",
                  ),
                ),
              ),
            );
            yield* append("\n\n[Docs](#docs)\n\nMore assistant words after the picture");
            yield* chat.then.text("More assistant words after the picture");
            for (const [index, focus] of (role === "assistant"
              ? ["button", "a[href='#docs']"]
              : []
            ).entries()) {
              const focused = yield* Effect.promise(() =>
                s.page.evaluateHandle((focus) => {
                  const element = document.querySelector<HTMLElement>(`.run-slot ${focus}`)!;
                  element.focus();
                  return element;
                }, focus),
              );
              for (let delta = 0; delta < 4; delta++) {
                yield* append(`\n\nMore assistant words ${index}-${delta}`);
                yield* chat.then.text(`More assistant words ${index}-${delta}`);
                expect(
                  yield* Effect.promise(() =>
                    s.page.evaluate((focused) => document.activeElement === focused, focused),
                  ),
                ).toBe(true);
              }
            }
            yield* mate.provider.event(native.threadId, {
              type: "item.completed",
              itemId,
              payload: { itemType },
            });
            yield* mate.provider.event(
              native.threadId,
              nativeCall("item.started", "later", "command_execution", {
                command: "printf later-0",
              }),
            );
            for (let update = 0; update < 24; update++) {
              yield* mate.provider.event(
                native.threadId,
                nativeCall("item.updated", "later", "command_execution", {
                  command: `printf later-${update}`,
                }),
              );
              yield* chat.then.text(`printf later-${update}`);
            }
            yield* Effect.promise(() =>
              s.page.waitForFunction(() =>
                Boolean(document.querySelector(".run-scroll img[data-image-src]")),
              ),
            );
            expect(
              yield* Effect.promise(() =>
                s.page.evaluate(
                  (held) => ({
                    sameSrc:
                      document.querySelector<HTMLImageElement>(".run-scroll img[data-image-src]")
                        ?.src === held.src,
                    failures: held.finish(),
                  }),
                  held,
                ),
              ),
            ).toEqual({ sameSrc: true, failures: [] });
            expect(assetReads(mate).filter((request) => request.includes("/preview ")).length).toBe(
              initialReads,
            );
            yield* s.then.noExternalNetwork;
          }),
      );
    }

    it.effect(
      "result screenshots fill their reserved boxes and permanent missing files have no retry",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* Effect.promise(() =>
            s.page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 }),
          );
          const bytes = Buffer.from(
            yield* Effect.promise(() =>
              s.page.evaluate(() => {
                const canvas = document.createElement("canvas");
                canvas.width = 160;
                canvas.height = 100;
                canvas.getContext("2d")!.fillRect(0, 0, 160, 100);
                return canvas.toDataURL("image/png").split(",")[1]!;
              }),
            ),
            "base64",
          );
          yield* s.given.project("Ada", { mate: true });
          const mate = s.drivers.realMates.get("Ada")!;
          const shot = NodePath.join(mate.server.root, "workspace", "shot.png");
          const missingPath = NodePath.join(mate.server.root, "workspace", "gone.png");
          yield* Effect.promise(() => NodeFSP.writeFile(shot, bytes));
          const held = mate.gate.holdHttp((path) => path.includes("/api/assets/"));
          const release = held.release;
          yield* Effect.addFinalizer(() => Effect.sync(release));
          yield* mate.provider.turn([
            nativeStep(
              nativeCall("item.completed", "read-shot", "image_view", { file_path: shot }),
            ),
            nativeStep(
              nativeCall("item.completed", "read-gone", "image_view", { file_path: missingPath }),
            ),
            { kind: "say", text: "The screenshots are in the result" },
          ]);
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          yield* s.when.conversation.sends("Screenshot report");
          yield* s.then.conversation.showsMessage("The screenshots are in the result");
          yield* Effect.promise(() => s.page.waitForSelector("[data-result-picture] img"));
          yield* Effect.promise(() =>
            s.page.$eval("[data-result-picture] img", (image) =>
              image.scrollIntoView({ block: "center" }),
            ),
          );
          yield* Effect.promise(() => held.held);
          yield* Effect.promise(() =>
            s.page.waitForFunction(() =>
              [...document.querySelectorAll("[data-result-picture]")].some(
                (n) => n.textContent === "Image no longer available",
              ),
            ),
          );
          const pending = yield* Effect.promise(() =>
            s.page.$eval("[data-result-picture]:has(img)", (tile) => {
              const image = tile.querySelector("img")!;
              return {
                width: tile.getBoundingClientRect().width,
                height: tile.getBoundingClientRect().height,
                imageHeight: image.getBoundingClientRect().height,
              };
            }),
          );
          expectBoxWithinHalfPixel(
            { imageHeight: pending.imageHeight },
            { imageHeight: pending.height },
          );
          release();
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => {
              const image = document.querySelector<HTMLImageElement>("[data-result-picture] img");
              return image?.naturalWidth === 160 && Number(getComputedStyle(image).opacity) === 1;
            }),
          );
          const loaded = yield* Effect.promise(() =>
            s.page.$eval("[data-result-picture]:has(img)", (tile) => ({
              width: tile.getBoundingClientRect().width,
              height: tile.getBoundingClientRect().height,
              imageHeight: tile.querySelector("img")!.getBoundingClientRect().height,
            })),
          );
          expectBoxWithinHalfPixel(loaded, pending);
          expect(assetReads(mate).every((request) => request.endsWith("/preview 200"))).toBe(true);
          const gone = yield* Effect.promise(() =>
            s.page.$eval("[data-result-picture]:has(.asset-image-unavailable)", (tile) => ({
              text: tile.textContent,
              retry: tile.querySelector("button") !== null,
              height: tile.getBoundingClientRect().height,
              surfaceHeight: tile.querySelector(".asset-image-unavailable")!.getBoundingClientRect()
                .height,
            })),
          );
          expect({ text: gone.text, retry: gone.retry }).toEqual({
            text: "Image no longer available",
            retry: false,
          });
          expectBoxWithinHalfPixel(
            { height: gone.height, surfaceHeight: gone.surfaceHeight },
            {
              height: pending.height,
              surfaceHeight: pending.height,
            },
          );
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
