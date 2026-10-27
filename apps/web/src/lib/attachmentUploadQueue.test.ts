import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Atom, AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";

import type { ComposerImageAttachment } from "../composerDraftStore";

const mocks = vi.hoisted(() => ({
  connectionStateAtom: vi.fn(),
  createUploadUrl: Symbol("create-upload-url"),
  removeUpload: Symbol("remove-upload"),
  runAtomCommand: vi.fn(),
  readPreparedConnection: vi.fn(),
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  runAtomCommand: mocks.runAtomCommand,
}));

vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});

vi.mock("../connection/catalog", () => ({
  environmentCatalog: { stateAtom: mocks.connectionStateAtom },
}));

vi.mock("../state/attachments", () => ({
  attachmentEnvironment: {
    createUploadUrl: mocks.createUploadUrl,
    remove: mocks.removeUpload,
  },
}));

vi.mock("../state/session", () => ({
  readPreparedConnection: mocks.readPreparedConnection,
}));

import {
  attachmentUploadKeys,
  awaitAttachmentUploads,
  getUploadedAttachments,
  pictureOriginalUploadKey,
  readAttachmentUpload,
  releaseAttachmentUpload,
  releaseAttachmentUploads,
  retryAttachmentUpload,
  retryFileUpload,
  startAttachmentUpload,
  startFileUpload,
  useAttachmentUploadStore,
} from "./attachmentUploadQueue";
import type { ComposerFileAttachment } from "./composerFiles";
import { attachmentUploadBlockReason } from "./attachmentUploadState";

type ProgressListener = (event: {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}) => void;

class TestXmlHttpRequest {
  static requests: TestXmlHttpRequest[] = [];

  status = 0;
  timeout = 0;
  method: string | null = null;
  url: string | null = null;
  readonly headers = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  progressListener: ProgressListener | null = null;

  readonly upload = {
    addEventListener: (_event: string, listener: ProgressListener) => {
      this.progressListener = listener;
    },
  };

  constructor() {
    TestXmlHttpRequest.requests.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, listener);
  }

  send(): void {}

  abort(): void {
    this.listeners.get("abort")?.();
  }

  progress(loaded: number, total: number): void {
    this.progressListener?.({ lengthComputable: true, loaded, total });
  }

  complete(status = 204): void {
    this.status = status;
    this.listeners.get("load")?.();
  }
}

const firstEnvironment = EnvironmentId.make("environment-1");
const secondEnvironment = EnvironmentId.make("environment-2");

function makeImage(id: string): ComposerImageAttachment {
  const file = new File([new Uint8Array([1, 2, 3])], `${id}.png`, { type: "image/png" });
  return {
    type: "image",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    previewUrl: `blob:${id}`,
    file,
  };
}

function makeFile(id: string, extra: Partial<ComposerFileAttachment> = {}): ComposerFileAttachment {
  const file = new File([new Uint8Array(5)], `${id}.pdf`, { type: "application/pdf" });
  return {
    type: "file",
    id,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    file,
    uploaded: null,
    ...extra,
  };
}

function makePicture(id: string, keepOriginal: boolean): ComposerImageAttachment {
  const source = new File([new Uint8Array(9)], "home-page.png", { type: "image/png" });
  return {
    ...makeImage(id),
    picture: {
      source,
      sourceWidth: 3024,
      sourceHeight: 1964,
      crop: { x: 0, y: 0, w: 3024, h: 1964 },
      marks: [],
      keepOriginal,
      width: 2000,
      height: 1299,
      asPasted: false,
      preparing: false,
    },
  };
}

const connectionStates = Atom.family((_environmentId: EnvironmentId) =>
  Atom.make(AsyncResult.success({ phase: "connected" })),
);

function setConnected(environmentId: EnvironmentId, connected: boolean) {
  appAtomRegistry.set(
    connectionStates(environmentId),
    AsyncResult.success({ phase: connected ? "connected" : "backoff" }),
  );
}

