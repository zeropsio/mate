import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Chip } from "./Chip";

const TONES = [
  ["ok", "Ready"],
  ["busy", "Deploying"],
  ["attention", "Needs attention"],
  ["failed", "Deploy failed"],
  ["off", "Stopped"],
] as const;

describe("Chip", () => {
  it.each(TONES)("renders the %s status and visible phrase", (tone, label) => {
    const html = renderToStaticMarkup(<Chip label={label} tone={tone} />);

    expect(html.startsWith("<span")).toBe(true);
    expect(html).toContain(`data-zerops-chip-tone="${tone}"`);
    expect(html.endsWith(`>${label}</span>`)).toBe(true);
  });
});
