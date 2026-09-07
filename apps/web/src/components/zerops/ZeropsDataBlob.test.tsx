import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

import { ZeropsDataBlob } from "./ZeropsDataBlob";

const blob = (overrides: Partial<ZeropsDataConsoleBlob> = {}): ZeropsDataConsoleBlob => ({
  data: "aGVsbG8=", // "hello"
  contentType: "text/plain",
  truncated: false,
  size: 5,
  vector: false,
  streamMetadata: false,
  ...overrides,
});

function render(value: ZeropsDataConsoleBlob): string {
  return renderToStaticMarkup(<ZeropsDataBlob blob={value} />);
}

describe("ZeropsDataBlob", () => {
  it("renders text content verbatim", () => {
    const html = render(blob());
    expect(html).toContain("hello");
    expect(html).toContain('data-zerops-data-blob-kind="text"');
  });

  it("pretty-prints JSON content", () => {
    const html = render(blob({ contentType: "application/json", data: btoa('{"a":1}') }));
    expect(html).toContain('data-zerops-data-blob-kind="json"');
    // renderToStaticMarkup HTML-escapes quotes; check for the pretty-printed shape instead.
    expect(html).toContain("&quot;a&quot;: 1");
  });

  it("falls back to plain text when the JSON body does not parse", () => {
    const html = render(blob({ contentType: "application/json", data: btoa("not json") }));
    expect(html).toContain('data-zerops-data-blob-kind="text"');
    expect(html).toContain("not json");
  });

  it("renders binary content as content type and size, not the bytes", () => {
    const html = render(blob({ contentType: "image/png" }));
    expect(html).toContain('data-zerops-data-blob-kind="binary"');
    expect(html).toContain("image/png");
    expect(html).toContain("5 bytes");
  });

  it("renders vector content as a note, not the vector itself", () => {
    const html = render(blob({ vector: true }));
    expect(html).toContain('data-zerops-data-blob-kind="vector"');
    expect(html).toContain("Vector data, not shown.");
  });

  it("renders stream metadata content as a note", () => {
    const html = render(blob({ streamMetadata: true }));
    expect(html).toContain('data-zerops-data-blob-kind="streamMetadata"');
    expect(html).toContain("Stream metadata.");
  });

  it("renders a too-large-for-preview blob as content type and size", () => {
    const big = "A".repeat(260 * 1024);
    const html = render(blob({ contentType: "text/plain", data: btoa(big), size: big.length }));
    expect(html).toContain('data-zerops-data-blob-kind="tooLargeForPreview"');
    expect(html).toContain("text/plain");
    expect(html).toContain(`${big.length.toLocaleString()} bytes`);
  });

  it("shows a truncated banner for a truncated text blob", () => {
    const html = render(blob({ truncated: true, size: 40 }));
    expect(html).toContain("data-zerops-data-blob-truncated");
    expect(html).toContain("40 bytes");
  });

  it("shows no truncated banner when the blob was not truncated", () => {
    const html = render(blob({ truncated: false }));
    expect(html).not.toContain("data-zerops-data-blob-truncated");
  });
});
