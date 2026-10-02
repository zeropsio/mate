import type { AttachmentLink } from "@t3tools/shared/hqChanges";
import { describe, expect, it, vi } from "vite-plus/test";

import { hqPictureSource } from "./useChangePicture";

const HQ = "https://hq.example.test";
const PICTURE = `${HQ}/api/apps/g1/changes/appdev/2/attachments/a1b2c3`;

describe("hqPictureSource: a change's pictures, read from the official HQ as the person", () => {
  it("reads a change's picture through HQ's API", async () => {
    const asked: Array<AttachmentLink> = [];
    const blob = new Blob(["png"], { type: "image/png" });
    const source = hqPictureSource({
      address: HQ,
      api: {
        changeAttachment: async (link) => {
          asked.push(link);
          return blob;
        },
      },
    });
    expect(await source.read(PICTURE)).toBe(blob);
    expect(asked).toEqual([{ appId: "g1", repo: "appdev", number: 2, id: "a1b2c3" }]);
  });

  it("reads nothing that is not a change's picture at that HQ", async () => {
    const changeAttachment = vi.fn();
    const source = hqPictureSource({ address: HQ, api: { changeAttachment } });
    await expect(source.read("https://pictures.example/cat.png")).rejects.toThrow();
    await expect(source.read(`${HQ}/changes/g1/appdev/2`)).rejects.toThrow();
    expect(changeAttachment).not.toHaveBeenCalled();
  });
});
