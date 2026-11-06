import * as Effect from "effect/Effect";
import type { ScenarioExtension, ScenarioOptions } from "../../harness/scenario.ts";
import { createScenario } from "../../harness/scenario.ts";
import { installBuildProtocol } from "../../fakes/e-env/builds.ts";
import { environmentFlow } from "./environmentFlowSource.ts";

export const installArea: ScenarioExtension = ({ zerops }) => installBuildProtocol(zerops);

export const environmentFixtureWith = Effect.fn("e-env.fixture")(function* (
  options: ScenarioOptions = {},
  shape: { readonly stage?: boolean } = {},
) {
  return yield* environmentFlow(yield* createScenario([installArea], options), shape);
});

export const environmentFixture = environmentFixtureWith();
