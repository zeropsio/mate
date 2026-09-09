#!/usr/bin/env node

/**
 * Builds `stable.json`, the release-manifest asset the release workflow
 * publishes next to the tarball (spec-mate.md §2.1c). zcp tracks this
 * asset — via GitHub's own `releases/latest/download/stable.json` redirect —
 * as the ONLY source for the desired mate release; there is no pin compiled
 * into zcp any more.
 *
 * Shape (spec-mate.md §2.1c):
 * `{version, asset, url, sha256, size, contract, publishedAt}`. `sha256`
 * must be the same digest `SHA256SUMS` carries for the tarball — this script
 * takes it as input rather than recomputing it, so the two files can never
 * disagree about which bytes they describe.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

/** `contract` today (spec-mate.md §2.8: C-1…C-6). Bumped only alongside a zcp-side change. */
export const RELEASE_MANIFEST_CONTRACT = 1;

export const StableManifest = Schema.Struct({
  version: Schema.String,
  asset: Schema.String,
  url: Schema.String,
  sha256: Schema.String,
  size: Schema.Int,
  contract: Schema.Int,
  publishedAt: Schema.String,
});
export type StableManifest = typeof StableManifest.Type;

const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class ReleaseManifestAssetInvalidShaError extends Error {
  readonly sha256: string;
  constructor(sha256: string) {
    super(`stable.json sha256 must be 64 lowercase hex characters, got '${sha256}'.`);
    this.name = "ReleaseManifestAssetInvalidShaError";
    this.sha256 = sha256;
  }
}

export interface BuildStableManifestInput {
  /** SemVer this release publishes (the rehearsal path passes its rehearsal version). */
  readonly version: string;
  /** The tarball's file name, e.g. `zerops-mate-0.8.1.tgz`. */
  readonly asset: string;
  /** `owner/repo`, e.g. `zeropsio/mate`. */
  readonly repository: string;
  /** The release tag, e.g. `v0.8.1`. */
  readonly tag: string;
  /** The tarball's SHA-256 — must equal the `SHA256SUMS` entry for the same asset. */
  readonly sha256: string;
  readonly size: number;
  /** RFC3339. */
  readonly publishedAt: string;
}

/** Builds the manifest object. Throws {@link ReleaseManifestAssetInvalidShaError} on a malformed digest. */
export function buildStableManifest(input: BuildStableManifestInput): StableManifest {
  const sha256 = input.sha256.trim().toLowerCase();
  if (!HEX_SHA256_PATTERN.test(sha256)) {
    throw new ReleaseManifestAssetInvalidShaError(input.sha256);
  }
  return {
    version: input.version,
    asset: input.asset,
    url: `https://github.com/${input.repository}/releases/download/${input.tag}/${input.asset}`,
    sha256,
    size: input.size,
    contract: RELEASE_MANIFEST_CONTRACT,
    publishedAt: input.publishedAt,
  };
}

const encodeStableManifest = Schema.encodeEffect(fromJsonStringPretty(StableManifest));

const releaseManifestAssetCommand = Command.make(
  "release-manifest-asset",
  {
    version: Flag.string("version").pipe(Flag.withDescription("SemVer this release publishes.")),
    asset: Flag.string("asset").pipe(
      Flag.withDescription("The tarball's file name, e.g. zerops-mate-0.8.1.tgz."),
    ),
    repository: Flag.string("repository").pipe(
      Flag.withDefault("zeropsio/mate"),
      Flag.withDescription("owner/repo the release publishes on."),
    ),
    tag: Flag.string("tag").pipe(Flag.withDescription("The release tag, e.g. v0.8.1.")),
    sha256: Flag.string("sha256").pipe(
      Flag.withDescription("The tarball's SHA-256, matching the SHA256SUMS entry."),
    ),
    size: Flag.integer("size").pipe(Flag.withDescription("The tarball's size in bytes.")),
    publishedAt: Flag.string("published-at").pipe(
      Flag.withDescription("RFC3339 publish timestamp."),
    ),
    out: Flag.string("out").pipe(Flag.withDescription("Where to write stable.json.")),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const manifest = buildStableManifest(config);
      const json = yield* encodeStableManifest(manifest);
      yield* fs.writeFileString(config.out, `${json}\n`);
      yield* Console.log(`[release-manifest-asset] Wrote ${config.out}`);
    }),
).pipe(Command.withDescription("Write the stable.json release-manifest asset."));

if (import.meta.main) {
  Command.run(releaseManifestAssetCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
