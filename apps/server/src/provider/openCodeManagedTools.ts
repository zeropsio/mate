// @effect-diagnostics nodeBuiltinImport:off -- install a private native plugin for one provider lifetime.
import type { PermissionRuleset } from "@opencode-ai/sdk/v2";
import * as NodeURL from "node:url";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { resolveOpenCodeConfigContent } from "./opencodeRuntime.ts";
import type { OpenCodeToolExecution } from "../spi/openCodeToolExecution.ts";

/** Native execution metadata is supplied by OpenCode, separately from model input. */
export interface ManagedOpenCodePlugin {
  readonly endpoint: string;
  readonly token: string;
  readonly nativePackageRoot: string;
}

/** Managed tools ask the original native permission; the execution hook closes its static door. */
export function managedOpenCodePermissions(
  base: PermissionRuleset,
  managed: boolean,
): PermissionRuleset {
  return managed
    ? [...base]
    : [...base, { permission: "mate_workflow", pattern: "*", action: "deny" }];
}

export function managedOpenCodeConfig(raw: string, pluginURL: string): string {
  const config: unknown = JSON.parse(raw);
  if (typeof config !== "object" || config === null || Array.isArray(config))
    throw new Error("OpenCode configuration must be an object");
  const fields = config as Record<string, unknown>;
  const plugins = fields.plugin ?? [];
  if (!Array.isArray(plugins) || !plugins.every((entry) => typeof entry === "string"))
    throw new Error("OpenCode plugin configuration must be an array");
  return JSON.stringify({ ...fields, plugin: [...plugins, pluginURL] });
}

export function managedOpenCodePluginSource(input: ManagedOpenCodePlugin): string {
  const endpoint = new URL(input.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("Managed OpenCode executor must be private loopback");
  if (input.token.length === 0 || input.nativePackageRoot.length === 0)
    throw new Error("Managed OpenCode executor configuration is incomplete");
  return `import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {createRequire} from "node:module";
const packageRoot = ${JSON.stringify(input.nativePackageRoot + "/node_modules/@opencode-ai/plugin")};
const manifest = JSON.parse(await readFile(packageRoot + "/package.json", "utf8"));
const entry = manifest.exports?.["."]?.import;
if (typeof entry !== "string" || !entry.startsWith("./") || entry.includes(".."))
 throw new Error("Native OpenCode plugin has no supported ESM entry");
const {tool} = await import(pathToFileURL(packageRoot + "/" + entry).href);
// Native ctx.ask returns an Effect, not a Promise. Run its own runtime rather
// than merely awaiting the inert Effect value or mixing runtime versions.
const nativeEffect = await import(pathToFileURL(createRequire(packageRoot + "/package.json").resolve("effect/Effect")).href);
const valid = value => typeof value === "string" && value.length > 0 && value.length <= 1024;
export default async () => ({
 "tool.execute.before": async native => {
  if (native.tool !== "zerops_zerops_workflow") return;
  if (!valid(native.sessionID)) throw new Error("Native workflow session is unavailable");
  const response = await fetch(${JSON.stringify(new URL("/policy", input.endpoint).href)}, {
   method:"POST", headers:{"content-type":"application/json",authorization:${JSON.stringify("Bearer " + input.token)}},
   body:JSON.stringify({sessionID:native.sessionID}), redirect:"error", signal:AbortSignal.timeout(5000)
  });
  if (!response.ok || (await response.json()).allowStaticWorkflow !== true)
   throw new Error("Use mate_workflow for this owned native session; unknown child sessions are unsupported");
 },
 tool: {mate_workflow: tool({
 description: "Run Zerops workflow actions using the original invocation context. Pass the ordinary zerops_workflow fields as input; the platform validates them. Context and task identity cannot be supplied as workflow arguments.",
 args: {input: tool.schema.record(tool.schema.string(), tool.schema.unknown())},
 async execute({input}, context) {
  if (!valid(context.sessionID) || !valid(context.messageID) || !valid(context.callID))
   throw new Error("OpenCode did not supply exact tool invocation identity");
  const body = JSON.stringify({sessionID:context.sessionID,messageID:context.messageID,callID:context.callID,input});
  const request = async url => {
   const response = await fetch(url, {
    method:"POST", headers:{"content-type":"application/json",authorization:${JSON.stringify("Bearer " + input.token)}},
    body, signal:context.abort, redirect:"error"
   });
   if (!response.ok) throw new Error("Managed workflow execution is unavailable");
   const answer = await response.json();
   if (typeof answer.text !== "string" || typeof answer.isError !== "boolean")
    throw new Error("Managed workflow returned an invalid answer");
   if (answer.isError) throw new Error(answer.text);
   return answer;
  };
  await request(${JSON.stringify(new URL("/prepare", input.endpoint).href)});
  await nativeEffect.runPromise(context.ask({permission:"zerops_zerops_workflow",patterns:["*"],always:["*"],metadata:{action:JSON.parse(body).input.action}}), {signal:context.abort});
  const answer = await request(${JSON.stringify(input.endpoint)});
  return answer.text;
 }
})}});
`;
}

export class ManagedOpenCodeToolsError extends Schema.TaggedError<ManagedOpenCodeToolsError>()(
  "ManagedOpenCodeToolsError",
  { reason: Schema.Literal("configuration") },
) {}

/** The native process keeps its original HOME/config; only a private plugin is appended. */
export const makeManagedOpenCodeEnvironment = Effect.fn("makeManagedOpenCodeEnvironment")(
  function* (environment: NodeJS.ProcessEnv, execution: OpenCodeToolExecution) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "mate-opencode-tools-" });
    const nativeConfig =
      environment.XDG_CONFIG_HOME ??
      path.join(environment.HOME ?? process.env.HOME ?? "", ".config");
    const plugin = path.join(directory, "workflow.mjs");
    yield* fs.writeFileString(
      plugin,
      managedOpenCodePluginSource({
        endpoint: execution.url,
        token: execution.token,
        nativePackageRoot: path.join(nativeConfig, "opencode"),
      }),
      { mode: 0o600 },
    );
    const content = yield* Effect.try({
      try: () =>
        managedOpenCodeConfig(
          resolveOpenCodeConfigContent(environment),
          NodeURL.pathToFileURL(plugin).href,
        ),
      catch: () => new ManagedOpenCodeToolsError({ reason: "configuration" }),
    });
    return { ...environment, OPENCODE_CONFIG_CONTENT: content };
  },
);
