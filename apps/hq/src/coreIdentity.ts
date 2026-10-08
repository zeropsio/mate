/**
 * Which Core a build is: `<commit UTC>.<digest>`, `/health`'s `build`, the app version's name
 * (`hq-core.<identity>`) and the hosted web's `hq-core/build.json`. The digest is the first 12 hex
 * of sha256 over exactly the files a deploy carries — the bundle, then `zerops.yml` — with the
 * bundle's own stamp still {@link CORE_BUILD_PLACEHOLDER}: the identity cannot hash itself. One
 * Core, built from any commit, is one digest, so a push that leaves Core alone offers no update;
 * the commit time only orders two different digests (client-runtime `hq/update.ts`).
 *
 * The digest holds while `vp pack` is byte-deterministic: the same sources gave the same bundle in
 * two local runs, and it embeds no absolute paths (2026-10-04). A bundle that differed between
 * machines — another Node, another bundler build — would offer an update of the same Core.
 *
 * @module coreIdentity
 */
import { sha256 } from "@noble/hashes/sha2";
import * as Hex from "effect/encoding/Hex";

/** The stamp a Core bundle is built with, replaced by its identity once that is known. */
export const CORE_BUILD_PLACEHOLDER = "hq-core-build-placeholder";

export function coreIdentity(input: {
  /** The commit's time, UTC, as `YYYYMMDDTHHMMSSZ`. */
  readonly committedAt: string;
  /** The bundle as built with {@link CORE_BUILD_PLACEHOLDER}. */
  readonly bundle: string;
  readonly zeropsYaml: string;
}): string {
  const encoder = new TextEncoder();
  const digest = Hex.encode(
    sha256
      .create()
      .update(encoder.encode(input.bundle))
      .update(encoder.encode(input.zeropsYaml))
      .digest(),
  ).slice(0, 12);
  return `${input.committedAt}.${digest}`;
}

/** The bundle built with {@link CORE_BUILD_PLACEHOLDER}, its one stamp now `identity`. */
export function stampBundle(bundle: string, identity: string): string {
  const parts = bundle.split(JSON.stringify(CORE_BUILD_PLACEHOLDER));
  if (parts.length !== 2) {
    throw new Error(`The Core bundle carries ${String(parts.length - 1)} build stamps, not one.`);
  }
  return parts.join(JSON.stringify(identity));
}
