#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  SHOWCASE_SCENE_IDS,
  canonicalShowcaseSceneHash,
  listShowcaseScenes,
} from "@t3tools/shared/showcaseScenes";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import contractsPackageJson from "../packages/contracts/package.json" with { type: "json" };

const ShowcaseScenesLock = Schema.Struct({
  contractsVersion: Schema.String,
  scenes: Schema.Record(Schema.String, Schema.String),
});
export type ShowcaseScenesLock = typeof ShowcaseScenesLock.Type;

const ShowcaseScenesLockJson = fromJsonStringPretty(ShowcaseScenesLock);
const decodeLock = Schema.decodeEffect(ShowcaseScenesLockJson);
const encodeLock = Schema.encodeEffect(ShowcaseScenesLockJson);

export interface ShowcaseSceneMismatch {
  readonly id: string;
  readonly expected: string;
  readonly actual: string | undefined;
}

export class ShowcaseScenesLockError extends Schema.TaggedErrorClass<ShowcaseScenesLockError>()(
  "ShowcaseScenesLockError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "write"]),
    lockPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} showcase scene lock '${this.lockPath}'.`;
  }
}

export class ShowcaseScenesDriftError extends Schema.TaggedErrorClass<ShowcaseScenesDriftError>()(
  "ShowcaseScenesDriftError",
  {
    lockPath: Schema.String,
    mismatchCount: Schema.Int,
  },
) {
  override get message(): string {
    return `${this.mismatchCount} showcase scene lock value(s) drifted from ${this.lockPath}.`;
  }
}

export function buildShowcaseScenesLock(): ShowcaseScenesLock {
  return {
    contractsVersion: contractsPackageJson.version,
    scenes: Object.fromEntries(
      listShowcaseScenes().map((scene) => [scene.id, canonicalShowcaseSceneHash(scene)]),
    ),
  };
}

export function diffShowcaseScenesLocks(
  expected: ShowcaseScenesLock,
  actual: ShowcaseScenesLock,
): ReadonlyArray<ShowcaseSceneMismatch> {
  const mismatches: Array<ShowcaseSceneMismatch> = [];
  if (actual.contractsVersion !== expected.contractsVersion) {
    mismatches.push({
      id: "contractsVersion",
      expected: expected.contractsVersion,
      actual: actual.contractsVersion,
    });
  }
  const ids = [
    ...SHOWCASE_SCENE_IDS,
    ...Object.keys(actual.scenes).filter(
      (id) => !SHOWCASE_SCENE_IDS.includes(id as (typeof SHOWCASE_SCENE_IDS)[number]),
    ),
  ];
  for (const id of ids) {
    if (actual.scenes[id] !== expected.scenes[id]) {
      mismatches.push({
        id,
        expected: expected.scenes[id] ?? "<absent>",
        actual: actual.scenes[id],
      });
    }
  }
  return mismatches;
}

export const formatShowcaseSceneMismatch = (mismatch: ShowcaseSceneMismatch): string =>
  `${mismatch.id}: expected ${mismatch.expected}, got ${mismatch.actual ?? "<absent>"}`;

export const readShowcaseScenesLock = Effect.fn("readShowcaseScenesLock")(function* (
  lockPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs
    .readFileString(lockPath)
    .pipe(
      Effect.mapError(
        (cause) => new ShowcaseScenesLockError({ operation: "read", lockPath, cause }),
      ),
    );
  return yield* decodeLock(text).pipe(
    Effect.mapError(
      (cause) => new ShowcaseScenesLockError({ operation: "decode", lockPath, cause }),
    ),
  );
});

export const writeShowcaseScenesLock = Effect.fn("writeShowcaseScenesLock")(function* (
  lockPath: string,
  lock: ShowcaseScenesLock,
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* encodeLock(lock).pipe(
    Effect.mapError(
      (cause) => new ShowcaseScenesLockError({ operation: "encode", lockPath, cause }),
    ),
  );
  yield* fs
    .writeFileString(lockPath, `${text}\n`)
    .pipe(
      Effect.mapError(
        (cause) => new ShowcaseScenesLockError({ operation: "write", lockPath, cause }),
      ),
    );
});

export const showcaseScenesCommand = Command.make(
  "showcase-scenes",
  {
    check: Flag.boolean("check").pipe(
      Flag.withDescription("Decode the scenes and verify their checked-in hashes."),
      Flag.withDefault(false),
    ),
    lock: Flag.string("lock").pipe(
      Flag.withDescription("Scene lock path. Defaults to the checked-in scenes.lock."),
      Flag.optional,
    ),
  },
  ({ check, lock }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const defaultLockPath = yield* path.fromFileUrl(
        new URL("../packages/shared/src/showcaseScenes/v1/scenes.lock", import.meta.url),
      );
      const lockPath = path.resolve(Option.getOrUndefined(lock) ?? defaultLockPath);
      const expected = buildShowcaseScenesLock();

      if (!check) {
        yield* writeShowcaseScenesLock(lockPath, expected);
        yield* Console.log(`Wrote ${lockPath} (${SHOWCASE_SCENE_IDS.length} scenes).`);
        return;
      }

      const actual = yield* readShowcaseScenesLock(lockPath);
      const mismatches = diffShowcaseScenesLocks(expected, actual);
      if (mismatches.length === 0) {
        yield* Console.log(`scenes.lock matches ${SHOWCASE_SCENE_IDS.length} decoded scenes.`);
        return;
      }
      for (const mismatch of mismatches) {
        yield* Console.log(formatShowcaseSceneMismatch(mismatch));
      }
      return yield* new ShowcaseScenesDriftError({
        lockPath,
        mismatchCount: mismatches.length,
      });
    }),
).pipe(
  Command.withDescription(
    "Check or rewrite the scene hashes that pin showcase fixtures to the contracts package.",
  ),
);

if (import.meta.main) {
  Command.run(showcaseScenesCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
