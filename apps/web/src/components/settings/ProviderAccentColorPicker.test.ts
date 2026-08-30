import { FALLBACK_PROVIDER_ACCENT } from "@t3tools/shared/brand";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";

describe("ProviderAccentColorPicker", () => {
  const renderPicker = (value: string | undefined) =>
    renderToStaticMarkup(
      createElement(ProviderAccentColorPicker, {
        displayName: "Codex",
        value,
        onCommit: () => {},
      }),
    );

  it("renders the shared fallback without an accent and preserves a persisted accent", () => {
    expect(renderPicker(undefined)).toContain(`background-color:${FALLBACK_PROVIDER_ACCENT}`);
    expect(renderPicker("#2563eb")).toContain("background-color:#2563eb");
  });
});
