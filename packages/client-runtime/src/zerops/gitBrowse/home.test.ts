import { describe, expect, it } from "vite-plus/test";
import { repositoryStorage } from "./home.ts";

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
    { storage: undefined, line: "Git storage is not available yet.", large: false },
    {
      storage: {
        usedBytes: null,
        limitBytes: 2_147_483_648,
        large: null,
        routeBodyLimitBytes: null,
      },
      line: "Git storage is not available yet.",
      large: false,
    },
    {
      storage: { usedBytes: 0, limitBytes: 2_147_483_648, large: false, routeBodyLimitBytes: null },
      line: "Git storage: 0 B of 2 GiB",
      large: false,
    },
    {
      storage: {
        usedBytes: 1_073_741_824,
        limitBytes: 2_147_483_648,
        large: false,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1 GiB of 2 GiB",
      large: false,
    },
    {
      storage: {
        usedBytes: 1_073_741_823,
        limitBytes: 2_147_483_648,
        large: true,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 1 GiB of 2 GiB",
      large: true,
    },
    {
      storage: {
        usedBytes: 2_147_483_649,
        limitBytes: 2_147_483_648,
        large: true,
        routeBodyLimitBytes: null,
      },
      line: "Git storage: 2 GiB of 2 GiB",
      large: true,
    },
  ])("shows HQ's measurement and verdict: $line, large=$large", ({ storage, line, large }) => {
    expect(repositoryStorage(storage)).toMatchObject({ line, large });
  });
});
