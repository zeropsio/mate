import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type ClaudeSettings,
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { isHostWindows } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeProviderInstanceRegistry } from "../Layers/ProviderInstanceRegistryLive.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import * as ModelManifest from "../ModelManifest.ts";
import { ClaudeDriver } from "./ClaudeDriver.ts";

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "claude-driver-refresh-test",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  // No background refresh: every probe in this test is one the test asked for.
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
      ),
    ),
  ),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  Layer.provideMerge(ModelManifest.layerTest),
);

const claudeConfig = (binaryPath: string, homePath: string): ClaudeSettings => ({
  enabled: true,
  binaryPath,
  homePath,
  customModels: [],
  launchArgs: "",
  autoCompactWindow: "",
});

/**
 * A `claude` that answers `initialize` with whichever account the sibling
 * `account-email` file names at spawn time — a sign-in between two probes.
 */
const writeFakeClaude = Effect.fn("ClaudeDriverRefresh.test.writeFakeClaude")(function* (
  dir: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const binaryPath = path.join(dir, "claude");
  yield* fileSystem.writeFileString(
    binaryPath,
    [
      "#!/usr/bin/env node",
      'import * as NodeFs from "node:fs";',
      'import * as NodeReadline from "node:readline";',
      'if (process.argv.includes("--version")) {',
      '  process.stdout.write("claude 2.1.219\\n");',
      "  process.exit(0);",
      "}",
      'const email = NodeFs.readFileSync(new URL("./account-email", import.meta.url), "utf8").trim();',
      "const lines = NodeReadline.createInterface({ input: process.stdin });",
      'lines.on("line", (line) => {',
      "  const message = JSON.parse(line);",
      '  if (message.type !== "control_request" || message.request?.subtype !== "initialize") return;',
      "  process.stdout.write(JSON.stringify({",
      '    type: "control_response",',
      "    response: {",
      '      subtype: "success",',
      "      request_id: message.request_id,",
      "      response: {",
      "        commands: [], agents: [], models: [],",
      '        output_style: "default", available_output_styles: ["default"],',
      '        account: { email, subscriptionType: "pro", tokenSource: "oauth" },',
      "      },",
      "    },",
      '  }) + "\\n");',
      "});",
      "setInterval(() => {}, 1_000);",
      "",
    ].join("\n"),
  );
  yield* fileSystem.chmod(binaryPath, 0o755);
  return binaryPath;
});

describe("ClaudeDriver refresh", () => {
  it.live("an explicit refresh re-reads the account instead of the cached capabilities", () =>
    Effect.gen(function* () {
      if (yield* isHostWindows) return;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "claude-driver-refresh-" });
      const homePath = path.join(dir, "claude-home");
      yield* fileSystem.makeDirectory(homePath);
      const accountFile = path.join(dir, "account-email");
      yield* fileSystem.writeFileString(accountFile, "before@example.com");
      const binaryPath = yield* writeFakeClaude(dir);

      const instanceId = ProviderInstanceId.make("claude_refresh");
      const configMap: ProviderInstanceConfigMap = {
        [instanceId]: {
          driver: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          config: claudeConfig(binaryPath, homePath),
        },
      };
      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [ClaudeDriver],
        configMap,
      });
      const claude = yield* registry.getInstance(instanceId);
      expect(claude).toBeDefined();

      const first = yield* claude!.snapshot.refresh;
      expect(first.auth).toMatchObject({ status: "authenticated", email: "before@example.com" });

      yield* fileSystem.writeFileString(accountFile, "after@example.com");
      const second = yield* claude!.snapshot.refresh;
      expect(second.auth).toMatchObject({ status: "authenticated", email: "after@example.com" });
    }).pipe(Effect.provide(testLayer)),
  );
});
