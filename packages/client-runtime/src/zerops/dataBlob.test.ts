import { describe, expect, it } from "vite-plus/test";

import type { ZeropsDataConsoleBlob } from "@t3tools/contracts";

import {
  classifyBlob,
  collapseVectors,
  hexDump,
  humanizeTtl,
  isPrintableUtf8,
} from "./dataBlob.ts";

const bytes = (...values: readonly number[]): Uint8Array => new Uint8Array(values);

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

describe("isPrintableUtf8", () => {
  const cases: readonly (readonly [string, Uint8Array, boolean])[] = [
    ["plain ascii", bytes(0x34, 0x32), true],
    ["tab, newline and carriage return", bytes(0x09, 0x0a, 0x0d), true],
    ["multi-byte utf-8", new TextEncoder().encode("příliš"), true],
    ["empty", bytes(), true],
    ["a NUL byte", bytes(0x00, 0x41), false],
    ["a DEL byte", bytes(0x7f), false],
    ["invalid utf-8", bytes(0x00, 0xff, 0xfe), false],
  ];

  for (const [name, input, expected] of cases) {
    it(`${expected ? "accepts" : "rejects"} ${name}`, () => {
      expect(isPrintableUtf8(input)).toBe(expected);
    });
  }
});

describe("humanizeTtl", () => {
  const cases: readonly (readonly [number, string])[] = [
    [0, "0 s"],
    [45, "45 s"],
    [90, "2 min"],
    [3600, "1 h"],
    [82_800, "23 h"],
    [172_800, "2 d"],
  ];

  for (const [seconds, expected] of cases) {
    it(`renders ${seconds} seconds as ${expected}`, () => {
      expect(humanizeTtl(seconds)).toBe(expected);
    });
  }
});

describe("hexDump", () => {
  it("dumps short input on one line with an offset column and an ASCII gutter", () => {
    expect(hexDump(bytes(0x00, 0xff, 0xfe), 4096)).toBe(
      "00000000  00 ff fe                                         |...|",
    );
  });

  it("renders printable bytes in the ASCII gutter", () => {
    expect(hexDump(new TextEncoder().encode("hi"), 4096)).toContain("|hi|");
  });

  it("groups 16 bytes per line", () => {
    const dump = hexDump(new Uint8Array(20).fill(0x41), 4096);
    const lines = dump.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith("00000010  41 41 41 41 ")).toBe(true);
  });

  it("stops at the limit", () => {
    const dump = hexDump(new Uint8Array(64).fill(0x41), 16);
    expect(dump.split("\n")).toHaveLength(1);
  });
});

describe("collapseVectors", () => {
  it("collapses a top-level vector array to its length", () => {
    expect(collapseVectors({ id: 1, vector: [0.07, 0.5, 0.1] })).toEqual({
      id: 1,
      vector: "[3 numbers]",
    });
  });

  it("collapses each entry of a named-vectors object", () => {
    expect(collapseVectors({ vectors: { dense: [1, 2], sparse: [1, 2, 3] } })).toEqual({
      vectors: { dense: "[2 numbers]", sparse: "[3 numbers]" },
    });
  });

  it("leaves the rest of the payload untouched", () => {
    const document = { id: 1, payload: { title: "a", tags: ["x", "y"] }, vector: [1] };
    expect(collapseVectors(document)).toEqual({
      id: 1,
      payload: { title: "a", tags: ["x", "y"] },
      vector: "[1 numbers]",
    });
  });

  it("passes a non-object through unchanged", () => {
    expect(collapseVectors([1, 2])).toEqual([1, 2]);
  });
});

