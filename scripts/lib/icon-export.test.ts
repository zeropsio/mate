import { assert, describe, it } from "@effect/vitest";
import { PNG } from "pngjs";

import {
  createMacOsActoolArguments,
  encodePngIco,
  hasClassicMacOsSafeArea,
  readPngDimensions,
} from "./icon-export.ts";

const pngHeader = (width: number, height: number) => {
  const contents = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(contents);
  contents.write("IHDR", 12, "ascii");
  contents.writeUInt32BE(width, 16);
  contents.writeUInt32BE(height, 20);
  return contents;
};

describe("icon export", () => {
  it("reads dimensions from a PNG IHDR chunk", () => {
    assert.deepEqual(readPngDimensions(pngHeader(1024, 512)), { width: 1024, height: 512 });
  });

  it("encodes PNG renditions into an ICO directory", () => {
    const small = pngHeader(16, 16);
    const large = pngHeader(256, 256);
    const ico = encodePngIco([
      { size: 16, contents: small },
      { size: 256, contents: large },
    ]);

    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 2);
    assert.equal(ico.readUInt8(6), 16);
    assert.equal(ico.readUInt8(22), 0);
    assert.equal(ico.readUInt32LE(18), 38);
    assert.equal(ico.readUInt32LE(34), 38 + small.length);
    assert.deepEqual(ico.subarray(38, 38 + small.length), small);
    assert.deepEqual(ico.subarray(38 + small.length), large);
  });

  it("rejects duplicate ICO rendition sizes", () => {
    assert.throws(
      () =>
        encodePngIco([
          { size: 32, contents: pngHeader(32, 32) },
          { size: 32, contents: pngHeader(32, 32) },
        ]),
      /provided more than once/,
    );
  });

  it("builds the macOS actool invocation from the canonical Icon Composer source", () => {
    assert.deepEqual(
      createMacOsActoolArguments({
        sourcePath: "/repo/assets/prod/app-icon.icon",
        outputDirectory: "/tmp/prod",
        partialInfoPlistPath: "/tmp/prod-info.plist",
      }),
      [
        "actool",
        "/repo/assets/prod/app-icon.icon",
        "--compile",
        "/tmp/prod",
        "--platform",
        "macosx",
        "--minimum-deployment-target",
        "13.4",
        "--target-device",
        "mac",
        "--app-icon",
        "app-icon",
        "--standalone-icon-behavior",
        "all",
        "--output-partial-info-plist",
        "/tmp/prod-info.plist",
        "--output-format",
        "human-readable-text",
        "--warnings",
        "--errors",
      ],
    );
  });

  it("accepts only a 1024px macOS icon with the classic 824px opaque body", () => {
    const render = (inset: number) => {
      const png = new PNG({ width: 1024, height: 1024 });
      for (let y = inset; y < 1024 - inset; y += 1) {
        for (let x = inset; x < 1024 - inset; x += 1) {
          png.data[(y * png.width + x) * 4 + 3] = 255;
        }
      }
      return PNG.sync.write(png);
    };

    assert.equal(hasClassicMacOsSafeArea(render(100)), true);
    assert.equal(hasClassicMacOsSafeArea(render(99)), false);
    assert.equal(hasClassicMacOsSafeArea(pngHeader(1024, 1024)), false);
  });
});
