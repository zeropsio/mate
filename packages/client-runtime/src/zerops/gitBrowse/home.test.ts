import { describe, expect, it } from "vite-plus/test";
import { formatStorageBytes, repositoryStorage } from "./home.ts";

describe("HQ repository storage", () => {
  it("explains that Git storage includes history and gives exact repository quota bytes in the hint", () => {
    expect(
      repositoryStorage({
        usedBytes: 1_300_000_001,
        limitBytes: 2_000_000_000,
        large: true,
        routeBodyLimitBytes: null,
      }).hint,
    ).toBe(
      "Git storage includes history. This repository’s limit, set for your organization. 1,300,000,001 bytes of 2,000,000,000 bytes.",
    );
  });
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1.00 kB"],
    [1_000_000, "1.00 MB"],
    [1_000_000_000, "1.00 GB"],
    [1_300_000_001, "1.30 GB"],
  ])("formats %s bytes in decimal units as %s", (bytes, expected) => {
    expect(formatStorageBytes(bytes)).toBe(expected);
  });
  it.each([
    { storage: undefined, line: "Git storage is not available yet.", large: false },
    {
      storage: {
        usedBytes: null,
        limitBytes: 2_000_000_000,
        large: null,
        routeBodyLimitBytes: null,
      },
      line: "Git storage is not available yet.",
      large: false,
    },
    {
      storage: { usedBytes: 0, limitBytes: 2_000_000_000, large: false, routeBodyLimitBytes: null },
      line: "Git storage: 0 B of 2.00 GB",
      large: false,
    },
    {
      storage: {
        usedBytes: 1_000_000_000,
        limitBytes: 2_000_000_000,
        large: false,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1.00 GB of 2.00 GB",
      large: false,
    },
    {
      storage: {
        usedBytes: 999_999_999,
        limitBytes: 2_000_000_000,
        large: true,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1.00 GB of 2.00 GB",
      large: true,
    },
    {
      storage: {
        usedBytes: 2_000_000_001,
        limitBytes: 2_000_000_000,
        large: true,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 2.00 GB of 2.00 GB",
      large: true,
    },
  ])("shows HQ's measurement and verdict: $line, large=$large", ({ storage, line, large }) => {
    expect(repositoryStorage(storage)).toMatchObject({ line, large });
  });
});
