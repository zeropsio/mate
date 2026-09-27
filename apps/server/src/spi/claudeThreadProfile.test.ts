import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  type ClaudeThreadExtensions,
  ClaudeThreadExtensionRegistry,
} from "./claudeThreadProfile.ts";

describe("ClaudeThreadExtensionRegistry", () => {
  it.effect("holds the installed extensions for the life of the install's scope", () =>
    Effect.gen(function* () {
      const registry = yield* ClaudeThreadExtensionRegistry;
      const extensions: ClaudeThreadExtensions = { extensionFor: () => Effect.succeed(undefined) };
      assert.isTrue(Option.isNone(yield* registry.current));
      yield* registry.install(extensions).pipe(Effect.scoped);
      assert.isTrue(Option.isNone(yield* registry.current), "a closed install stayed current");
      const held = yield* Effect.scoped(
        Effect.andThen(registry.install(extensions), registry.current),
      );
      assert.strictEqual(Option.getOrUndefined(held), extensions);
    }).pipe(Effect.provide(ClaudeThreadExtensionRegistry.layer)),
  );
});
