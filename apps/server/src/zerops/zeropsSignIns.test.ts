import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import { fileSignInStore, makeSignInStore, signInsPath } from "./zeropsSignIns.ts";

it.layer(NodeServices.layer)("zeropsSignIns", (it) => {
  // The file sits where the agent's user can write it: whatever is in it, the server starts, and
  // only a well-formed entry is anybody's sign-in.
  it.effect("reads only well-formed entries, and never fails on junk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-sign-ins-" });
      const file = signInsPath(path, home);
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      for (const junk of ["not json", "[]", "null", '"text"', "{"]) {
        yield* fs.writeFileString(file, junk);
        assert.deepStrictEqual(yield* (yield* fileSignInStore(file)).load, {}, junk);
      }
      yield* fs.writeFileString(
        file,
        encodeJson({
          good: { by: "u-eva", at: 1_759_000_000_000 },
          huge: { by: "u-jan", at: 1e20 },
          infinite: { by: "u-jan", at: "Infinity" },
          negative: { by: "u-jan", at: -5 },
          fraction: { by: "u-jan", at: 1.5 },
          noBy: { at: 1 },
          emptyBy: { by: "", at: 1 },
          longBy: { by: "x".repeat(1_000), at: 1 },
          array: [1, 2],
          text: "u-jan",
        }),
      );
      assert.deepStrictEqual(yield* (yield* fileSignInStore(file)).load, {
        good: { by: "u-eva", at: 1_759_000_000_000 },
      });
    }).pipe(Effect.scoped),
  );

  // A record that could not be written must not leave the one before it standing: after a
  // restart that one would be trusted over the tag. Nothing kept is the tag's rule instead.
  it.effect("a save that fails leaves no signer behind for that login", () =>
    Effect.gen(function* () {
      let disk: string | undefined = encodeJson({
        "claude-code": { by: "u-jan", at: 1 },
        codex: { by: "u-ada", at: 1 },
      });
      const store = yield* makeSignInStore({
        read: Effect.succeed(disk),
        write: (contents) =>
          contents.includes("u-eva")
            ? Effect.succeed(false)
            : Effect.sync(() => {
                disk = contents;
                return true;
              }),
        remove: Effect.sync(() => {
          disk = undefined;
          return true;
        }),
      });
      const reread = () =>
        makeSignInStore({
          read: Effect.sync(() => disk),
          write: () => Effect.succeed(false),
          remove: Effect.succeed(false),
        }).pipe(Effect.flatMap((fresh) => fresh.load));

      yield* store.save("claude-code", { by: "u-eva", at: 2 });
      assert.deepStrictEqual(yield* reread(), { codex: { by: "u-ada", at: 1 } });
    }),
  );
});
