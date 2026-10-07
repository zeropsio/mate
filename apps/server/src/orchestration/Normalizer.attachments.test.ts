// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ClientOrchestrationCommand,
  CommandId,
  ApprovalRequestId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { PICTURE_MAX_BYTES } from "@t3tools/shared/composerPictures";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as JpegJs from "jpeg-js";
import { PNG } from "pngjs";
import { vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { ContentAssetError, contentAssetsAt } from "../assets/ContentAssets.ts";
import { cleanupFailedUploadedAttachments, normalizeDispatchCommand } from "./Normalizer.ts";

const testLayer = Layer.mergeAll(
  WorkspacePaths.layer,
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-normalizer-attachments-" }),
).pipe(Layer.provideMerge(NodeServices.layer));

const attachmentUuid = "00000000-0000-4000-8000-0000000000aa";
const isClientCommand = Schema.is(ClientOrchestrationCommand);

function encodePng(width: number, height: number, data: Uint8Array): Buffer {
  const png = Object.assign(new PNG(), { width, height, data: Buffer.from(data.buffer) });
  return PNG.sync.write(png, { colorType: 2 });
}

/**
 * A random colour in every pixel: about 3 bytes a pixel as a PNG and 2 as a
 * JPEG, so at 1500×1000 the PNG is over the byte limit and its JPEG under it.
 */
function noisePng(width: number, height: number): Buffer {
  let state = 1;
  const data = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data.set([state, state >>> 8, state >>> 16, 255], offset);
  }
  return encodePng(width, height, data);
}

/** A smooth gradient: a few kilobytes at any size. */
function gradient(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set([(x * 255) / width, (y * 255) / height, 128, 255], (y * width + x) * 4);
    }
  }
  return data;
}

/** A PNG header naming 10,000×10,000 pixels, more than a picture may have to be opened. */
function hugePngHeader(): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  bytes.writeUInt32BE(10_000, 16);
  bytes.writeUInt32BE(10_000, 20);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

