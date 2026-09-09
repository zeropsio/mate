import { describe, expect, it } from "@effect/vitest";

import {
  buildStableManifest,
  ReleaseManifestAssetInvalidShaError,
  RELEASE_MANIFEST_CONTRACT,
} from "./releaseManifestAsset.ts";

const VALID_SHA256 = "a".repeat(64);

describe("buildStableManifest", () => {
  it.each([
    {
      name: "builds the manifest with the GitHub download URL and contract 1",
      input: {
        version: "0.8.1",
        asset: "zerops-mate-0.8.1.tgz",
        repository: "zeropsio/mate",
        tag: "v0.8.1",
        sha256: VALID_SHA256,
        size: 21_690_443,
        publishedAt: "2026-09-09T07:23:00Z",
      },
      expected: {
        version: "0.8.1",
        asset: "zerops-mate-0.8.1.tgz",
        url: "https://github.com/zeropsio/mate/releases/download/v0.8.1/zerops-mate-0.8.1.tgz",
        sha256: VALID_SHA256,
        size: 21_690_443,
        contract: RELEASE_MANIFEST_CONTRACT,
        publishedAt: "2026-09-09T07:23:00Z",
      },
    },
    {
      name: "builds a rehearsal manifest against its own rehearsal version and tag",
      input: {
        version: "0.0.0-rehearsal",
        asset: "zerops-mate-0.0.0-rehearsal.tgz",
        repository: "zeropsio/mate",
        tag: "v0.0.0-rehearsal",
        sha256: VALID_SHA256,
        size: 1,
        publishedAt: "2026-09-09T00:00:00Z",
      },
      expected: {
        version: "0.0.0-rehearsal",
        asset: "zerops-mate-0.0.0-rehearsal.tgz",
        url: "https://github.com/zeropsio/mate/releases/download/v0.0.0-rehearsal/zerops-mate-0.0.0-rehearsal.tgz",
        sha256: VALID_SHA256,
        size: 1,
        contract: RELEASE_MANIFEST_CONTRACT,
        publishedAt: "2026-09-09T00:00:00Z",
      },
    },
    {
      name: "lowercases an uppercase sha256",
      input: {
        version: "0.8.1",
        asset: "zerops-mate-0.8.1.tgz",
        repository: "zeropsio/mate",
        tag: "v0.8.1",
        sha256: VALID_SHA256.toUpperCase(),
        size: 1,
        publishedAt: "2026-09-09T00:00:00Z",
      },
      expected: {
        version: "0.8.1",
        asset: "zerops-mate-0.8.1.tgz",
        url: "https://github.com/zeropsio/mate/releases/download/v0.8.1/zerops-mate-0.8.1.tgz",
        sha256: VALID_SHA256,
        size: 1,
        contract: RELEASE_MANIFEST_CONTRACT,
        publishedAt: "2026-09-09T00:00:00Z",
      },
    },
  ])("$name", ({ input, expected }) => {
    expect(buildStableManifest(input)).toEqual(expected);
  });

  it.each([
    { name: "too short", sha256: "abc" },
    { name: "the wrong length after trimming", sha256: `${"a".repeat(63)} ` },
    { name: "non-hex characters", sha256: "z".repeat(64) },
  ])("refuses a sha256 that is $name", ({ sha256 }) => {
    expect(() =>
      buildStableManifest({
        version: "0.8.1",
        asset: "zerops-mate-0.8.1.tgz",
        repository: "zeropsio/mate",
        tag: "v0.8.1",
        sha256,
        size: 1,
        publishedAt: "2026-09-09T00:00:00Z",
      }),
    ).toThrow(ReleaseManifestAssetInvalidShaError);
  });
});
