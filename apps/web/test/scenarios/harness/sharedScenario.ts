import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createScenario, type ScenarioExtension, type ScenarioOptions } from "./scenario.ts";

type Scenario = Effect.Success<ReturnType<typeof createScenario>>;

export class SharedScenario extends Context.Service<SharedScenario, Scenario>()(
  "@t3tools/web/test/scenarios/harness/sharedScenario",
) {}

/** Use with it.layer for a describe/file whose cases only read the prepared world. */
export const sharedScenarioLayer = <E, R>(
  prepare: (scenario: Scenario) => Effect.Effect<unknown, E, R>,
  extensions: ScenarioExtension[] = [],
  options: ScenarioOptions = {},
) => Layer.effect(SharedScenario, createScenario(extensions, options).pipe(Effect.tap(prepare)));
