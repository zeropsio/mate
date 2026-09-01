import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
  resolveConnectedComposerPlaceholder,
  ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
} from "./composerPlaceholder";

describe("resolveConnectedComposerPlaceholder", () => {
  it("uses plain task language for a connected Zerops project", () => {
    expect(resolveConnectedComposerPlaceholder({ zeropsAvailable: true })).toBe(
      ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
    );
    expect(ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER).toBe(
      "Describe what you want to build or change…",
    );
  });

  it("keeps the generic connected fallback elsewhere", () => {
    expect(resolveConnectedComposerPlaceholder({ zeropsAvailable: false })).toBe(
      DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
    );
  });
});
