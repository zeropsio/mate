import { describe, expect, it } from "vite-plus/test";

import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_SIDEBAR_MIN_WIDTH,
} from "./threadSidebarWidth";

describe("resolveInitialThreadSidebarWidth", () => {
  // 304 px by default: at 256 both of a row's lines cut at about 25
  // characters (M13, D7). A width the person stored stays theirs.
  it.each([
    { name: "nothing stored: the default", stored: null, viewport: 1786, width: 304 },
    { name: "the owner's stored 435 stays", stored: 435, viewport: 1786, width: 435 },
    { name: "a stored 256 stays", stored: 256, viewport: 1786, width: 256 },
    {
      name: "a stored width under the minimum rises to it",
      stored: 150,
      viewport: 1786,
      width: THREAD_SIDEBAR_MIN_WIDTH,
    },
    {
      name: "a narrow window caps the default, leaving the conversation its room",
      stored: null,
      viewport: 900,
      width: resolveThreadSidebarMaximumWidth(900),
    },
  ])("$name", ({ stored, viewport, width }) => {
    expect(resolveInitialThreadSidebarWidth(stored, viewport)).toBe(width);
  });
});
