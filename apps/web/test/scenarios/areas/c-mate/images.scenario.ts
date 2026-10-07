import { describe, expect, it } from "@effect/vitest";
import { WS_METHODS, AssetCreateUrlInput, AssetCreateUrlResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installArea } from "./fake.ts";
import { mateChat } from "./dsl.ts";
const decode = Schema.decodeUnknownSync(AssetCreateUrlInput);
const encode = Schema.encodeSync(AssetCreateUrlResult);
const picture = ".message-picture-open img";
describe("C: conversation images", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "messages appear before image bytes, reserve their size, and reuse previews on reopen",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          const encoded = yield* Effect.promise(() =>
            s.page.evaluate(() => {
              const canvas = document.createElement("canvas");
              canvas.width = 640;
              canvas.height = 320;
              canvas.getContext("2d")!.fillRect(0, 0, 640, 320);
              return canvas.toDataURL("image/png").split(",")[1]!;
            }),
          );
          const bytes = Buffer.from(encoded, "base64");
          let release!: () => void;
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          yield* Effect.addFinalizer(() => Effect.sync(release));
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
              await held;
              transferred += bytes.length;
              return {
                bytes,
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
                    image?.naturalWidth === 640 &&
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
                  ?.naturalWidth === 640,
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
          yield* Effect.promise(() =>
            s.page.locator('button[aria-label="Open picture 1"]').click(),
          );
          yield* Effect.promise(() => s.page.waitForSelector("a[download]"));
          expect(new Set(requests.filter((path) => path.endsWith("/original"))).size).toBe(1);
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
