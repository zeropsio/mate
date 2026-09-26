import { describe, expect, it } from "vite-plus/test";

import { checkPicture, keepFrame, KEPT_FRAME_LIMIT } from "./keptFrames";

describe("keptFrames", () => {
  it.each([
    {
      case: "the Mate's own screenshot first",
      check: { key: "c1", screenshot: { src: "data:shot" } },
      kept: "data:frame",
      picture: "data:shot",
    },
    {
      case: "else the last frame the person watched",
      check: { key: "c2" },
      kept: "data:frame",
      picture: "data:frame",
    },
    { case: "else nothing", check: { key: "c3" }, kept: null, picture: undefined },
  ])("$case", ({ check, kept, picture }) => {
    if (kept !== null) keepFrame(check.key, kept);
    expect(checkPicture(check)).toBe(picture);
  });

  it("keeps the newest frame of a check, and only the most recent checks", () => {
    keepFrame("old", "data:first");
    keepFrame("old", "data:second");
    expect(checkPicture({ key: "old" })).toBe("data:second");
    for (let index = 0; index < KEPT_FRAME_LIMIT; index += 1) keepFrame(`k${index}`, "data:x");
    expect(checkPicture({ key: "old" })).toBeUndefined();
    expect(checkPicture({ key: `k${KEPT_FRAME_LIMIT - 1}` })).toBe("data:x");
  });
});