function turnStartCommand(input: {
  readonly threadId?: string;
  readonly attachments: ReadonlyArray<
    (
      | { readonly id: string; readonly sizeBytes: number }
      | { readonly dataUrl: string; readonly sizeBytes: number }
    ) & {
      readonly name?: string;
      readonly mimeType?: string;
      readonly sourceAttachmentId?: string;
    }
  >;
}): ClientOrchestrationCommand {
  return {
    type: "thread.turn.start",
    commandId: CommandId.make("command-1"),
    threadId: ThreadId.make(input.threadId ?? "thread-1"),
    message: {
      messageId: MessageId.make("message-1"),
      role: "user",
      text: "look at this",
      attachments: input.attachments.map((attachment) => ({
        type: "image" as const,
        name: "screenshot.png",
        mimeType: "image/png",
        ...attachment,
      })),
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("normalizeDispatchCommand attachments", () => {
  it.effect("keeps the uploaded original name when the displayed image was transformed", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = encodePng(1, 1, new Uint8Array([0, 0, 255, 255]));
      const id = `pending-${attachmentUuid}`;
      const sourceAttachmentId = "pending-00000000-0000-4000-8000-0000000000bb";
      const sourcePath = NodePath.join(config.attachmentsDir, `${sourceAttachmentId}.png`);
      NodeFS.writeFileSync(sourcePath, bytes);
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.png`), bytes);
      yield* Effect.promise(() =>
        contentAssetsAt(config.stateDir).upload(sourceAttachmentId, sourcePath, {
          threadId: ThreadId.make("pending"),
          ownerId: sourceAttachmentId,
          name: "original.png",
          mimeType: "image/png",
          provenance: "upload",
        }),
      );
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { id, sourceAttachmentId, name: "fitted.png", sizeBytes: bytes.byteLength },
          ],
        }),
      );
      if (normalized.type !== "thread.turn.start") throw new Error("Wrong command");
      expect(normalized.message.attachments?.[0]).toMatchObject({
        name: "fitted.png",
        sourceAsset: {
          name: "original.png",
          original: { digest: NodeCrypto.hash("sha256", bytes) },
        },
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect.each([
    { code: "storage-full" as const, message: "Storage full" },
    { code: "persistence-failed" as const, message: "The original image could not be retained." },
  ])("refuses an original claim with its actual storage result: $code", ({ code, message }) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = encodePng(1, 1, new Uint8Array([0, 0, 255, 255]));
      const id = `pending-${attachmentUuid}`;
      const sourceAttachmentId = "pending-00000000-0000-4000-8000-0000000000bb";
      for (const pending of [id, sourceAttachmentId])
        NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${pending}.png`), bytes);
      const claim = vi
        .spyOn(contentAssetsAt(config.stateDir), "claim")
        .mockRejectedValueOnce(new ContentAssetError(code));
      yield* Effect.gen(function* () {
        const refused = yield* normalizeDispatchCommand(
          turnStartCommand({
            attachments: [{ id, sourceAttachmentId, sizeBytes: bytes.byteLength }],
          }),
        ).pipe(Effect.flip);
        expect(refused.message).toBe(message);
        expect(claim).toHaveBeenCalledOnce();
      }).pipe(Effect.ensuring(Effect.sync(() => claim.mockRestore())));
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("accepts 100 inline images and rejects 101 before writing files", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const attachments = Array.from({ length: 100 }, () => ({
        dataUrl: "data:image/png;base64,cGl4ZWxz",
        sizeBytes: 6,
      }));
      const rejected = yield* normalizeDispatchCommand(
        turnStartCommand({ attachments: [...attachments, attachments[0]!] }),
      ).pipe(Effect.flip);
      expect(rejected.message).toContain("up to 100");
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([]);
      const accepted = yield* normalizeDispatchCommand(turnStartCommand({ attachments }));
      if (accepted.type !== "thread.turn.start") throw new Error("Wrong command");
      expect(accepted.message.attachments).toHaveLength(100);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toHaveLength(100);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects decoded image overflow before writing it and removes earlier files", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      let writtenBytes = 0;
      const dataUrl = `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024).toString("base64")}`;
      const command = turnStartCommand({
        attachments: [
          ...Array.from({ length: 8 }, () => ({ dataUrl, sizeBytes: 1 })),
          { dataUrl: "data:image/png;base64,YQ==", sizeBytes: 0 },
        ],
      });
      const error = yield* normalizeDispatchCommand(command).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          writeFile: (path, data, options) => {
            writtenBytes += data.byteLength;
            return fileSystem.writeFile(path, data, options);
          },
        }),
        Effect.flip,
      );
      expect(error.message).toContain("80 MiB");
      expect(writtenBytes).toBe(80 * 1024 * 1024);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("preserves inline image attachments from existing mobile clients", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 }],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      expect(attachment.id.startsWith("thread-1-")).toBe(true);
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${attachment.id}.png`)),
      ).toEqual(Buffer.from("pixels"));
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("claims uploaded attachments while retaining a retryable pending copy", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = Buffer.from("pixels");
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, bytes);

      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachmentId = normalized.message.attachments[0]!.id;
      expect(attachmentId.startsWith("thread-1-")).toBe(true);
      expect(attachmentId).not.toBe(`thread-1-${attachmentUuid}`);
      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      const claimedPngPath = NodePath.join(config.attachmentsDir, `${attachmentId}.png`);
      expect(NodeFS.existsSync(claimedPngPath)).toBe(true);
      // A copy, not a hard link: editing the delivered file must not mutate
      // the retryable pending upload.
      expect(NodeFS.statSync(claimedPngPath).ino).not.toBe(NodeFS.statSync(pendingPath).ino);
      expect(NodeFS.readFileSync(claimedPngPath)).toEqual(bytes);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("normalizes inline and uploaded attachments in the same turn", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        Buffer.from("pixels"),
      );

      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 },
            { id: `pending-${attachmentUuid}`, sizeBytes: 6 },
          ],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      expect(normalized.message.attachments).toHaveLength(2);
      expect(normalized.message.attachments[1]?.id.startsWith("thread-1-")).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("claims uploaded documents without changing their original extension", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingId = `pending-${attachmentUuid}-pdf`;
      const pendingPath = NodePath.join(config.attachmentsDir, `${pendingId}.pdf`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("report"));

      const imageCommand = turnStartCommand({ attachments: [] });
      if (imageCommand.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      const normalized = yield* normalizeDispatchCommand({
        ...imageCommand,
        message: {
          ...imageCommand.message,
          attachments: [
            {
              type: "file",
              id: pendingId,
              name: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 6,
            },
          ],
        },
      });
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      expect(attachment.type).toBe("file");
      expect(attachment.id).toMatch(/^thread-1-.*-pdf$/);
      const claimedPath = NodePath.join(config.attachmentsDir, `${attachment.id}.pdf`);
      expect(NodeFS.readFileSync(claimedPath)).toEqual(Buffer.from("report"));
      expect(NodeFS.statSync(claimedPath).ino).not.toBe(NodeFS.statSync(pendingPath).ino);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("retries a failed bootstrap with a fresh thread id", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const bytes = Buffer.from("pixels");
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        bytes,
      );

      const first = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (first.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      NodeFS.rmSync(
        NodePath.join(config.attachmentsDir, `${first.message.attachments[0]!.id}.png`),
      );

      const retried = yield* normalizeDispatchCommand(
        turnStartCommand({
          threadId: "thread-retry",
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: bytes.byteLength }],
        }),
      );
      if (retried.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      expect(retried.message.attachments[0]?.id.startsWith("thread-retry-")).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes failed attachment claims without deleting their pending uploads", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [
          { dataUrl: "data:image/png;base64,cGl4ZWxz", sizeBytes: 6 },
          { id: `pending-${attachmentUuid}`, sizeBytes: 6 },
        ],
      });
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const inlinePath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[0]!.id}.png`,
      );
      const claimedPath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[1]!.id}.png`,
      );
      yield* cleanupFailedUploadedAttachments(command, normalized);

      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      expect(NodeFS.existsSync(claimedPath)).toBe(false);
      expect(NodeFS.existsSync(inlinePath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes a failed claimed copy after its pending original was removed", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const claimedPath = NodePath.join(
        config.attachmentsDir,
        `${normalized.message.attachments[0]!.id}.png`,
      );
      NodeFS.rmSync(pendingPath);

      yield* cleanupFailedUploadedAttachments(command, normalized);

      expect(NodeFS.existsSync(claimedPath)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps concurrent claims independent when one dispatch fails", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));
      const command = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });

      const [failed, succeeded] = yield* Effect.all(
        [normalizeDispatchCommand(command), normalizeDispatchCommand(command)],
        { concurrency: 2 },
      );
      if (failed.type !== "thread.turn.start" || succeeded.type !== "thread.turn.start") {
        throw new Error("Expected thread.turn.start commands.");
      }

      const failedPath = NodePath.join(
        config.attachmentsDir,
        `${failed.message.attachments[0]!.id}.png`,
      );
      const succeededPath = NodePath.join(
        config.attachmentsDir,
        `${succeeded.message.attachments[0]!.id}.png`,
      );
      expect(failedPath).not.toBe(succeededPath);

      yield* cleanupFailedUploadedAttachments(command, failed);

      expect(NodeFS.existsSync(pendingPath)).toBe(true);
      expect(NodeFS.existsSync(failedPath)).toBe(false);
      expect(NodeFS.existsSync(succeededPath)).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes earlier claimed copies when a later attachment cannot be normalized", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const pendingId = `pending-${attachmentUuid}`;
      const pendingPath = NodePath.join(config.attachmentsDir, `${pendingId}.png`);
      NodeFS.writeFileSync(pendingPath, Buffer.from("pixels"));

      const failure = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { id: pendingId, sizeBytes: 6 },
            {
              id: "pending-00000000-0000-4000-8000-0000000000ff",
              sizeBytes: 6,
            },
          ],
        }),
      ).pipe(Effect.flip);

      expect(failure.message).toContain("not found");
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`${pendingId}.png`]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects uploaded attachments with the wrong size or thread", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      NodeFS.writeFileSync(
        NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
        Buffer.from("pixels"),
      );

      const wrongSize = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 999 }],
        }),
      ).pipe(Effect.flip);
      expect(wrongSize.message).toContain("size");

      const wrongThread = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [{ id: `another-thread-${attachmentUuid}`, sizeBytes: 6 }],
        }),
      ).pipe(Effect.flip);
      expect(wrongThread.message).toContain("pending upload");

      const mismatchedTypeCommand = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: 6 }],
      });
      if (mismatchedTypeCommand.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      const mismatchedType = yield* normalizeDispatchCommand({
        ...mismatchedTypeCommand,
        message: {
          ...mismatchedTypeCommand.message,
          attachments: mismatchedTypeCommand.message.attachments.map((attachment) => ({
            ...attachment,
            mimeType: "image/jpeg",
          })),
        },
      }).pipe(Effect.flip);
      expect(mismatchedType.message).toContain("attachment type");
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("normalizeDispatchCommand picture fitting", () => {
  it.effect("stores an oversize uploaded PNG as the JPEG it fits as", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const original = noisePng(1500, 1000);
      expect(original.byteLength).toBeGreaterThan(PICTURE_MAX_BYTES);
      const pendingPath = NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`);
      NodeFS.writeFileSync(pendingPath, original);
      const command = turnStartCommand({
        attachments: [{ id: `pending-${attachmentUuid}`, sizeBytes: original.byteLength }],
      });

      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      expect(attachment.id.startsWith("thread-1-")).toBe(true);
      const fitted = NodeFS.readFileSync(
        NodePath.join(config.attachmentsDir, `${attachment.id}.jpg`),
      );
      expect(attachment).toEqual({
        asset: expect.objectContaining({
          original: expect.objectContaining({
            status: "ready",
            digest: NodeCrypto.hash("sha256", original),
            sizeBytes: original.byteLength,
            mimeType: "image/png",
            width: 1500,
            height: 1000,
          }),
        }),
        type: "image",
        id: attachment.id,
        name: "screenshot.jpg",
        mimeType: "image/jpeg",
        sizeBytes: fitted.byteLength,
        width: 1500,
        height: 1000,
      });
      expect(fitted.byteLength).toBeLessThanOrEqual(PICTURE_MAX_BYTES);
      expect(JpegJs.decode(fitted, { useTArray: true })).toMatchObject({
        width: 1500,
        height: 1000,
      });
      expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${attachment.id}.png`))).toBe(
        false,
      );
      expect(NodeFS.readFileSync(pendingPath).equals(original)).toBe(true);
      const retained = yield* Effect.promise(() =>
        contentAssetsAt(config.stateDir).object(NodeCrypto.hash("sha256", original)),
      );
      expect(NodeFS.readFileSync(retained.path)).toEqual(original);

      yield* cleanupFailedUploadedAttachments(command, normalized);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`pending-${attachmentUuid}.png`]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fits an oversize inline JPEG from an older mobile client", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const photo = JpegJs.encode(
        { width: 2400, height: 1800, data: gradient(2400, 1800) },
        90,
      ).data;
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            {
              name: "IMG_0412.jpg",
              mimeType: "image/jpeg",
              dataUrl: `data:image/jpeg;base64,${photo.toString("base64")}`,
              sizeBytes: photo.byteLength,
            },
          ],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      const fitted = NodeFS.readFileSync(
        NodePath.join(config.attachmentsDir, `${attachment.id}.jpg`),
      );
      expect(attachment).toEqual({
        asset: expect.objectContaining({
          original: expect.objectContaining({
            status: "ready",
            digest: NodeCrypto.hash("sha256", photo),
            sizeBytes: photo.byteLength,
            mimeType: "image/jpeg",
            width: 2400,
            height: 1800,
          }),
        }),
        type: "image",
        id: attachment.id,
        name: "IMG_0412.jpg",
        mimeType: "image/jpeg",
        sizeBytes: fitted.byteLength,
        width: 2000,
        height: 1500,
      });
      expect(JpegJs.decode(fitted, { useTArray: true })).toMatchObject({
        width: 2000,
        height: 1500,
      });
      const retained = yield* Effect.promise(() =>
        contentAssetsAt(config.stateDir).object(NodeCrypto.hash("sha256", photo)),
      );
      expect(NodeFS.readFileSync(retained.path)).toEqual(photo);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("fits a picture while the server's own thread goes on", () =>
    Effect.gen(function* () {
      const photo = JpegJs.encode(
        { width: 2400, height: 1800, data: gradient(2400, 1800) },
        90,
      ).data;
      const pauses: number[] = [];
      let last = yield* Clock.currentTimeMillis;
      const tick = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        pauses.push(now - last);
        last = now;
      });
      const ticker = yield* Effect.forkChild(tick.pipe(Effect.repeat(Schedule.spaced("5 millis"))));
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            {
              name: "IMG_0412.jpg",
              mimeType: "image/jpeg",
              dataUrl: `data:image/jpeg;base64,${photo.toString("base64")}`,
              sizeBytes: photo.byteLength,
            },
          ],
        }),
      ).pipe(Effect.ensuring(Fiber.interrupt(ticker)));
      yield* tick;

      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }
      expect(normalized.message.attachments[0]).toMatchObject({ width: 2000, height: 1500 });
      // Fitting this photo takes a few hundred milliseconds of work.
      expect(Math.max(...pauses)).toBeLessThan(100);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect.each([
    { label: "an upload", upload: true },
    { label: "an inline picture", upload: false },
  ])("leaves a picture within the limits byte for byte: $label", ({ upload }) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const picture = encodePng(1200, 800, gradient(1200, 800));
      if (upload) {
        NodeFS.writeFileSync(
          NodePath.join(config.attachmentsDir, `pending-${attachmentUuid}.png`),
          picture,
        );
      }
      const normalized = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            upload
              ? { id: `pending-${attachmentUuid}`, sizeBytes: picture.byteLength }
              : {
                  dataUrl: `data:image/png;base64,${picture.toString("base64")}`,
                  sizeBytes: picture.byteLength,
                },
          ],
        }),
      );
      if (normalized.type !== "thread.turn.start") {
        throw new Error("Expected a thread.turn.start command.");
      }

      const attachment = normalized.message.attachments[0]!;
      expect(attachment).toMatchObject({
        name: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: picture.byteLength,
        width: 1200,
        height: 800,
      });
      expect(
        NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${attachment.id}.png`)),
      ).toEqual(picture);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("refuses a picture too big to open and keeps no copy it made", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fittedId = `pending-${attachmentUuid}`;
      const hugeId = "pending-00000000-0000-4000-8000-0000000000bb";
      const oversize = noisePng(1500, 1000);
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${fittedId}.png`), oversize);
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${hugeId}.png`), hugePngHeader());

      const failure = yield* normalizeDispatchCommand(
        turnStartCommand({
          attachments: [
            { id: fittedId, sizeBytes: oversize.byteLength },
            { id: hugeId, name: "IMG_0412.png", sizeBytes: 33 },
          ],
        }),
      ).pipe(Effect.flip);

      expect(failure.message).toBe(
        "Picture 'IMG_0412.png' is too large to send even after shrinking it. Send a smaller copy.",
      );
      expect(NodeFS.readdirSync(config.attachmentsDir).toSorted()).toEqual(
        [`${fittedId}.png`, `${hugeId}.png`].toSorted(),
      );
    }).pipe(Effect.provide(testLayer)),
  );
});

