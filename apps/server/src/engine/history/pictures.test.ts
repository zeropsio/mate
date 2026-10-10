// @effect-diagnostics nodeBuiltinImport:off - the store's objects are files in a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";

import { contentAssetsAt } from "../../assets/ContentAssets.ts";
import { keepPictures } from "./pictures.ts";

const thread = ThreadId.make("thread-main");
const PNG = "iVBORw0KGgo".repeat(40);
const bodiesWith = (images: ReadonlyArray<unknown>) => ({
  messages: new Map(),
  activities: new Map([
    [
      "a-1",
      {
        kind: "tool.completed",
        summary: "Browser",
        payload: { data: { zerops: { toolName: "zerops_browser", images } } },
      },
    ],
  ]),
});
const zeropsOf = (bodies: Awaited<ReturnType<typeof keepPictures>>) =>
  (bodies.activities.get("a-1")!.payload as { data: { zerops: Record<string, unknown> } }).data
    .zerops;
const store = () =>
  contentAssetsAt(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "history-pictures-")));

describe("a V1 call's inline pictures", () => {
  it("become the store's references, the same picture of the same call one reference", async () => {
    const assets = store();
    const kept = await keepPictures(
      assets,
      thread,
      bodiesWith([{ mimeType: "image/png", data: PNG }]),
    );
    const again = await keepPictures(
      assets,
      thread,
      bodiesWith([{ mimeType: "image/png", data: PNG }]),
    );
    expect(zeropsOf(kept)).toEqual({
      toolName: "zerops_browser",
      images: [
        {
          mimeType: "image/png",
          asset: expect.objectContaining({
            threadId: thread,
            ownerId: "a-1",
            provenance: "capture",
            original: expect.objectContaining({ status: "ready" }),
          }),
        },
      ],
    });
    expect(zeropsOf(again)).toEqual(zeropsOf(kept));
  });

  it("that V1 already kept by reference stay as they are", async () => {
    const reference = { mimeType: "image/png", asset: { id: "kept-before" }, width: 2, height: 1 };
    const kept = await keepPictures(store(), thread, bodiesWith([reference]));
    expect(zeropsOf(kept)).toEqual({ toolName: "zerops_browser", images: [reference] });
  });

  it.each([
    ["over the store's limit", store(), 10],
    ["with no store to keep it", null, undefined],
  ] as const)("are left out %s, the result saying so", async (_name, assets, limit) => {
    const kept = await keepPictures(
      assets,
      thread,
      bodiesWith([{ mimeType: "image/png", data: PNG }]),
      limit,
    );
    expect(zeropsOf(kept)).toEqual({ toolName: "zerops_browser", images: [], imagesDropped: true });
  });
});

// Rhea, 2026-10-10: its V1 run's result strip read "Image unavailable" six times after the import.
// The run had looked at pictures in /tmp; V1 kept each as its snapshot was read (its backfill),
// never in the payload, and the import copied the payload's /tmp path, long gone.
describe("a picture a V1 call looked at", () => {
  const read = (path: string) => ({
    messages: new Map(),
    activities: new Map([
      [
        "a-read",
        {
          kind: "tool.completed",
          summary: "Read",
          payload: {
            itemType: "dynamic_tool_call",
            status: "completed",
            title: "Read",
            detail: path,
            data: { toolName: "Read", input: { file_path: path } },
          },
        },
      ],
    ]),
  });
  const imagePathOf = (bodies: Awaited<ReturnType<typeof keepPictures>>) =>
    (bodies.activities.get("a-read")!.payload as { data: { imagePath?: string } }).data.imagePath;
  const picture = () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "history-looked-"));
    const path = NodePath.join(directory, "h0.png");
    NodeFS.writeFileSync(
      path,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    return path;
  };

  it("a run imported from V1 keeps its result pictures: the one V1 kept, though the file is gone", async () => {
    const assets = store();
    const path = picture();
    // V1 kept it as a snapshot of the thread was read, while the file was there.
    const kept = await assets.legacy([thread, "a-read", path], () =>
      assets.ingestFile(path, {
        threadId: thread,
        ownerId: "a-read",
        provenance: "capture",
        name: "h0.png",
      }),
    );
    NodeFS.rmSync(path);
    const imported = await keepPictures(assets, thread, read(path));
    expect(imagePathOf(imported)).toBe(`mate-asset:${kept.id}`);
  });

  it.each([
    { name: "still there, kept now", gone: false, refused: false },
    { name: "gone and never kept, a picture no longer there", gone: true, refused: true },
  ])("a run imported from V1 keeps its result pictures: $name", async ({ gone, refused }) => {
    const path = picture();
    if (gone) NodeFS.rmSync(path);
    const imported = await keepPictures(store(), thread, read(path));
    expect(imagePathOf(imported)).toMatch(
      refused ? /^mate-asset:[a-f0-9-]{36}:source-missing$/u : /^mate-asset:[a-f0-9-]{36}$/u,
    );
  });
});
