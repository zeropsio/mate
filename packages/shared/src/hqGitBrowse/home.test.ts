import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { GitHome } from "./home.ts";

const home = {
  sha: null,
  ref: { kind: "branch", name: "main" },
  about: {
    remote: null,
    mirror: null,
    updatedAt: "2026-10-28T00:00:00Z",
    branchCount: 0,
    tagCount: 0,
  },
  readme: null,
};

it.each([
  undefined,
  { usedBytes: null, limitBytes: 2_000_000_000, large: null, routeBodyLimitBytes: null },
  { usedBytes: 0, limitBytes: 2_000_000_000, large: false, routeBodyLimitBytes: 50_000_000 },
  { usedBytes: 1_000_000_000, limitBytes: 2_000_000_000, large: true, routeBodyLimitBytes: null },
])(
  "repository metadata preserves HQ storage evidence without deriving usage or its verdict: %j",
  (storage) => {
    const value = {
      ...home,
      about: { ...home.about, ...(storage === undefined ? {} : { storage }) },
    };
    expect(Schema.decodeUnknownSync(GitHome)(value)).toEqual(value);
  },
);
