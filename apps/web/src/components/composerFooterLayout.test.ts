import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldUseCompactComposerPrimaryActions,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(
      shouldUseCompactComposerPrimaryActions(
        COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1,
        { hasWideActions: true },
      ),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });

  it("stays full without wide actions or a measured width", () => {
    expect(shouldUseCompactComposerPrimaryActions(320)).toBe(false);
    expect(shouldUseCompactComposerPrimaryActions(null, { hasWideActions: true })).toBe(false);
  });
});
