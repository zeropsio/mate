import { describe, expect, it } from "vite-plus/test";
import {
  hqPictureFamily,
  pictureId,
  pictureLink,
  pictureOwner,
  pictureScope,
} from "./hqPicture.ts";

const link = { appId: "app", repo: "team/web:main", number: 7, id: "picture" };
describe("HQ picture identity", () => {
  it("keeps account organization and attachment identity separate from repository delimiters", () => {
    expect(pictureLink(pictureOwner(link))).toEqual(link);
    expect(pictureId({ orgId: "one", link })).not.toBe(pictureId({ orgId: "two", link }));
    expect(pictureScope({ orgId: "one", link })).toContain(pictureOwner(link));
    expect(hqPictureFamily.sampled!.path({ orgId: "one", ownerId: pictureOwner(link) })).toBe(
      "/api/apps/app/changes/team/web:main/7/attachments/picture",
    );
  });
  it.each(["not json", "null", "[]", '["app","repo",0,"id"]', '["app","repo",1.5,"id"]'])(
    "rejects malformed demand %s",
    (owner) => expect(pictureLink(owner)).toBeNull(),
  );
  it.each([null, {}, "bytes"])("rejects non-binary answers %j", (raw) => {
    expect(hqPictureFamily.sampled!.decode(raw)).toBeNull();
  });
});
