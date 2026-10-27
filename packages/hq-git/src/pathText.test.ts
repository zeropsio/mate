import { describe, expect, it } from "@effect/vitest";
import { pathBytes, pathText } from "./pathText.ts";

describe("pathText", () => {
  it.each([
    ["UTF-8 text", [0x63, 0x61, 0x66, 0xc3, 0xa9], "café"],
    ["a Latin-1 byte", [0x63, 0x61, 0x66, 0xe9], "caf\udce9"],
    ["a cut sequence", [0xe2, 0x82, 0x2f], "\udce2\udc82/"],
    ["an overlong slash", [0xc0, 0xaf], "\udcc0\udcaf"],
    ["an encoded surrogate", [0xed, 0xa0, 0x80], "\udced\udca0\udc80"],
    ["a byte order mark", [0xef, 0xbb, 0xbf, 0x61], "﻿a"],
    ["a replacement character", [0xef, 0xbf, 0xbd, 0xff], "�\udcff"],
    ["an emoji beside a raw byte", [0xf0, 0x9f, 0x98, 0x80, 0x80], "😀\udc80"],
  ])("A path of %s reads as text that names its exact bytes", (_, bytes, text) => {
    expect(pathText(Uint8Array.from(bytes))).toBe(text);
    expect([...pathBytes(text)]).toEqual(bytes);
  });
});
