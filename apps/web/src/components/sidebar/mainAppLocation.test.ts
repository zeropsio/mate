import { describe, expect, it } from "vite-plus/test";

import { isSidebarUtilityPage } from "./mainAppLocation";

describe("isSidebarUtilityPage", () => {
  it.each([
    ["/settings", true],
    ["/settings/general", true],
    ["/settings/zerops", true],
    ["/projects/abc", true],
    ["/projects/abc/", true],
    ["/usage", true],
    ["/", false],
    ["/zerops", false],
    ["/zerops/new", false],
    ["/settingsx", false],
    ["/projects/abc/threads", false],
    ["/group/g1/p1", false],
  ])("%s -> %s", (pathname, expected) => {
    expect(isSidebarUtilityPage(pathname)).toBe(expected);
  });
});
