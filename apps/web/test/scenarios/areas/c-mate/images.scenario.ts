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
                : "4";
            mate.reply(
              socket,
              request.id,
              encode({
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
            requests.push(request.url.pathname);
            return Promise.resolve({ bytes, headers: { "content-type": "image/png" } });
          };
        });
        yield* s.given.project("Ada", { mate: true });
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.history("Earlier work", "earlier");
        wire.tool(
          "earlier-command",
          "tool.completed",
          { toolName: "Bash", command: "printf earlier", rawOutput: { content: "Earlier output" } },
          "earlier",
        );
        wire.run("earlier", "completed");
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
        yield* s.given.signedIn;
        yield* chat.when.open("Ada", "Watch these pictures while you work");
        wire.tool("work-image", "tool.completed", work, "stream", { itemType: "image_view" });
        yield* Effect.promise(() =>
          s.page
            .waitForFunction(
              () => {
                const images = [
                  ...document.querySelectorAll<HTMLImageElement>("img[data-image-src]"),
                ];
                return (
                  images.length === 4 &&
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
              for (const { image, src, width, height } of held) {
                if (!image.isConnected) violations.add(`${image.alt}: replaced`);
                if (image.src !== src) violations.add(`${image.alt}: src changed`);
                if (
                  image.getBoundingClientRect().width !== width ||
                  image.getBoundingClientRect().height !== height
                )
                  violations.add(`${image.alt}: size changed`);
                for (let node: Element | null = image; node !== null; node = node.parentElement) {
                  const style = getComputedStyle(node);
                  if (Number(style.opacity) < 1) violations.add(`${image.alt}: faded`);
                  const box = node.getBoundingClientRect();
                  const picture = image.getBoundingClientRect();
                  if (
                    (style.clipPath !== "none" ||
                      ["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) &&
                    (picture.top < box.top - 1 || picture.bottom > box.bottom + 1)
                  ) {
                    violations.add(`${image.alt}: clipped by ${node.className}`);
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
        const samples: unknown[] = [];
        wire.tool(
          "progress",
          "tool.started",
          { command: "printf work-update-0", kind: "execute" },
          "stream",
        );
        for (let update = 0; update < 24; update++) {
          wire.tool(
            "progress",
            "tool.updated",
            {
              kind: "execute",
              command: `printf work-update-${update}`,
              rawOutput: { content: `Work update ${update}` },
            },
            "stream",
          );
          yield* chat.then.text(`printf work-update-${update}`);
          if (update === 8) yield* chat.when.activate("Show work");
          if (update === 16) yield* chat.when.activate("Hide work");
          const images = yield* Effect.promise(() =>
            s.page.evaluate(
              (watched) =>
                watched.held.map((held) => {
                  const image = document.querySelector<HTMLImageElement>(
                    `img[data-image-src="${held.image.dataset.imageSrc}"]`,
                  );
                  return {
                    sameNode: image === held.image,
                    sameSrc: image?.src === held.src,
                    decoded:
                      image?.naturalWidth === 160 && Number(getComputedStyle(image).opacity) === 1,
                    sameSize:
                      image?.getBoundingClientRect().width === held.width &&
                      image?.getBoundingClientRect().height === held.height,
                  };
                }),
              watched,
            ),
          );
          samples.push(images);
        }
        expect(samples).toEqual(
          Array.from({ length: 24 }, () =>
            Array.from({ length: 4 }, () => ({
              sameNode: true,
              sameSrc: true,
              decoded: true,
              sameSize: true,
            })),
          ),
        );
        expect(requests.length).toBe(initialRequests);
        const film = yield* Effect.promise(() =>
          s.page.evaluate((watched) => watched.finish(), watched),
        );
        expect(film.frames).toBeGreaterThan(0);
        expect(film.violations).toEqual([]);
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
          yield* s.given.signedIn;
          yield* chat.when.open("Ada", "Words below the picture are readable");
          const pending = yield* Effect.promise(async () => {
            await s.page.waitForSelector(picture, { timeout: 8000 });
            return s.page.$eval(picture, (image) => {
              const rect = image.getBoundingClientRect();
              const css = getComputedStyle(image);
              return {
                width: rect.width,
                height: rect.height,
                hidden: css.visibility === "hidden" || Number(css.opacity) === 0,
              };
            });
          });
          expect(transferred).toBe(0);
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
          expect(loaded).toEqual({ width: pending.width, height: pending.height });
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
          expect(viewerBox).toEqual({ width: 640, height: 320 });
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
          expect(decodedBox).toEqual(viewerBox);
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
          expect(pending.imageHeight).toBe(pending.height);
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
          expect(loaded).toEqual(pending);
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
          expect(gone).toEqual({
            text: "Image no longer available",
            retry: false,
            height: pending.height,
            surfaceHeight: pending.height,
          });
        }),
    );
  });
});
