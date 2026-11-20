import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { classifyBlob } from "./dataBlob.ts";

const blob = (
  bytes: string,
  contentType: string,
  sent: Partial<ZeropsDataConsoleBlob> = {},
): ZeropsDataConsoleBlob => ({
  data: btoa(bytes),
  contentType,
  truncated: false,
  size: bytes.length,
  vector: false,
  streamMetadata: false,
  ...sent,
});

// witness: packages/client-runtime/src/zerops/dataBlob.ts | "image/avif", → "image/avif", "image/svg+xml",
it("ZV120: An SVG blob is shown as inert text, never as an image, and a truncated image is never rendered", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  expect(classifyBlob(blob(svg, "image/svg+xml"))).toMatchObject({ kind: "text", text: svg });

  const pngHead = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  expect(classifyBlob(blob(pngHead, "image/png", { truncated: true, size: 2048 })).kind).not.toBe(
    "image",
  );
});
