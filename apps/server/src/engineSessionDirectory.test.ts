import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { HandedOverResume } from "./engine/ports.ts";
import { serverHandedOverResume } from "./engineSessionDirectory.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "./provider/Services/ProviderSessionDirectory.ts";

describe("engineSessionDirectory", () => {
  const binding = (fields: Partial<ProviderRuntimeBinding>) =>
    ({ threadId: "mate", provider: "claudeAgent", ...fields }) as ProviderRuntimeBinding;
  const directory = (read: Effect.Effect<Option.Option<ProviderRuntimeBinding>, string>) =>
    Layer.succeed(ProviderSessionDirectory, { getBinding: () => read } as never);
  it.effect.each([
    {
      name: "the state another instance of its driver left",
      sessions: directory(
        Effect.succeed(
          Option.some(
            binding({ providerInstanceId: "claudeAgent:old" as never, resumeCursor: "c1" }),
          ),
        ),
      ),
      expected: "c1",
    },
    {
      name: "nothing its own instance left: the provider resumes that itself",
      sessions: directory(
        Effect.succeed(
          Option.some(binding({ providerInstanceId: "claudeAgent" as never, resumeCursor: "c1" })),
        ),
      ),
      expected: undefined,
    },
    {
      name: "nothing when the other instance left no state",
      sessions: directory(
        Effect.succeed(
          Option.some(
            binding({ providerInstanceId: "claudeAgent:old" as never, resumeCursor: null }),
          ),
        ),
      ),
      expected: undefined,
    },
    {
      name: "nothing when no session ran on the thread",
      sessions: directory(Effect.succeed(Option.none())),
      expected: undefined,
    },
    {
      name: "nothing when the directory cannot be read",
      sessions: directory(Effect.fail("disk")),
      expected: undefined,
    },
    {
      name: "nothing on a server with no session directory",
      sessions: Layer.empty,
      expected: undefined,
    },
  ])("an agent pick that keeps the thread resumes from $name", ({ sessions, expected }) =>
    Effect.gen(function* () {
      const resume = yield* (yield* HandedOverResume).of({
        thread: "mate",
        instanceId: "claudeAgent",
      });
      assert.strictEqual(resume, expected);
    }).pipe(Effect.provide(serverHandedOverResume.pipe(Layer.provide(sessions)))),
  );
});
