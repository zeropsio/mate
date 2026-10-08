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
