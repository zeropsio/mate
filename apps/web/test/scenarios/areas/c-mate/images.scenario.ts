// @effect-diagnostics nodeBuiltinImport:off -- Optional frame recording uses Node filesystem tools.
import { describe, expect, it } from "@effect/vitest";
import { WS_METHODS, AssetCreateUrlInput, AssetCreateUrlResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
const decode = Schema.decodeUnknownSync(AssetCreateUrlInput);
const encode = Schema.encodeSync(AssetCreateUrlResult);
const picture = ".message-picture-open img";
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
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("decoded conversation and work pictures stay in place while a turn streams", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
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
        const requests: string[] = [];
        s.drivers.onMate.push((mate) => {
          Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
          Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
          mate.rpcHandlers.unshift((request, socket) => {
            if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
            const input = decode(request.payload);
            const id =
              input.resource._tag === "attachment"
                ? String(["one", "two", "three"].indexOf(input.resource.attachmentId) + 1)
                : input.resource.path?.includes("bbbbbbbb")
                  ? "5"
                  : "4";
            mate.reply(
              socket,
              request.id,
              encode({
                representation: {
                  digest: id.padEnd(64, "a"),
                  relativeUrl: `/api/assets/objects/${id.padEnd(64, "a")}/preview`,
                  mimeType: "image/png",
                  sizeBytes: bytes.length,
                  width: 160,
                  height: 80,
                },
                relativeUrl: `/api/assets/objects/${id.padEnd(64, "a")}/preview`,
                expiresAt: 0,
                imageDimensions: { width: 160, height: 80 },
              }),
            );
            return true;
          });
          const handle = mate.handle;
          mate.handle = (request) => {
            if (!request.url.pathname.includes("/api/assets/objects/")) return handle(request);
            requests.push(request.url.pathname + request.url.search);
            return Promise.resolve({ bytes, headers: { "content-type": "image/png" } });
          };
        });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.message(
          "pictures",
          "user",
          "[Picture 1]\n[Picture 2]\n[Picture 3]\nWatch these pictures while you work",
          "stream",
          {
            attachments: ["one", "two", "three"].map((id) => ({
              type: "image" as const,
              id,
              name: `${id}.png`,
              mimeType: "image/png",
              sizeBytes: bytes.length,
              width: 160,
              height: 80,
            })),
          },
        );
        const work = {
          toolName: "Read",
          input: { file_path: "/tmp/work.png" },
          imagePath: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        };
        wire.run("stream", "running");
        wire.tool(
          "progress",
          "tool.started",
          { command: "printf work-update-0", kind: "execute" },
          "stream",
        );
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Watch these pictures while you work");
        wire.tool("work-image", "tool.completed", work, "stream", { itemType: "image_view" });
        const secondWork = {
          ...work,
          imagePath: "mate-asset:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        };
        wire.tool("second-work-image", "tool.completed", secondWork, "stream", {
          itemType: "image_view",
        });
        yield* Effect.promise(() =>
          s.page
            .waitForFunction(
              () => {
                const images = [
                  ...document.querySelectorAll<HTMLImageElement>("img[data-image-src]"),
                ];
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
              },
              { timeout: 8000 },
            )
            .catch(async (cause) => {
              throw new Error(
                JSON.stringify({
                  requests,
                  text: await s.page.evaluate(() => document.body.innerText),
                  images: await s.page.$$eval("img[data-image-src]", (images) =>
                    images.map((image) => ({
                      src: image.getAttribute("src"),
                      alt: image.getAttribute("alt"),
                      box: image.getBoundingClientRect().toJSON(),
                      opacity: getComputedStyle(image).opacity,
                      width: (image as HTMLImageElement).naturalWidth,
                    })),
                  ),
                }),
                { cause },
              );
            }),
        );
        const initialRequests = requests.length;
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
          wire.tool(
            "progress",
            "tool.updated",
            {
              kind: "execute",
              command: `printf work-update-${update}${"\necho growing".repeat(update % 4)}`,
              rawOutput: { content: `Work update ${update}` },
            },
            "stream",
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
        expect(requests.slice(initialRequests)).toEqual([]);
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
            const s = yield* createScenario([installArea]);
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
            let previewReads = 0;
            s.drivers.onMate.push((mate) => {
              Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
              Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
              mate.rpcHandlers.unshift((request, socket) => {
                if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
                const input = decode(request.payload);
                mate.reply(
                  socket,
                  request.id,
                  encode({
                    representation: {
                      digest: "c".repeat(64),
                      relativeUrl: `/api/assets/objects/${"c".repeat(64)}/${input.preview ? "preview" : "original"}`,
                      mimeType: "image/png",
                      sizeBytes: bytes.length,
                      width: 160,
                      height: 80,
                    },
                    relativeUrl: `/api/assets/objects/${"c".repeat(64)}/${input.preview ? "preview" : "original"}`,
                    expiresAt: 0,
                    imageDimensions: { width: 160, height: 80 },
                  }),
                );
                return true;
              });
              const handle = mate.handle;
              mate.handle = (request) => {
                if (!request.url.pathname.includes("/api/assets/objects/")) return handle(request);
                // Focusing the opener deliberately warms its original, independently of streaming.
                if (request.url.pathname.endsWith("/preview")) previewReads++;
                return Promise.resolve({ bytes, headers: { "content-type": "image/png" } });
              };
            });
            yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            const wire = chat.fixture();
            wire.history("Watch the assistant picture", "stream");
            wire.run("stream", "running");
            yield* s.given.signedIn;
            yield* chat.when.open("Ada", "Watch the assistant picture");
            let text = "![assistant picture](/tmp/assistant.png)\n\n[Docs](#docs)";
            wire.message("illustration", role, text, "stream", { streaming: true });
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
            const initialReads = previewReads;
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
                text += `\n\nMore assistant words ${index}-${delta}`;
                wire.message("illustration", role, text, "stream", { streaming: true });
                yield* chat.then.text(`More assistant words ${index}-${delta}`);
                expect(
                  yield* Effect.promise(() =>
                    s.page.evaluate((focused) => document.activeElement === focused, focused),
                  ),
                ).toBe(true);
              }
            }
            text = text.replace(
              "![assistant picture](/tmp/assistant.png)",
              "![assistant picture](/tmp/assistant.png)\n---",
            );
            wire.message("illustration", role, text, "stream", { streaming: true });
            yield* Effect.promise(() =>
              s.page.waitForFunction(() =>
                Boolean(
                  document.querySelector(
                    ".run-slot h4 img[data-image-src], .run-slot h2 img[data-image-src]",
                  ),
                ),
              ),
            );
            wire.message("illustration", role, text, "stream", { streaming: false });
            wire.tool(
              "later",
              "tool.started",
              { kind: "execute", command: "printf later-0" },
              "stream",
            );
            for (let update = 0; update < 24; update++) {
              wire.tool(
                "later",
                "tool.updated",
                { kind: "execute", command: `printf later-${update}` },
                "stream",
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
            expect(previewReads).toBe(initialReads);
            yield* s.then.noExternalNetwork;
          }),
      );
    }
    it.effect("a steering picture lands intact while the turn continues", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
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
        let reads = 0;
        s.drivers.onMate.push((mate) => {
          Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
          Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
          mate.rpcHandlers.unshift((request, socket) => {
            if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
            mate.reply(
              socket,
              request.id,
              encode({
                representation: {
                  digest: "d".repeat(64),
                  relativeUrl: `/api/assets/objects/${"d".repeat(64)}/preview`,
                  mimeType: "image/png",
                  sizeBytes: bytes.length,
                  width: 160,
                  height: 80,
                },
                relativeUrl: `/api/assets/objects/${"d".repeat(64)}/preview`,
                expiresAt: 0,
                imageDimensions: { width: 160, height: 80 },
              }),
            );
            return true;
          });
          const handle = mate.handle;
          mate.handle = (request) => {
            if (!request.url.pathname.includes("/api/assets/objects/")) return handle(request);
            reads++;
            return Promise.resolve({ bytes, headers: { "content-type": "image/png" } });
          };
        });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history("Watch the steering picture", "stream");
        wire.run("stream", "running");
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Watch the steering picture");
        wire.tool(
          "earlier",
          "tool.completed",
          { kind: "execute", command: "printf earlier-work" },
          "stream",
        );
        yield* chat.then.text("printf earlier-work");
        // A message steered into the run is drawn once, above its card: its picture there.
        wire.message("steering", "user", "Use this steering picture", "stream", {
          attachments: [
            {
              type: "image",
              id: "steering-picture",
              name: "steering.png",
              mimeType: "image/png",
              sizeBytes: bytes.length,
              width: 160,
              height: 80,
            },
          ],
        });
        yield* Effect.promise(() =>
          s.page.waitForFunction(() => {
            const image = document.querySelector<HTMLImageElement>(
              '[data-message-role="user"] img[data-image-src]',
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
              '[data-message-role="user"] img[data-image-src]',
            )!;
            const src = image.src;
            const failures = new Set<string>();
            let running = true;
            const sample = () => {
              const current = document.querySelector<HTMLImageElement>(
                `img[data-image-src="${image.dataset.imageSrc}"]`,
              );
              if (
                !current ||
                current.naturalWidth !== 160 ||
                current.closest("[data-image-pending]")
              )
                failures.add("undecoded pixels");
              if (current?.src !== src) failures.add("src changed");
              for (let node: Element | null = current; node; node = node.parentElement) {
                if (Number(getComputedStyle(node).opacity) < 1)
                  failures.add(`faded by ${node.className} (${getComputedStyle(node).opacity})`);
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
        const initialReads = reads;
        wire.tool(
          "later",
          "tool.started",
          { kind: "execute", command: "printf later-0" },
          "stream",
        );
        for (let update = 0; update < 24; update++) {
          wire.tool(
            "later",
            "tool.updated",
            { kind: "execute", command: `printf later-${update}` },
            "stream",
          );
          yield* chat.then.text(`printf later-${update}`);
        }
        yield* Effect.promise(() =>
          s.page.waitForFunction(() =>
            Boolean(document.querySelector('[data-message-role="user"] img[data-image-src]')),
          ),
        );
        expect(
          yield* Effect.promise(() =>
            s.page.evaluate(
              (held) => ({
                sameSrc:
                  document.querySelector<HTMLImageElement>(
                    '[data-message-role="user"] img[data-image-src]',
                  )?.src === held.src,
                failures: held.finish(),
              }),
              held,
            ),
          ),
        ).toEqual({ sameSrc: true, failures: [] });
        expect(reads).toBe(initialReads);
        yield* s.then.noExternalNetwork;
      }),
    );
    it.effect(
      "messages appear before image bytes, reserve their size, and reuse previews on reopen",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          const encoded = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = 160;
              canvas.height = 80;
              canvas.getContext("2d")!.fillRect(0, 0, 160, 80);
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          );
          const bytes = Buffer.from(encoded, "base64");
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          yield* Effect.addFinalizer(() => Effect.sync(release));
          let originalStarted!: () => void;
          const originalRequested = new Promise<void>((resolve) => {
            originalStarted = resolve;
          });
          let releaseOriginal!: () => void;
          const originalHeld = new Promise<void>((resolve) => {
            releaseOriginal = resolve;
          });
          yield* Effect.addFinalizer(() => Effect.sync(releaseOriginal));
          const originalEncoded = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = 320;
              const context = canvas.getContext("2d")!;
              context.fillStyle = "red";
              context.fillRect(0, 0, 640, 320);
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          );
          const originalBytes = Buffer.from(originalEncoded, "base64");
          const requests: string[] = [];
          let transferred = 0;
          s.drivers.onMate.push((mate) => {
            if (mate.name !== "Ada") return;
            Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
            Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
            mate.rpcHandlers.unshift((request, socket) => {
              if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
              const input = decode(request.payload);
              if (input.resource._tag !== "attachment") return false;
              mate.reply(
                socket,
                request.id,
                encode({
                  relativeUrl: `/api/assets/objects/${"a".repeat(64)}/${input.preview ? "preview" : "original"}`,
                  expiresAt: 0,
                  imageDimensions: { width: 640, height: 320 },
                }),
              );
              return true;
            });
            const handle = mate.handle;
            mate.handle = async (request) => {
              if (!request.url.pathname.includes("/api/assets/objects/")) return handle(request);
              requests.push(request.url.pathname);
              if (request.url.pathname.endsWith("/original")) {
                originalStarted();
                await originalHeld;
              }
              await held;
              const body = request.url.pathname.endsWith("/original") ? originalBytes : bytes;
              transferred += body.length;
              return {
                bytes: body,
                headers: {
                  "content-type": "image/png",
                  "cache-control": "private, max-age=31536000, immutable",
                },
              };
            };
          });
          yield* s.given.project("Ada", { mate: true });
          yield* s.given.project("Bea", { mate: true });
          const chat = mateChat(s);
          chat.fixture("Bea").history("Bea history");
          chat
            .fixture()
            .message(
              "pictures",
              "user",
              "[Picture 1]\n\nWords below the picture are readable",
              null,
              {
                attachments: [
                  {
                    type: "image",
                    id: "shot",
                    name: "shot.png",
                    mimeType: "image/png",
                    sizeBytes: bytes.length,
                    width: 640,
                    height: 320,
                  },
                ],
              },
            );
          chat
            .fixture()
            .message("code-path", "assistant", "[summary.ts](/workspace/src/summary.ts)", null);
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "Words below the picture are readable");
          const pending = yield* Effect.promise(async () => {
            await s.page.waitForSelector(picture, { timeout: 8000 });
            return s.page.$eval(picture, (image) => {
              const rect = image.getBoundingClientRect();
              const frame = image.closest(".asset-image-frame")!.getBoundingClientRect();
              const css = getComputedStyle(image);
              return {
                width: rect.width,
                height: rect.height,
                frameWidth: frame.width,
                frameHeight: frame.height,
                hidden: css.visibility === "hidden" || Number(css.opacity) === 0,
              };
            });
          });
          expect(transferred).toBe(0);
          expect(
            pending.frameHeight,
            "ASSERTION: pending picture reserves its source aspect ratio",
          ).toBeGreaterThan(32);
          expect(
            Math.abs(pending.frameWidth / pending.frameHeight - 2),
            "ASSERTION: pending picture reserves its source aspect ratio",
          ).toBeLessThan(0.05);
          expect(
            pending.width,
            "ASSERTION: pending picture reserves visible width",
          ).toBeGreaterThan(32);
          expect(
            pending.height,
            "ASSERTION: pending picture reserves its source aspect ratio",
          ).toBeGreaterThan(32);
          expect(
            Math.abs(pending.width / pending.height - 2),
            "ASSERTION: pending picture reserves its source aspect ratio",
          ).toBeLessThan(0.05);
          release();
          yield* Effect.promise(() =>
            s.page
              .waitForFunction(
                () => {
                  const image = document.querySelector<HTMLImageElement>(
                    ".message-picture-open img",
                  );
                  return (
                    image?.naturalWidth === 160 &&
                    getComputedStyle(image).visibility !== "hidden" &&
                    Number(getComputedStyle(image).opacity) === 1
                  );
                },
                { timeout: 8000 },
              )
              .catch(async (cause) => {
                throw new Error(
                  JSON.stringify({
                    requests,
                    transferred,
                    images: await s.page.$$eval("img[data-image-src]", (nodes) =>
                      nodes.map((image) => ({
                        src: image.getAttribute("src"),
                        width: (image as HTMLImageElement).naturalWidth,
                        style: image.getAttribute("style"),
                        rect: image.getBoundingClientRect().toJSON(),
                      })),
                    ),
                  }),
                  { cause },
                );
              }),
          );
          const loaded = yield* Effect.promise(() =>
            s.page.$eval(picture, (image) => ({
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
            })),
          );
          yield* Effect.promise(async () => {
            const link = await s.page.waitForSelector('[data-markdown-copy*="summary.ts"]', {
              timeout: 8000,
            });
            await link!.hover();
            await s.page.waitForSelector('[data-slot="tooltip-popup"]');
            const font = await s.page.$eval('[data-slot="tooltip-popup"]', (tooltip) => {
              const probe = document.createElement("span");
              probe.style.fontFamily = "var(--font-mono)";
              tooltip.appendChild(probe);
              const expected = getComputedStyle(probe).fontFamily;
              probe.remove();
              return {
                actual: getComputedStyle(tooltip).fontFamily,
                expected,
                text: tooltip.textContent,
              };
            });
            expect(font.text, "ASSERTION: file tooltip shows the source path").toContain(
              "summary.ts",
            );
            expect(font.actual, "ASSERTION: file path tooltip uses the code font role").toBe(
              font.expected,
            );
            await s.page.mouse.move(0, 0);
          });
          const first = { requests: requests.length, bytes: transferred };
          yield* chat.when.open("Bea", "Bea history");
          yield* chat.when.open("Ada", "Words below the picture are readable");
          yield* Effect.promise(() =>
            s.page.waitForFunction(
              () =>
                document.querySelector<HTMLImageElement>(".message-picture-open img")
                  ?.naturalWidth === 160,
            ),
          );
          const second = {
            requests: requests.length - first.requests,
            bytes: transferred - first.bytes,
          };
          yield* Effect.log("Image measurement", { pending, loaded, first, second });
          expect(requests.every((path) => path.endsWith("/preview"))).toBe(true);
          expect(pending.hidden).toBe(true);
          expect(
            Math.abs(loaded.width - pending.width),
            "ASSERTION: decoding preserves picture reservation",
          ).toBeLessThanOrEqual(4);
          expect(
            Math.abs(loaded.height - pending.height),
            "ASSERTION: decoding preserves picture reservation",
          ).toBeLessThanOrEqual(4);
          expect(second).toEqual({ requests: 0, bytes: 0 });
          const opener = yield* Effect.promise(() =>
            s.page.$('button[aria-label="Open picture 1"]'),
          );
          yield* Effect.promise(() => opener!.hover());
          yield* Effect.promise(() => originalRequested);
          expect(requests.some((path) => path.endsWith("/original"))).toBe(true);
          yield* Effect.promise(() => opener!.click());
          yield* Effect.promise(() => s.page.waitForSelector('[role="dialog"] [role="region"]'));
          const viewerBox = yield* Effect.promise(() =>
            s.page.$eval('[role="dialog"] [role="region"]', (n) => ({
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
            })),
          );
          expectBoxWithinHalfPixel(viewerBox, { width: 640, height: 320 });
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => {
              const preview = document.querySelector<HTMLImageElement>(
                '[role="dialog"] .asset-image-underlay',
              );
              return (
                preview?.naturalWidth === 160 && Number(getComputedStyle(preview).opacity) === 1
              );
            }),
          );
          releaseOriginal();
          yield* Effect.promise(() =>
            s.page.waitForFunction(() => {
              const original = document.querySelector<HTMLImageElement>(
                '[role="dialog"] img[data-image-src]',
              );
              return (
                original?.naturalWidth === 640 && Number(getComputedStyle(original).opacity) === 1
              );
            }),
          );
          const decodedBox = yield* Effect.promise(() =>
            s.page.$eval('[role="dialog"] [role="region"]', (n) => ({
              width: n.getBoundingClientRect().width,
              height: n.getBoundingClientRect().height,
            })),
          );
          expectBoxWithinHalfPixel(decodedBox, viewerBox);
          yield* Effect.promise(() => s.page.waitForSelector("a[download]"));
          expect(new Set(requests.filter((path) => path.endsWith("/original"))).size).toBe(1);
          yield* s.then.noExternalNetwork;
        }),
    );
    it.effect(
      "result screenshots fill their reserved boxes and permanent missing files have no retry",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
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
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          yield* Effect.addFinalizer(() => Effect.sync(release));
          const paths: string[] = [];
          s.drivers.onMate.push((mate) => {
            Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
            Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
            mate.rpcHandlers.unshift((request, socket) => {
              if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
              const input = decode(request.payload);
              if (input.resource._tag !== "workspace-file") return false;
              const missing = input.resource.path.includes("source-missing");
              mate.reply(
                socket,
                request.id,
                encode({
                  relativeUrl: `/api/assets/objects/${"b".repeat(64)}/preview`,
                  expiresAt: 0,
                  imageDimensions: { width: 640, height: 400 },
                  ...(missing
                    ? {
                        occurrence: {
                          id: "missing",
                          threadId: mate.thread.id,
                          ownerId: "read-gone",
                          name: "gone.png",
                          provenance: "capture" as const,
                          original: { status: "failed" as const, code: "source-missing" as const },
                        },
                      }
                    : {}),
                }),
              );
              return true;
            });
            const handle = mate.handle;
            mate.handle = async (request) => {
              if (!request.url.pathname.includes("/api/assets/objects/")) return handle(request);
              paths.push(request.url.pathname);
              await held;
              return { bytes, headers: { "content-type": "image/png" } };
            };
          });
          yield* s.given.project("Ada", { mate: true });
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history("Screenshot report", "run-one");
          wire.tool(
            "read-kept",
            "tool.completed",
            {
              toolName: "Read",
              input: { file_path: "/tmp/shot.png" },
              imagePath: "mate-asset:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            },
            "run-one",
            { itemType: "image_view" },
          );
          wire.tool(
            "read-gone",
            "tool.completed",
            {
              toolName: "Read",
              input: { file_path: "/tmp/gone.png" },
              imagePath: "mate-asset:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:source-missing",
            },
            "run-one",
            { itemType: "image_view" },
          );
          wire.message("answer", "assistant", "The screenshots are in the result", "run-one");
          wire.run("run-one", "completed", null, "answer");
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "The screenshots are in the result");
          yield* Effect.promise(() => s.page.waitForSelector("[data-result-picture] img"));
          yield* Effect.promise(() =>
            s.page.$eval("[data-result-picture] img", (image) =>
              image.scrollIntoView({ block: "center" }),
            ),
          );
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
          expect(paths.every((path) => path.endsWith("/preview"))).toBe(true);
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
        }),
    );
  });
});
