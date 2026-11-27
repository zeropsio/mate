import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import {
  EnvironmentNotRegisteredError,
  type EnvironmentRegistry,
} from "../../connection/registry.ts";
import { EnvironmentRpcUnavailableError } from "../../rpc/client.ts";
import { makeDraftPreviewWire } from "./draftPreview.ts";

// witness: packages/client-runtime/src/data/adapters/draftPreview.ts | failure === "unsupported" → failure === "not-connected"
it("AD93: A draft that cannot open says whether its Mate lacks the method, its socket is unavailable, or the opening failed; breaks: a person is told a Mate is offline or too old when the opening itself failed", async () => {
  const environmentId = EnvironmentId.make("mate");
  const cases = [
    {
      cause: Cause.die("Unknown request tag: zerops.draftPreview"),
      words: "This Mate does not support opening drafts yet.",
    },
    {
      cause: Cause.fail(
        new EnvironmentRpcUnavailableError({ environmentId, message: "Mate is not connected." }),
      ),
      words: "The Mate's socket is not connected.",
    },
    {
      cause: Cause.fail(new EnvironmentNotRegisteredError({ environmentId })),
      words: "The Mate's socket is not connected.",
    },
    {
      cause: Cause.fail(new Error("The database is not connected.")),
      words: "The draft could not be opened.",
    },
  ];
  for (const { cause, words } of cases) {
    const registry = {
      run: () => Effect.failCause(cause),
    } as unknown as EnvironmentRegistry["Service"];
    const said = await makeDraftPreviewWire(registry)(environmentId, {
      kind: "service",
      hostname: "web",
      branch: "change",
    }).then(
      () => "opened",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(said).toBe(words);
  }
});