describe("attachmentUploadQueue", () => {
  beforeEach(() => {
    mocks.connectionStateAtom.mockImplementation(connectionStates);
    setConnected(firstEnvironment, true);
    setConnected(secondEnvironment, true);
    TestXmlHttpRequest.requests = [];
    mocks.runAtomCommand.mockReset();
    mocks.readPreparedConnection.mockReset();
    mocks.readPreparedConnection.mockReturnValue({ httpBaseUrl: "https://environment.test/" });
    mocks.runAtomCommand.mockImplementation(
      async (
        _registry: unknown,
        command: unknown,
        target: {
          readonly environmentId: EnvironmentId;
          readonly input: { readonly name?: string };
        },
      ) => {
        if (command === mocks.createUploadUrl) {
          const attachmentId = `pending-${target.environmentId}-${target.input.name}`;
          return {
            _tag: "Success",
            value: {
              attachmentId,
              relativeUrl: `/api/attachments/upload/${attachmentId}`,
              expiresAt: 1,
            },
          };
        }
        return { _tag: "Success", value: undefined };
      },
    );
    vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  });

  afterEach(() => {
    for (const imageId of Object.keys(useAttachmentUploadStore.getState().uploadsByImageId)) {
      releaseAttachmentUpload(imageId);
    }
    vi.unstubAllGlobals();
  });

  it.each([false, true])(
    "Storage full waits for its owner even across a reconnect: %s",
    async (lateFailure) => {
      const image = makeImage("full-reconnect");
      startAttachmentUpload({ environmentId: firstEnvironment, image });
      await Promise.resolve();
      const settled = awaitAttachmentUploads([image.id]);
      setConnected(firstEnvironment, false);
      if (lateFailure) setConnected(firstEnvironment, true);
      TestXmlHttpRequest.requests[0]!.complete(507);
      await settled;
      if (!lateFailure) setConnected(firstEnvironment, true);
      await Promise.resolve();
      await Promise.resolve();
      expect(TestXmlHttpRequest.requests).toHaveLength(1);
      expect(readAttachmentUpload(image.id)).toMatchObject({
        status: "failed",
        reason: "Storage full",
      });
    },
  );

  it.each([false, true])(
    "retries a failed file once after reconnect, including a late HTTP failure: %s",
    async (lateFailure) => {
      const image = makeImage("reconnect");
      startAttachmentUpload({ environmentId: firstEnvironment, image });
      await Promise.resolve();
      const firstSettled = awaitAttachmentUploads([image.id]);
      setConnected(firstEnvironment, false);
      if (lateFailure) setConnected(firstEnvironment, true);
      TestXmlHttpRequest.requests[0]!.complete(503);
      await firstSettled;
      if (!lateFailure) setConnected(firstEnvironment, true);
      await Promise.resolve();
      await Promise.resolve();
      expect(TestXmlHttpRequest.requests).toHaveLength(2);
      const retrySettled = awaitAttachmentUploads([image.id]);
      TestXmlHttpRequest.requests[1]!.complete(503);
      await retrySettled;
      setConnected(firstEnvironment, true);
      await Promise.resolve();
      expect(TestXmlHttpRequest.requests).toHaveLength(2);
      expect(readAttachmentUpload(image.id)?.status).toBe("failed");

      setConnected(firstEnvironment, false);
      setConnected(firstEnvironment, true);
      await Promise.resolve();
      await Promise.resolve();
      const finalSettled = awaitAttachmentUploads([image.id]);
      TestXmlHttpRequest.requests[2]!.complete();
      await finalSettled;
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [image] }),
      ).not.toBeNull();
      setConnected(firstEnvironment, false);
      setConnected(firstEnvironment, true);
      await Promise.resolve();
      expect(TestXmlHttpRequest.requests).toHaveLength(3);
    },
  );

  it("does not retry for another environment or after the attachment is removed", async () => {
    const image = makeImage("removed");
    startAttachmentUpload({ environmentId: firstEnvironment, image });
    await Promise.resolve();
    const settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[0]!.complete(503);
    await settled;
    setConnected(secondEnvironment, false);
    setConnected(secondEnvironment, true);
    await Promise.resolve();
    expect(TestXmlHttpRequest.requests).toHaveLength(1);
    setConnected(firstEnvironment, false);
    setConnected(firstEnvironment, true);
    releaseAttachmentUpload(image.id);
    await Promise.resolve();
    expect(TestXmlHttpRequest.requests).toHaveLength(1);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
  });

  it("uploads images immediately and sends attachment references", async () => {
    const image = makeImage("image-1");
    startAttachmentUpload({ environmentId: firstEnvironment, image });
    await Promise.resolve();

    const request = TestXmlHttpRequest.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      "https://environment.test/api/attachments/upload/pending-environment-1-image-1.png",
    );
    request.progress(1, 3);
    expect(readAttachmentUpload(image.id)).toMatchObject({ status: "uploading", progress: 1 / 3 });

    const settled = awaitAttachmentUploads([image.id]);
    request.complete();
    await settled;

    expect(getUploadedAttachments({ environmentId: firstEnvironment, images: [image] })).toEqual([
      {
        type: "image",
        id: "pending-environment-1-image-1.png",
        name: "image-1.png",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ]);

    releaseAttachmentUploads([image]);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      {
        environmentId: firstEnvironment,
        input: { attachmentId: "pending-environment-1-image-1.png" },
      },
      expect.anything(),
    );
  });

  it.each([500, 507])(
    "retains a rejected upload and its owner actions until an explicit retry: %s",
    async (status) => {
      const image = makeImage("image-retry");
      startAttachmentUpload({ environmentId: firstEnvironment, image });
      await Promise.resolve();

      let settled = awaitAttachmentUploads([image.id]);
      TestXmlHttpRequest.requests[0]!.complete(status);
      await settled;
      expect(readAttachmentUpload(image.id)).toMatchObject({
        status: "failed",
        reason: status === 507 ? "Storage full" : "Upload rejected (500)",
      });
      expect(
        attachmentUploadBlockReason({
          imageIds: [image.id],
          environmentId: firstEnvironment,
          uploadsByImageId: useAttachmentUploadStore.getState().uploadsByImageId,
        }),
      ).toBe(
        status === 507
          ? "Storage full. Retry or remove the failed image"
          : "Retry or remove the failed image",
      );
      expect(TestXmlHttpRequest.requests).toHaveLength(1);

      retryAttachmentUpload({ environmentId: firstEnvironment, image });
      await Promise.resolve();
      settled = awaitAttachmentUploads([image.id]);
      TestXmlHttpRequest.requests[1]!.complete();
      await settled;

      expect(readAttachmentUpload(image.id)).toMatchObject({ status: "ready" });
    },
  );

  it("releases an upload URL that resolves after its image was removed", async () => {
    const image = makeImage("image-cancelled");
    const minted = {
      _tag: "Success" as const,
      value: {
        attachmentId: "pending-environment-1-image-cancelled.png",
        relativeUrl: "/api/attachments/upload/cancelled",
        expiresAt: 1,
      },
    };
    let resolveMint: (result: typeof minted) => void = () => {};
    const pendingMint = new Promise<typeof minted>((resolve) => {
      resolveMint = resolve;
    });
    let resolveDelete: () => void = () => {};
    const deleted = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    mocks.runAtomCommand.mockImplementation((_registry: unknown, command: unknown) => {
      if (command === mocks.createUploadUrl) {
        return pendingMint;
      }
      resolveDelete();
      return Promise.resolve({ _tag: "Success", value: undefined });
    });

    startAttachmentUpload({ environmentId: firstEnvironment, image });
    releaseAttachmentUpload(image.id);
    resolveMint(minted);
    await deleted;

    expect(TestXmlHttpRequest.requests).toEqual([]);
    expect(readAttachmentUpload(image.id)).toBeUndefined();
    expect(mocks.runAtomCommand).toHaveBeenCalledWith(
      expect.anything(),
      mocks.removeUpload,
      {
        environmentId: firstEnvironment,
        input: { attachmentId: minted.value.attachmentId },
      },
      expect.anything(),
    );
  });

  it("restores the previous environment after a replacement upload fails", async () => {
    const image = makeImage("image-move");
    startAttachmentUpload({ environmentId: firstEnvironment, image });
    await Promise.resolve();
    let settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[0]!.complete();
    await settled;

    startAttachmentUpload({ environmentId: secondEnvironment, image });
    await Promise.resolve();
    settled = awaitAttachmentUploads([image.id]);
    TestXmlHttpRequest.requests[1]!.complete(500);
    await settled;

    startAttachmentUpload({ environmentId: firstEnvironment, image });
    expect(readAttachmentUpload(image.id)).toMatchObject({
      status: "ready",
      environmentId: firstEnvironment,
      attachmentId: "pending-environment-1-image-move.png",
    });
  });

  it("does not let stalled uploads block another environment", async () => {
    const images = ["image-a", "image-b", "image-c", "image-d"].map(makeImage);
    for (const image of images) {
      startAttachmentUpload({ environmentId: firstEnvironment, image });
    }
    const otherEnvironmentImage = makeImage("image-other");
    startAttachmentUpload({ environmentId: secondEnvironment, image: otherEnvironmentImage });
    await Promise.resolve();

    expect(TestXmlHttpRequest.requests).toHaveLength(4);
    const otherRequest = TestXmlHttpRequest.requests.find((request) =>
      request.url?.includes("environment-2"),
    );
    expect(otherRequest).toBeDefined();

    for (const request of TestXmlHttpRequest.requests) {
      request.complete();
    }
    await Promise.all([
      ...images.slice(0, 3).map((image) => awaitAttachmentUploads([image.id])),
      awaitAttachmentUploads([otherEnvironmentImage.id]),
    ]);
    await Promise.resolve();
    TestXmlHttpRequest.requests[4]!.complete();
    await awaitAttachmentUploads([images[3]!.id]);
  });

  describe("a picture's original", () => {
    it.each([
      ["a picture that keeps it uploads it too", true, ["pic", "pic~original"]],
      ["a picture always retains its exact source", false, ["pic", "pic~original"]],
    ])("%s", (_label, keepOriginal, keys) => {
      expect(attachmentUploadKeys(makePicture("pic", keepOriginal))).toEqual(keys);
    });

    it("goes as a file right after its picture, once both are up", async () => {
      const picture = makePicture("pic", true);
      startAttachmentUpload({ environmentId: firstEnvironment, image: picture });
      await Promise.resolve();
      expect(TestXmlHttpRequest.requests).toHaveLength(2);
      expect(mocks.runAtomCommand).toHaveBeenCalledWith(
        expect.anything(),
        mocks.createUploadUrl,
        {
          environmentId: firstEnvironment,
          input: { type: "file", name: "home-page.png", mimeType: "image/png", sizeBytes: 9 },
        },
        expect.anything(),
      );
      const settled = awaitAttachmentUploads([picture.id]);
      TestXmlHttpRequest.requests[0]!.complete();
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [picture] }),
      ).toBeNull();
      TestXmlHttpRequest.requests[1]!.complete();
      await settled;
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [picture] }),
      ).toEqual([
        {
          type: "image",
          id: "pending-environment-1-pic.png",
          sourceAttachmentId: "pending-environment-1-home-page.png",
          name: "pic.png",
          mimeType: "image/png",
          sizeBytes: 3,
          width: 2000,
          height: 1299,
        },
        {
          type: "file",
          id: "pending-environment-1-home-page.png",
          name: "home-page.png",
          mimeType: "image/png",
          sizeBytes: 9,
        },
      ]);
    });

    it("retains the source when the extra original attachment is disabled", async () => {
      startAttachmentUpload({ environmentId: firstEnvironment, image: makePicture("pic", true) });
      await Promise.resolve();
      startAttachmentUpload({ environmentId: firstEnvironment, image: makePicture("pic", false) });
      expect(readAttachmentUpload(pictureOriginalUploadKey("pic"))).toMatchObject({
        status: "uploading",
      });
      expect(readAttachmentUpload("pic")).toMatchObject({ status: "uploading" });
    });
  });

  describe("a file", () => {
    it("uploads as a file under its own id and goes ahead of the images", async () => {
      const image = makeImage("image-1");
      const file = makeFile("spec");
      startAttachmentUpload({ environmentId: firstEnvironment, image });
      startFileUpload({ environmentId: firstEnvironment, file });
      await Promise.resolve();
      expect(mocks.runAtomCommand).toHaveBeenCalledWith(
        expect.anything(),
        mocks.createUploadUrl,
        {
          environmentId: firstEnvironment,
          input: { type: "file", name: "spec.pdf", mimeType: "application/pdf", sizeBytes: 5 },
        },
        expect.anything(),
      );
      const settled = awaitAttachmentUploads([image.id, file.id]);
      TestXmlHttpRequest.requests[0]!.complete();
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [image], files: [file] }),
      ).toBeNull();
      TestXmlHttpRequest.requests[1]!.complete();
      await settled;
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [image], files: [file] }),
      ).toEqual([
        {
          type: "file",
          id: "pending-environment-1-spec.pdf",
          name: "spec.pdf",
          mimeType: "application/pdf",
          sizeBytes: 5,
        },
        {
          type: "image",
          id: "pending-environment-1-image-1.png",
          name: "image-1.png",
          mimeType: "image/png",
          sizeBytes: 3,
        },
      ]);
    });

    it("tries a failed upload again", async () => {
      const file = makeFile("retry");
      startFileUpload({ environmentId: firstEnvironment, file });
      await Promise.resolve();
      const failed = awaitAttachmentUploads([file.id]);
      TestXmlHttpRequest.requests[0]!.complete(500);
      await failed;
      expect(readAttachmentUpload(file.id)?.status).toBe("failed");
      // A message holding the failed file has nothing to send until it is up.
      expect(
        getUploadedAttachments({ environmentId: firstEnvironment, images: [], files: [file] }),
      ).toBeNull();
      retryFileUpload({ environmentId: firstEnvironment, file });
      await Promise.resolve();
      const settled = awaitAttachmentUploads([file.id]);
      TestXmlHttpRequest.requests[1]!.complete();
      await settled;
      expect(readAttachmentUpload(file.id)?.status).toBe("ready");
    });

    const HOUR_MS = 60 * 60 * 1000;
    it.each([
      ["in its own environment it stands uploaded", firstEnvironment, HOUR_MS, "ready"],
      ["in another it cannot go", secondEnvironment, HOUR_MS, "failed"],
      ["a day after its upload it expired", firstEnvironment, 24 * HOUR_MS, "failed"],
    ])("restored after a reload: %s", (_label, environmentId, ageMs, status) => {
      const file = makeFile("kept", {
        file: null,
        uploaded: {
          environmentId: firstEnvironment,
          attachmentId: "att-kept",
          uploadedAt: Date.now() - ageMs,
        },
      });
      startFileUpload({ environmentId, file });
      expect(TestXmlHttpRequest.requests).toHaveLength(0);
      expect(readAttachmentUpload(file.id)?.status).toBe(status);
      const upload = readAttachmentUpload(file.id);
      if (upload?.status === "failed") expect(upload.reason).toMatch(/attach the file again/iu);
      expect(
        getUploadedAttachments({ environmentId, images: [], files: [file] })?.[0]?.id ?? null,
      ).toBe(status === "ready" ? "att-kept" : null);
    });
  });
});
