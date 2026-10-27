import { it } from "@effect/vitest";
import * as Layer from "effect/Layer";

/** Scenarios run on real time; each case starts its own Core process, so no layer is shared. */
export const scenarioSuite = it.layer(Layer.empty, { excludeTestServices: true });
