import { describe, assert, it } from "vite-plus/test";
import { cn, getLocalFileManagerName, isWindowsPlatform } from "./utils";

describe("getLocalFileManagerName", () => {
  it.each([
    ["MacIntel", "Finder"],
    ["Win32", "Explorer"],
    ["Linux", "Files"],
  ])("uses the %s file manager name", (platform, expected) => {
    assert.strictEqual(getLocalFileManagerName(platform), expected);
  });
});

describe("isWindowsPlatform", () => {
  it("matches Windows platform identifiers", () => {
    assert.isTrue(isWindowsPlatform("Win32"));
    assert.isTrue(isWindowsPlatform("Windows"));
    assert.isTrue(isWindowsPlatform("windows_nt"));
  });

  it("does not match darwin", () => {
    assert.isFalse(isWindowsPlatform("darwin"));
  });
});

describe("cn", () => {
  it("keeps a scale size and a scale radius beside a colour and a later size wins", () => {
    assert.equal(cn("text-caption text-muted-foreground"), "text-caption text-muted-foreground");
    assert.equal(cn("rounded-card bg-muted"), "rounded-card bg-muted");
    assert.equal(cn("text-caption", "text-body"), "text-body");
    assert.equal(cn("rounded-control", "rounded-sheet"), "rounded-sheet");
  });
});