describe("classifyBlob", () => {
  it("classifies an empty value", () => {
    const result = classifyBlob(blob({ data: "", size: 0 }));
    expect(result.kind).toBe("empty");
  });

  it("carries content type, size and a humanized ttl on the meta line", () => {
    const result = classifyBlob(blob({ data: base64("42"), size: 2, ttlSeconds: 82_800 }));
    expect(result.meta).toBe("text/plain · 2 bytes · expires in 23 h");
  });

  it("omits the ttl when the blob carries none", () => {
    expect(classifyBlob(blob({ data: base64("42"), size: 2 })).meta).toBe("text/plain · 2 bytes");
  });

  it("classifies printable text", () => {
    const result = classifyBlob(blob());
    expect(result).toMatchObject({ kind: "text", text: "hello" });
  });

  it("pretty-prints a JSON body", () => {
    const result = classifyBlob(blob({ contentType: "application/json", data: base64('{"a":1}') }));
    expect(result).toMatchObject({ kind: "json", text: '{\n  "a": 1\n}' });
  });

  it("falls back to text when a JSON body does not parse", () => {
    const result = classifyBlob(
      blob({ contentType: "application/json", data: base64("not json") }),
    );
    expect(result).toMatchObject({ kind: "text", text: "not json" });
  });

  it("hex-dumps a mis-sniffed binary payload", () => {
    const result = classifyBlob(blob({ data: base64(bytes(0x00, 0xff, 0xfe)), size: 3 }));
    expect(result.kind).toBe("hex");
    if (result.kind !== "hex") throw new Error("expected a hex preview");
    expect(result.dump).toContain("00 ff fe");
    expect(result.moreBytes).toBeUndefined();
  });

  it("caps the hex dump and counts the bytes it left out", () => {
    const raw = new Uint8Array(5000).fill(0x00);
    const result = classifyBlob(blob({ data: base64(raw), size: 5000 }));
    if (result.kind !== "hex") throw new Error("expected a hex preview");
    expect(result.moreBytes).toBe(5000 - 4096);
  });

  it("hex-dumps the head slice of a truncated binary object", () => {
    const raw = new Uint8Array(64).fill(0x00);
    const result = classifyBlob(
      blob({
        contentType: "application/octet-stream",
        data: base64(raw),
        truncated: true,
        size: 300_000,
      }),
    );
    expect(result).toMatchObject({ kind: "hex", truncated: true, size: 300_000 });
  });

  it("classifies an untruncated image as a data URI", () => {
    const result = classifyBlob(
      blob({ contentType: "image/png", data: base64(bytes(0x89, 0x50)), size: 75 }),
    );
    expect(result).toMatchObject({
      kind: "image",
      dataUri: `data:image/png;base64,${base64(bytes(0x89, 0x50))}`,
    });
  });

  const imageTypes = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/avif",
  ];
  for (const contentType of imageTypes) {
    it(`classifies ${contentType} as an image`, () => {
      expect(classifyBlob(blob({ contentType, data: base64(bytes(0x01)), size: 1 })).kind).toBe(
        "image",
      );
    });
  }

  it("never renders a truncated image", () => {
    const result = classifyBlob(
      blob({ contentType: "image/png", data: base64(bytes(0x00)), truncated: true, size: 900_000 }),
    );
    expect(result.kind).toBe("hex");
  });

  it("collapses the embedding of a vector document", () => {
    const document = { id: 1, payload: { title: "a" }, vector: [0.07, 0.5] };
    const result = classifyBlob(
      blob({
        contentType: "application/json",
        data: base64(JSON.stringify(document)),
        vector: true,
      }),
    );
    if (result.kind !== "vector-json") throw new Error("expected a vector preview");
    expect(result.text).toContain('"vector": "[2 numbers]"');
    expect(result.text).toContain('"title": "a"');
  });

  it("falls back to text for a vector body that does not parse", () => {
    const result = classifyBlob(blob({ data: base64("not json"), vector: true }));
    expect(result).toMatchObject({ kind: "text", text: "not json" });
  });

  it("classifies stream metadata as a summary", () => {
    const result = classifyBlob(blob({ data: base64("messages: 12"), streamMetadata: true }));
    expect(result).toMatchObject({ kind: "stream-summary", text: "messages: 12" });
  });

  it("clips a text body past the preview cap", () => {
    const big = "A".repeat(260 * 1024);
    const result = classifyBlob(blob({ data: base64(big), size: big.length }));
    if (result.kind !== "text") throw new Error("expected a text preview");
    expect(result.text).toHaveLength(256 * 1024);
    expect(result.moreBytes).toBe(big.length - 256 * 1024);
  });

  it("classifies a malformed base64 body as empty rather than throwing", () => {
    expect(classifyBlob(blob({ data: "!!!!", size: 3 })).kind).toBe("empty");
  });
});
