import { MateChanges } from "@t3tools/shared/hqChanges";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

const encodeChanges = Schema.encodeEffect(Schema.fromJsonString(MateChanges));

/**
 * The Mate's changes as HQ's latest `state` frame carries them (`MateChanges`: its application and,
 * per change, `repo` and `number` naming it, `state`, `branch`, `updatedAt`), kept as JSON in one
 * file zcp reads (`~/.zcp/hq/changes.json`, zcp `docs/spec-mate.md` §2.8): replaced whole in one
 * rename, so zcp never reads half of one. Only `MateChanges`' fields reach it; never a credential.
 */
export const makeChangesFile = (at: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writes = yield* Semaphore.make(1);
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);
    return (changes: MateChanges): Effect.Effect<void> =>
      writes.withPermits(1)(
        // A superseded link's write finishes before the next one starts.
        Effect.uninterruptible(
          Effect.gen(function* () {
            const json = yield* encodeChanges(changes);
            yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
            yield* fs.writeFileString(staged, json, { mode: 0o600 });
            yield* fs.rename(staged, at);
          }).pipe(
            Effect.onError(() => fs.remove(staged, { force: true }).pipe(Effect.ignore)),
            Effect.catch((error) =>
              Effect.logWarning("zerops changes file: write failed", { reason: error._tag }),
            ),
          ),
        ),
      );
  });
