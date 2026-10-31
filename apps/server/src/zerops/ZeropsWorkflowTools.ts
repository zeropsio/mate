import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerConfig } from "../config.ts";
import { EngineToolInvocations, ToolInvocationUnavailable } from "../engine/MateEngine.ts";
import { ToolInvocationRegistry } from "../spi/toolInvocation.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { managedWorkflow, managedWorkflowReady } from "./managedWorkflowProcess.ts";

/** Actual Tasks own their execution independently of any Crew profile. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (!isZeropsEnvironment(config)) return;
    const bindings = yield* EngineToolInvocations;
    const registry = yield* ToolInvocationRegistry;
    const providers = yield* ProviderInstances;
    const [ready, invalidateReadiness] = yield* Effect.cachedInvalidateWithTTL(
      Effect.gen(function* () {
        if (
          providers.toolInvocationReady === undefined ||
          !(yield* providers.toolInvocationReady("opencode"))
        )
          return false;
        return yield* managedWorkflowReady({ cwd: config.cwd });
      }).pipe(Effect.catchCause(() => Effect.succeed(false))),
      "30 seconds",
    );
    yield* registry.install({
      ready,
      invalidateReadiness,
      prepare: (input, invocation) =>
        bindings.bind(input, invocation).pipe(
          Effect.as({ text: "", isError: false }),
          Effect.catchCause(() =>
            Effect.succeed({
              text: "The original invocation context could not be prepared.",
              isError: true,
            }),
          ),
        ),
      execute: (input, invocation) =>
        Effect.gen(function* () {
          const capturedInput = yield* Effect.try({
            try: () => structuredClone(input),
            catch: () => new ToolInvocationUnavailable({ reason: "invalid workflow input" }),
          });
          const envelope = yield* bindings.recorded(capturedInput, invocation);
          return yield* managedWorkflow(capturedInput, envelope, { cwd: config.cwd });
        }).pipe(
          Effect.tapErrorTag("ManagedWorkflowFailed", () => invalidateReadiness),
          Effect.catchCause(() =>
            Effect.succeed({
              text: "This tool invocation could not prove or complete its original execution context. Its outcome is unknown; no manual fallback was attempted.",
              isError: true,
            }),
          ),
        ),
    });
  }),
);
