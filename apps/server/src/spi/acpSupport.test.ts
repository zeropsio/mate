import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyCursorAcpModelSelection,
  applyGrokAcpModelSelection,
  currentGrokModelIdFromSessionSetup,
  currentGrokReasoningEffortFromSessionSetup,
  resolveGrokAcpBaseModelId,
} from "./acpSupport.ts";

describe("resolveGrokAcpBaseModelId", () => {
  it("defaults to grok-build for an empty/missing selection and trims a custom id", () => {
    expect(resolveGrokAcpBaseModelId(undefined)).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("   ")).toBe("grok-build");
    expect(resolveGrokAcpBaseModelId("  grok-custom  ")).toBe("grok-custom");
  });
});

describe("currentGrokModelIdFromSessionSetup / currentGrokReasoningEffortFromSessionSetup", () => {
  const sessionSetupResult: EffectAcpSchema.NewSessionResponse = {
    sessionId: "session-1",
    models: {
      currentModelId: "grok-4.6",
      availableModels: [
        { modelId: "grok-4.6", name: "Grok 4.6", _meta: { reasoningEffort: "xhigh" } },
      ],
    },
  };

  it("extracts the current model id and its reasoning effort from the session setup result", () => {
    expect(currentGrokModelIdFromSessionSetup(sessionSetupResult)).toBe("grok-4.6");
    expect(currentGrokReasoningEffortFromSessionSetup(sessionSetupResult)).toBe("xhigh");
  });

  it("returns undefined for both when no models state is present", () => {
    const noModels: EffectAcpSchema.NewSessionResponse = { sessionId: "session-2" };
    expect(currentGrokModelIdFromSessionSetup(noModels)).toBeUndefined();
    expect(currentGrokReasoningEffortFromSessionSetup(noModels)).toBeUndefined();
  });
});

describe("applyGrokAcpModelSelection", () => {
  it.effect("calls setSessionModel only when the requested model differs from current", () =>
    Effect.gen(function* () {
      const calls: Array<{ modelId: string; meta?: unknown }> = [];
      const runtime = {
        setSessionModel: (modelId: string, meta?: { readonly [key: string]: unknown } | null) =>
          Effect.sync(() => {
            calls.push(meta === undefined ? { modelId } : { modelId, meta });
            return {};
          }),
      };

      const changed = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-build",
        requestedModelId: "grok-mock-alt",
        mapError: (cause) => cause.message,
      });
      expect(changed).toBe("grok-mock-alt");
      expect(calls).toEqual([{ modelId: "grok-mock-alt" }]);

      const unchanged = yield* applyGrokAcpModelSelection({
        runtime,
        currentModelId: "grok-build",
        requestedModelId: "grok-build",
        mapError: (cause) => cause.message,
      });
      expect(unchanged).toBe("grok-build");
      expect(calls).toEqual([{ modelId: "grok-mock-alt" }]);
    }),
  );
});

describe("applyCursorAcpModelSelection", () => {
  it.effect("sets the base model before applying separate config options, in order", () =>
    Effect.gen(function* () {
      const calls: Array<
        | { readonly type: "model"; readonly value: string }
        | { readonly type: "config"; readonly configId: string; readonly value: string | boolean }
      > = [];

      const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "gpt-5.4-medium-fast",
          options: [{ value: "gpt-5.4-medium-fast", name: "GPT-5.4" }],
        },
        {
          id: "reasoning",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "medium",
          options: [{ value: "high", name: "High" }],
        },
      ];

      const runtime = {
        getConfigOptions: Effect.succeed(configOptions),
        setModel: (value: string) =>
          Effect.sync(() => {
            calls.push({ type: "model", value });
          }),
        setConfigOption: (configId: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push({ type: "config", configId, value });
          }),
      };

      yield* applyCursorAcpModelSelection({
        runtime,
        model: "gpt-5.4-medium-fast[reasoning=medium]",
        selections: [{ id: "reasoning", value: "high" }],
        mapError: ({ step, configId, cause }) =>
          step === "set-config-option"
            ? `failed to set config option ${configId}: ${cause.message}`
            : `failed to set model: ${cause.message}`,
      });

      expect(calls).toEqual([
        { type: "model", value: "gpt-5.4-medium-fast" },
        { type: "config", configId: "reasoning", value: "high" },
      ]);
    }),
  );
});
