import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

/** The `mate` of a link's `state` frame as HQ sent it: any object, read past what this build knows. */
export const HeardMate = Schema.Record(Schema.String, Schema.Unknown);
export type HeardMate = typeof HeardMate.Type;

const MateStateDocument = Schema.Struct({
  link: Schema.Literals(["linked", "not-linked"]),
  reason: Schema.optionalKey(Schema.String),
  heardAt: Schema.NullOr(Schema.String),
  mate: Schema.NullOr(HeardMate),
});
type MateStateDocument = typeof MateStateDocument.Type;

const MateStateJson = Schema.fromJsonString(MateStateDocument);
const decodeDocument = Schema.decodeUnknownOption(MateStateJson);
const encodeDocument = Schema.encodeEffect(MateStateJson);
const decodeChief = Schema.decodeUnknownOption(
  Schema.NullOr(Schema.Struct({ projectId: Schema.String })),
);

/** Why the Mate is not linked now that a link ended, was refused, or could not be dialled. */
export type MateLinkEnd =
  | "closed"
  | "key_refused"
  | "key_unresolved"
  | "no_public_origin"
  | "no_key";

export interface MateStateFile {
  /** The project the Chief mark named in the state kept from the last run; none with none kept. */
  readonly keptChief: Option.Option<string | null>;
  /** A `state` frame arrived at `heardAtMs`, carrying `mate`. */
  readonly linked: (mate: HeardMate, heardAtMs: number) => Effect.Effect<void>;
  readonly notLinked: (reason: MateLinkEnd) => Effect.Effect<void>;
}

/**
 * The Mate's state as its link last heard it, and whether the link is up, in the one file zcp reads
 * (zcp `docs/spec-mate.md` §2.8): `{link, reason?, heardAt, mate}`, replaced whole in one rename, so
 * zcp never reads half of one. `mate` is HQ's verbatim, never a credential. The last state survives
 * a start when it is this project's; the scope's end writes `stopped`.
 */
export const makeMateStateFile = (at: string, projectId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const writes = yield* Semaphore.make(1);
    const directory = path.dirname(at);
    const staged = path.join(directory, `.${path.basename(at)}.next`);

    const kept = (yield* fs.readFileString(at).pipe(
      Effect.map(decodeDocument),
      Effect.orElseSucceed(() => Option.none<MateStateDocument>()),
    )).pipe(Option.filter((document) => document.mate?.projectId === projectId));
    let heard = Option.match(kept, {
      onNone: () => ({ heardAt: null, mate: null }),
      onSome: ({ heardAt, mate }) => ({ heardAt, mate }),
    }) as Pick<MateStateDocument, "heardAt" | "mate">;
    // A dial loop retrying with the same reason replaces nothing, so zcp's watch is not woken.
    let written: string | undefined;

    const write = (link: Pick<MateStateDocument, "link" | "reason">) =>
      Effect.gen(function* () {
        const json = yield* encodeDocument({ ...link, ...heard });
        if (json === written) return;
        yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
        yield* fs.writeFileString(staged, json, { mode: 0o600 });
        yield* fs.rename(staged, at);
        written = json;
      }).pipe(
        Effect.onError(() => fs.remove(staged, { force: true }).pipe(Effect.ignore)),
        Effect.catch((error) =>
          Effect.logWarning("zerops mate state file: write failed", { reason: error._tag }),
        ),
      );
    // A superseded link's write finishes before the next one starts.
    const replace = (effect: Effect.Effect<void>) =>
      writes.withPermits(1)(Effect.uninterruptible(effect));

    yield* replace(write({ link: "not-linked", reason: "starting" }));
    yield* Effect.addFinalizer(() => replace(write({ link: "not-linked", reason: "stopped" })));

    return {
      keptChief: Option.flatMap(kept, ({ mate }) =>
        Option.map(decodeChief(mate?.chief), (chief) => chief?.projectId ?? null),
      ),
      linked: (mate, heardAtMs) =>
        replace(
          Effect.suspend(() => {
            heard = { heardAt: DateTime.formatIso(DateTime.makeUnsafe(heardAtMs)), mate };
            return write({ link: "linked" });
          }),
        ),
      notLinked: (reason) => replace(Effect.suspend(() => write({ link: "not-linked", reason }))),
    } satisfies MateStateFile;
  });
