import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

import { ZeropsDataBlob } from "./ZeropsDataBlob";

const base64 = (input: Uint8Array | string): string => {
  const raw = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const blob = (overrides: Partial<ZeropsDataConsoleBlob> = {}): ZeropsDataConsoleBlob => ({
  data: base64("hello"),
  contentType: "text/plain",
  truncated: false,
  size: 5,
  vector: false,
  streamMetadata: false,
  ...overrides,
});

function render(value: ZeropsDataConsoleBlob, name?: string): string {
  return renderToStaticMarkup(<ZeropsDataBlob blob={value} name={name} />);
}

describe("ZeropsDataBlob", () => {
  it("renders text content verbatim under a meta line", () => {
    const html = render(blob());
    expect(html).toContain("hello");
    expect(html).toContain('data-zerops-data-blob-kind="text"');
    expect(html).toContain("text/plain · 5 bytes");
  });

  it("adds the humanized expiry to the meta line when the value has a ttl", () => {
    const html = render(blob({ data: base64("42"), size: 2, ttlSeconds: 82_800 }));
    expect(html).toContain("text/plain · 2 bytes · expires in 23 h");
  });

  it("labels an empty value instead of rendering nothing", () => {
    const html = render(blob({ data: "", size: 0 }));
    expect(html).toContain('data-zerops-data-blob-kind="empty"');
    expect(html).toContain("Empty value");
    expect(html).toContain("text/plain · 0 bytes");
  });

  it("pretty-prints JSON content", () => {
    const html = render(blob({ contentType: "application/json", data: base64('{"a":1}') }));
    expect(html).toContain('data-zerops-data-blob-kind="json"');
    // renderToStaticMarkup HTML-escapes quotes; check for the pretty-printed shape instead.
    expect(html).toContain("&quot;a&quot;: 1");
  });

  it("falls back to plain text when the JSON body does not parse", () => {
    const html = render(blob({ contentType: "application/json", data: base64("not json") }));
    expect(html).toContain('data-zerops-data-blob-kind="text"');
    expect(html).toContain("not json");
  });

  it("hex-dumps a payload that is not printable text", () => {
    const html = render(blob({ data: base64(new Uint8Array([0x00, 0xff, 0xfe])), size: 3 }));
    expect(html).toContain('data-zerops-data-blob-kind="hex"');
    expect(html).toContain("00 ff fe");
    expect(html).toContain("text/plain · 3 bytes");
  });

  it("counts the bytes a capped hex dump leaves out", () => {
    const raw = new Uint8Array(5000).fill(0x00);
    const html = render(blob({ data: base64(raw), size: 5000 }));
    expect(html).toContain("904 more bytes");
  });

  it("hex-dumps the head slice of a truncated binary object under the truncation line", () => {
    const raw = new Uint8Array(64).fill(0x00);
    const html = render(
      blob({
        contentType: "application/octet-stream",
        data: base64(raw),
        truncated: true,
        size: 300_000,
      }),
    );
    expect(html).toContain("data-zerops-data-blob-truncated");
    expect(html).toContain('data-zerops-data-blob-kind="hex"');
    expect(html).toContain("00000000");
  });

  it("renders an untruncated image from a data URI", () => {
    const data = base64(new Uint8Array([0x89, 0x50]));
    const html = render(blob({ contentType: "image/png", data, size: 75 }), "pic.png");
    expect(html).toContain('data-zerops-data-blob-kind="image"');
    expect(html).toContain(`src="data:image/png;base64,${data}"`);
    expect(html).toContain('alt="pic.png"');
    expect(html).toContain("image/png · 75 bytes");
  });

  it("falls back to a generic alt when the node has no name", () => {
    const html = render(blob({ contentType: "image/png", data: base64("hi"), size: 2 }));
    expect(html).toContain('alt="Preview"');
  });

  it("renders no image for a truncated image blob", () => {
    const html = render(
      blob({
        contentType: "image/png",
        data: base64(new Uint8Array([0x00])),
        truncated: true,
        size: 900_000,
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("data-zerops-data-blob-truncated");
  });

  it("renders a vector document with its embedding collapsed", () => {
    const document = { id: 1, payload: { title: "a" }, vector: [0.07, 0.5] };
    const html = render(
      blob({
        contentType: "application/json",
        data: base64(JSON.stringify(document)),
        vector: true,
      }),
    );
    expect(html).toContain('data-zerops-data-blob-kind="vector-json"');
    expect(html).toContain("Embedding collapsed");
    expect(html).toContain("[2 numbers]");
    expect(html).toContain("&quot;title&quot;: &quot;a&quot;");
  });

  it("labels stream metadata as a summary rather than message content", () => {
    const html = render(blob({ data: base64("messages: 12"), streamMetadata: true }));
    expect(html).toContain('data-zerops-data-blob-kind="stream-summary"');
    expect(html).toContain("Stream summary, not message content");
    expect(html).toContain("messages: 12");
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

  it("clips a text body past the preview cap and counts the rest", () => {
    const big = "A".repeat(260 * 1024);
    const html = render(blob({ data: base64(big), size: big.length }));
    expect(html).toContain('data-zerops-data-blob-kind="text"');
    expect(html).toContain(`${(260 * 1024 - 256 * 1024).toLocaleString()} more bytes`);
  });
});
