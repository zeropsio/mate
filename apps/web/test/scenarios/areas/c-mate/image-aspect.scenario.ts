import { describe, expect, it } from "@effect/vitest";
import { AssetCreateUrlInput, AssetCreateUrlResult, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { mateChat } from "./dsl.ts";
import { installArea } from "./fake.ts";

const shapes = [
  { name: "small", width: 160, height: 80 },
  { name: "wide", width: 1200, height: 300 },
  { name: "tall", width: 300, height: 1200 },
  { name: "square", width: 640, height: 640 },
];

describe("C: image viewer proportions", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const shape of shapes) {
      it.effect(
        `the ${shape.name} picture keeps its natural proportions before and after zoom and resizing`,
        () =>
          Effect.gen(function* () {
            // Decision: restore correct proportions; no test weakened.
            const s = yield* createScenario([installArea]);
            yield* Effect.promise(() => s.page.setViewport({ width: 1786, height: 1000 }));
            const bytes = Buffer.from(
              yield* Effect.promise(() =>
                s.page.evaluate(({ width, height }) => {
                  const canvas = document.createElement("canvas");
                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext("2d")!;
                  ctx.fillStyle = "#ffffff";
                  ctx.fillRect(0, 0, width, height);
                  ctx.fillStyle = "#e66432";
                  ctx.beginPath();
                  ctx.arc(width / 2, height / 2, Math.min(width, height) / 3, 0, 2 * Math.PI);
                  ctx.fill();
                  ctx.fillStyle = "#000000";
                  ctx.font = "16px sans-serif";
                  ctx.fillText("Picture proportions", 4, 20);
                  return canvas.toDataURL("image/png").split(",")[1]!;
                }, shape),
              ),
              "base64",
            );
            s.drivers.onMate.push((mate) => {
              Object.assign(mate.descriptor.capabilities!, { contentAddressedImages: true });
              Object.assign(mate.config.environment.capabilities, { contentAddressedImages: true });
              mate.rpcHandlers.unshift((request, socket) => {
                if (request.tag !== WS_METHODS.assetsCreateUrl) return false;
                const input = Schema.decodeUnknownSync(AssetCreateUrlInput)(request.payload);
                const relativeUrl = `/api/assets/objects/${"a".repeat(64)}/${input.preview ? "preview" : "original"}`;
                mate.reply(
                  socket,
                  request.id,
                  Schema.encodeSync(AssetCreateUrlResult)({
                    representation: {
                      digest: "a".repeat(64),
                      relativeUrl,
                      mimeType: "image/png",
                      sizeBytes: bytes.length,
                      width: shape.width,
                      height: shape.height,
                    },
                    relativeUrl,
                    expiresAt: 0,
                    imageDimensions: { width: shape.width, height: shape.height },
                  }),
                );
                return true;
              });
              const handle = mate.handle;
              mate.handle = (request) =>
                request.url.pathname.includes("/api/assets/objects/")
                  ? Promise.resolve({ bytes, headers: { "content-type": "image/png" } })
                  : handle(request);
            });
            yield* s.given.project("Ada", { mate: true });
            const chat = mateChat(s);
            chat.fixture().message("picture", "user", "[Picture 1]\nCheck proportions", "turn", {
              attachments: [
                {
                  type: "image",
                  id: "picture",
                  name: `${shape.name}.png`,
                  mimeType: "image/png",
                  sizeBytes: bytes.length,
                  width: shape.width,
                  height: shape.height,
                },
              ],
            });
            yield* s.given.signedIn;
            yield* chat.when.open("Ada", "Check proportions");
            yield* Effect.promise(async () => {
              await s.page.click('button[aria-label="Open picture 1"]');
              await s.page
                .waitForFunction(
                  () => {
                    const image = document.querySelector<HTMLImageElement>(
                      '[role="dialog"] img[data-image-src]',
                    );
                    return (
                      image && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1"
                    );
                  },
                  { timeout: 8000 },
                )
                .catch(async (cause) => {
                  throw new Error(
                    JSON.stringify(
                      await s.page.evaluate(() => ({
                        text: document.body.innerText,
                        images: [...document.querySelectorAll("img")].map((image) => ({
                          src: image.src,
                          width: image.naturalWidth,
                          opacity: getComputedStyle(image).opacity,
                        })),
                      })),
                    ),
                    { cause },
                  );
                });
              for (const viewport of [
                { width: 1786, height: 1000 },
                { width: 390, height: 844 },
              ]) {
                if (viewport.width === 390) {
                  await s.page.setViewport(viewport);
                  await s.page.waitForFunction(
                    () =>
                      document.querySelector('[role="dialog"] [aria-live]')?.textContent ===
                      "100% zoom",
                    { timeout: 8000 },
                  );
                }
                await s.page.focus('[role="dialog"] [role="region"]');
                for (const [key, zoom] of [
                  ["0", 100],
                  ["Enter", 200],
                  ["+", 300],
                  ["+", 450],
                  ["+", 675],
                  ["+", 800],
                ] as const) {
                  await s.page.keyboard.press(key);
                  await s.page
                    .waitForFunction(
                      (zoom) =>
                        document.querySelector('[role="dialog"] [aria-live]')?.textContent ===
                        `${zoom}% zoom`,
                      { timeout: 8000 },
                      zoom,
                    )
                    .catch(async (cause) => {
                      throw new Error(
                        `Zoom ${zoom}: ${await s.page.$eval('[role="dialog"]', (node) => node.textContent)}`,
                        { cause },
                      );
                    });
                  const geometry = await s.page.$eval(
                    '[role="dialog"] img[data-image-src]',
                    (node) => {
                      const image = node as HTMLImageElement;
                      const box = image.getBoundingClientRect();
                      return {
                        width: box.width,
                        height: box.height,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                      };
                    },
                  );
                  if (
                    process.env.MATE_IMAGE_ASPECT_EVIDENCE &&
                    shape.name === "small" &&
                    viewport.width === 390 &&
                    zoom === 300
                  ) {
                    await s.page.screenshot({
                      path: `${process.env.MATE_IMAGE_ASPECT_EVIDENCE}.png`,
                    });
                  }
                  expect(geometry.naturalWidth).toBe(shape.width);
                  expect(geometry.naturalHeight).toBe(shape.height);
                  expect(geometry.width).toBeGreaterThan(0);
                  expect(
                    Math.abs(geometry.width / geometry.height / (shape.width / shape.height) - 1),
                    `ASSERTION: ${shape.name} picture preserves its natural aspect ratio within 1% at ${zoom}% zoom in ${viewport.width}x${viewport.height}`,
                  ).toBeLessThanOrEqual(0.01);
                }
              }
              await s.page.keyboard.press("Escape");
              await s.page.waitForSelector('[role="dialog"]', { hidden: true });
            });
            yield* s.then.noExternalNetwork;
          }),
      );
    }
  });
});
