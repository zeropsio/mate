import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { type ThreadToolPolicy, ThreadToolPolicyRegistry } from "./threadToolPolicy.ts";

const policy = (): ThreadToolPolicy => ({ profileFor: () => Effect.succeed(undefined) });

type Step = { readonly install: "first" | "second" } | { readonly release: "first" | "second" };

// Each row replays install/release steps against one registry and names
// which policy `current` must then hold.
const CASES: ReadonlyArray<{
  readonly name: string;
  readonly steps: ReadonlyArray<Step>;
  readonly current: "first" | "second" | "none";
}> = [
  { name: "nothing installed", steps: [], current: "none" },
  { name: "installed", steps: [{ install: "first" }], current: "first" },
  {
    name: "installed, then its scope closed",
    steps: [{ install: "first" }, { release: "first" }],
    current: "none",
  },
  {
    name: "a later install wins",
    steps: [{ install: "first" }, { install: "second" }],
    current: "second",
  },
  {
    name: "closing an earlier install leaves the later one",
    steps: [{ install: "first" }, { install: "second" }, { release: "first" }],
    current: "second",
  },
  {
    name: "closing the later install does not bring the earlier one back",
    steps: [{ install: "first" }, { install: "second" }, { release: "second" }],
    current: "none",
  },
];

describe("ThreadToolPolicyRegistry", () => {
  for (const { name, steps, current } of CASES) {
    it.effect(name, () =>
      Effect.gen(function* () {
        const registry = yield* ThreadToolPolicyRegistry;
        const policies = { first: policy(), second: policy() };
        const scopes = new Map<"first" | "second", Scope.Closeable>();
        for (const step of steps) {
          if ("install" in step) {
            const scope = yield* Scope.make();
            scopes.set(step.install, scope);
            yield* registry.install(policies[step.install]).pipe(Scope.provide(scope));
          } else {
            yield* Scope.close(scopes.get(step.release)!, Exit.void);
          }
        }
        const installed = yield* registry.current;
        assert.strictEqual(
          Option.getOrUndefined(installed),
          current === "none" ? undefined : policies[current],
        );
      }).pipe(Effect.provide(ThreadToolPolicyRegistry.layer)),
    );
  }
});
