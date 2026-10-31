// @effect-diagnostics nodeBuiltinImport:off -- generated native plugin is an actual private module boundary.
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { serveOpenCodeToolExecution } from "../spi/openCodeToolExecution.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  managedOpenCodeConfig,
  managedOpenCodePluginSource,
  managedOpenCodePermissions,
} from "./openCodeManagedTools.ts";

const pluginFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "managed-plugin-proof-" });
  const packageRoot = directory + "/node_modules/@opencode-ai/plugin";
  yield* fs.makeDirectory(packageRoot, { recursive: true });
  // Fake only the native package's tool-schema constructor. The actual
  // generated module and real private HTTP denial boundary run unchanged.
  yield* fs.writeFileString(
    packageRoot + "/package.json",
    JSON.stringify({ exports: { ".": { import: "./entry.mjs" } } }),
  );
  yield* fs.writeFileString(
    packageRoot + "/entry.mjs",
    "export const tool=Object.assign(input=>input,{schema:{record:()=>({}),string:()=>({}),unknown:()=>({})}});",
  );
  const effectRoot = directory + "/node_modules/effect";
  yield* fs.makeDirectory(effectRoot, { recursive: true });
  yield* fs.writeFileString(
    effectRoot + "/package.json",
    JSON.stringify({ exports: { "./Effect": "./Effect.mjs" } }),
  );
  yield* fs.writeFileString(
    effectRoot + "/Effect.mjs",
    `export * from ${JSON.stringify(import.meta.resolve("effect/Effect"))};`,
  );
  const bridge = yield* serveOpenCodeToolExecution(ProviderInstanceId.make("opencode"));
  bridge.registerSession("manual-root", {
    threadId: ThreadId.make("manual"),
    prepare: () => Effect.succeed({ text: "prepared", isError: false }),
    resolveTurn: () => Effect.succeed(undefined),
    execute: () => Effect.die("deny-only policy must not execute a workflow"),
  });
  const file = directory + "/plugin.mjs";
  yield* fs.writeFileString(
    file,
    managedOpenCodePluginSource({
      endpoint: bridge.url,
      token: bridge.token,
      nativePackageRoot: directory,
    }),
  );
  const plugin = yield* Effect.promise(() => import(NodeURL.pathToFileURL(file).href));
  const hooks = (yield* Effect.promise(() => plugin.default())) as {
    "tool.execute.before": (call: { tool: string; sessionID: string }) => Promise<void>;
    tool: {
      mate_workflow: {
        execute: (
          args: { input: Record<string, unknown> },
          context: {
            sessionID: string;
            messageID: string;
            callID: string;
            abort: AbortSignal;
            ask: (request: { permission: string }) => Effect.Effect<void>;
          },
        ) => Promise<string>;
      };
    };
  };
  return { bridge, hooks };
});

describe("managed OpenCode workflow execution", () => {
  it("preserves native configuration while adding only its private plugin", () => {
    const config = {
      model: "fixture/model",
      plugin: ["old-plugin"],
      mcp: { zerops: { command: ["zcp", "serve"] } },
      permission: { bash: "ask" },
    };
    expect(
      JSON.parse(managedOpenCodeConfig(JSON.stringify(config), "file:///private/tool.mjs")),
    ).toEqual({ ...config, plugin: ["old-plugin", "file:///private/tool.mjs"] });
    expect(() => managedOpenCodeConfig("not-json", "file:///private/tool.mjs")).toThrow();
    expect(() => managedOpenCodeConfig('{"plugin":"wrong"}', "file:///private/tool.mjs")).toThrow();
  });
  it("preserves original native permission rules for managed workflows and denies custom execution to manual roots", () => {
    for (const action of ["allow", "ask", "deny"] as const) {
      const base = [{ permission: "*", pattern: "*", action }];
      expect(managedOpenCodePermissions(base, true)).toEqual(base);
      expect(managedOpenCodePermissions(base, false)).toEqual([
        ...base,
        { permission: "mate_workflow", pattern: "*", action: "deny" },
      ]);
      expect(base).toEqual([{ permission: "*", pattern: "*", action }]);
    }
  });
  it.effect(
    "the generated execution plugin permits manual roots and refuses managed or unknown child workflow calls",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, hooks } = yield* pluginFixture;
          yield* Effect.promise(async () => {
            await hooks["tool.execute.before"]({
              tool: "zerops_zerops_workflow",
              sessionID: "manual-root",
            });
            await expect(
              hooks["tool.execute.before"]({
                tool: "zerops_zerops_workflow",
                sessionID: "native-child",
              }),
            ).rejects.toThrow("Use mate_workflow");
            bridge.markManaged("manual-root");
            await expect(
              hooks["tool.execute.before"]({
                tool: "zerops_zerops_workflow",
                sessionID: "manual-root",
              }),
            ).rejects.toThrow("Use mate_workflow");
          });
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect(
    "captures immutable workflow input before native approval and never executes a denied invocation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { bridge, hooks } = yield* pluginFixture;
          yield* Effect.promise(async () => {
            const order: string[] = [];
            let reject = true;
            bridge.registerSession("approval-root", {
              threadId: ThreadId.make("approval"),
              resolveTurn: () => Effect.succeed(undefined),
              prepare: (input) =>
                Effect.sync(() => {
                  order.push("prepare:" + JSON.stringify(input));
                  return { text: "prepared", isError: false };
                }),
              execute: (input) =>
                Effect.sync(() => {
                  order.push("execute:" + JSON.stringify(input));
                  return { text: "executed", isError: false };
                }),
            });
            const args = { input: { action: "open-change" } };
            const context = {
              sessionID: "approval-root",
              messageID: "message",
              callID: "call",
              abort: new AbortController().signal,
              ask: (request: { permission: string }) =>
                Effect.sync(() => {
                  order.push("ask:" + request.permission);
                  args.input.action = "forged-after-prepare";
                  if (reject) throw new Error("native denied");
                }),
            };
            await expect(hooks.tool.mate_workflow.execute(args, context)).rejects.toThrow(
              "native denied",
            );
            expect(order).toEqual([
              'prepare:{"action":"open-change"}',
              "ask:zerops_zerops_workflow",
            ]);
            reject = false;
            order.length = 0;
            args.input.action = "open-change";
            expect(await hooks.tool.mate_workflow.execute(args, context)).toBe("executed");
            expect(order).toEqual([
              'prepare:{"action":"open-change"}',
              "ask:zerops_zerops_workflow",
              'execute:{"action":"open-change"}',
            ]);
          });
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );
});