describe("question attachments", () => {
  it.effect("fits an oversize picture answering a question", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const id = `pending-${attachmentUuid}`;
      const picture = encodePng(2400, 1200, gradient(2400, 1200));
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.png`), picture);
      const command: ClientOrchestrationCommand = {
        type: "thread.user-input.respond",
        commandId: CommandId.make("answer"),
        threadId: ThreadId.make("thread-1"),
        requestId: ApprovalRequestId.make("request"),
        answers: { q1: "" },
        createdAt: "2026-08-01T00:00:00.000Z",
        attachmentsByQuestionId: {
          q1: [
            {
              type: "image",
              id,
              name: "board.png",
              mimeType: "image/png",
              sizeBytes: picture.byteLength,
            },
          ],
        },
      };

      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.user-input.respond") throw new Error("Wrong command");

      const attachment = normalized.attachmentsByQuestionId!.q1![0]!;
      const fittedPath = NodePath.join(config.attachmentsDir, `${attachment.id}.png`);
      const fitted = PNG.sync.read(NodeFS.readFileSync(fittedPath));
      expect([fitted.width, fitted.height]).toEqual([2000, 1000]);
      expect(attachment).toMatchObject({
        name: "board.png",
        mimeType: "image/png",
        sizeBytes: NodeFS.statSync(fittedPath).size,
      });
      yield* cleanupFailedUploadedAttachments(command, normalized);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`${id}.png`]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("enforces the total response limit and claims duplicate filenames independently", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const id = `pending-${attachmentUuid}-txt`;
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.txt`), "report");
      const attachment = {
        type: "file" as const,
        id,
        name: 'notes "final" ü.txt',
        mimeType: "text/plain",
        sizeBytes: 6,
      };
      const command: ClientOrchestrationCommand = {
        type: "thread.user-input.respond",
        commandId: CommandId.make("answer-cap"),
        threadId: ThreadId.make("thread-1"),
        requestId: ApprovalRequestId.make("request-cap"),
        answers: { first: "", second: "" },
        createdAt: "2026-08-01T00:00:00.000Z",
        attachmentsByQuestionId: {
          first: Array.from({ length: 50 }, () => attachment),
          second: Array.from({ length: 51 }, () => attachment),
        },
      };
      const failure = yield* normalizeDispatchCommand(command).pipe(Effect.flip);
      expect(failure.message).toContain("up to 100");
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`${id}.txt`]);
      const accepted = {
        ...command,
        attachmentsByQuestionId: {
          ...command.attachmentsByQuestionId,
          second: Array.from({ length: 50 }, () => attachment),
        },
      };
      const normalized = yield* normalizeDispatchCommand(accepted);
      if (normalized.type !== "thread.user-input.respond") throw new Error("Wrong command");
      const attachments = Object.values(normalized.attachmentsByQuestionId!).flat();
      expect(attachments).toHaveLength(100);
      expect(new Set(attachments.map((item) => item.id)).size).toBe(100);
      for (const item of attachments) {
        expect(item.name).toBe(attachment.name);
        expect(
          NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${item.id}.txt`), "utf8"),
        ).toBe("report");
      }
      yield* cleanupFailedUploadedAttachments(accepted, normalized);
      expect(NodeFS.readdirSync(config.attachmentsDir)).toEqual([`${id}.txt`]);
    }).pipe(Effect.provide(testLayer)),
  );
  it("requires uploaded metadata for question images, including pasted images", () => {
    expect(
      isClientCommand({
        type: "thread.user-input.respond",
        commandId: "answer",
        threadId: "thread-1",
        requestId: "request",
        answers: { q: "" },
        createdAt: "2026-08-01T00:00:00.000Z",
        attachmentsByQuestionId: {
          q: [
            {
              type: "image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 6,
              dataUrl: "data:image/png;base64,cGl4ZWxz",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it.effect("preserves a __proto__ question key and cleans up its claimed files", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const id = `pending-${attachmentUuid}`;
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.png`), "pixels");
      const command: ClientOrchestrationCommand = {
        type: "thread.user-input.respond",
        commandId: CommandId.make("answer"),
        threadId: ThreadId.make("thread-1"),
        requestId: ApprovalRequestId.make("request"),
        answers: { ["__proto__"]: "" },
        createdAt: "2026-08-01T00:00:00.000Z",
        attachmentsByQuestionId: {
          ["__proto__"]: [
            { type: "image", id, name: "image.png", mimeType: "image/png", sizeBytes: 6 },
          ],
        },
      };
      const normalized = yield* normalizeDispatchCommand(command);
      if (normalized.type !== "thread.user-input.respond") throw new Error("Wrong command");
      expect(Object.keys(normalized.attachmentsByQuestionId!)).toEqual(["__proto__"]);
      const attachment = normalized.attachmentsByQuestionId!["__proto__"]![0]!;
      const claimedPath = NodePath.join(config.attachmentsDir, `${attachment.id}.png`);
      expect(NodeFS.existsSync(claimedPath)).toBe(true);
      yield* cleanupFailedUploadedAttachments(command, normalized);
      expect(NodeFS.existsSync(claimedPath)).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );
  it.effect(
    "claims images and files by question, preserves answers, and cleans up failed dispatches",
    () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const imageId = `pending-${attachmentUuid}`;
        const fileId = `pending-${attachmentUuid}-txt`;
        NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${imageId}.png`), "pixels");
        NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${fileId}.txt`), "report");
        const command: ClientOrchestrationCommand = {
          type: "thread.user-input.respond",
          commandId: CommandId.make("answer"),
          threadId: ThreadId.make("thread-1"),
          requestId: ApprovalRequestId.make("request"),
          answers: { q1: ["Selected option"], q2: "" },
          createdAt: "2026-08-01T00:00:00.000Z",
          attachmentsByQuestionId: {
            q1: [
              {
                type: "image",
                id: imageId,
                name: "image.png",
                mimeType: "image/png",
                sizeBytes: 6,
              },
            ],
            q2: [
              {
                type: "file",
                id: fileId,
                name: "report.txt",
                mimeType: "text/plain",
                sizeBytes: 6,
              },
            ],
          },
        };
        const normalized = yield* normalizeDispatchCommand(command);
        if (normalized.type !== "thread.user-input.respond") throw new Error("Wrong command");
        expect(normalized.answers).toEqual(command.answers);
        const image = normalized.attachmentsByQuestionId!.q1![0]!;
        const file = normalized.attachmentsByQuestionId!.q2![0]!;
        expect(
          NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${image.id}.png`), "utf8"),
        ).toBe("pixels");
        expect(
          NodeFS.readFileSync(NodePath.join(config.attachmentsDir, `${file.id}.txt`), "utf8"),
        ).toBe("report");
        yield* cleanupFailedUploadedAttachments(command, normalized);
        expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${image.id}.png`))).toBe(
          false,
        );
        expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${file.id}.txt`))).toBe(
          false,
        );
        expect(NodeFS.existsSync(NodePath.join(config.attachmentsDir, `${imageId}.png`))).toBe(
          true,
        );
        const retry = yield* normalizeDispatchCommand(command);
        expect(retry.type).toBe("thread.user-input.respond");
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes all claimed copies if a later question upload is missing", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const id = `pending-${attachmentUuid}`;
      NodeFS.writeFileSync(NodePath.join(config.attachmentsDir, `${id}.png`), "pixels");
      const result = yield* normalizeDispatchCommand({
        type: "thread.user-input.respond",
        commandId: CommandId.make("answer"),
        threadId: ThreadId.make("thread-1"),
        requestId: ApprovalRequestId.make("request"),
        answers: { q1: "", q2: "" },
        createdAt: "2026-08-01T00:00:00.000Z",
        attachmentsByQuestionId: {
          q1: [{ type: "image", id, name: "image.png", mimeType: "image/png", sizeBytes: 6 }],
          q2: [
            {
              type: "file",
              id: `${id}-txt`,
              name: "missing.txt",
              mimeType: "text/plain",
              sizeBytes: 6,
            },
          ],
        },
      }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(
        NodeFS.readdirSync(config.attachmentsDir).filter((name) => name.startsWith("thread-1-")),
      ).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
});
