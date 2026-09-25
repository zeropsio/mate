import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";

import {
  antigravityProfileDirectory,
  claudeEnvironment,
  claudeHomePath,
  codexHomeLayout,
} from "./driverHomes.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

it.layer(NodeServices.layer)("driverHomes", (it) => {
  describe("claudeHomePath / claudeEnvironment", () => {
    it.effect("the Claude home path defaults to ~/.claude when unconfigured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        expect(yield* claudeHomePath({ homePath: "" })).toBe(
          path.resolve(NodeOS.homedir(), ".claude"),
        );
      }),
    );

    it.effect(
      "the Claude environment sets CLAUDE_CONFIG_DIR to the configured home and leaves HOME untouched",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const resolved = path.resolve(NodeOS.homedir(), ".claude-work");
          const baseEnv = { HOME: "/original/home", PATH: "/usr/bin" };

          const env = yield* claudeEnvironment({ homePath: "~/.claude-work" }, baseEnv);

          expect(env.CLAUDE_CONFIG_DIR).toBe(resolved);
          expect(env.HOME).toBe("/original/home");
          expect(env.PATH).toBe("/usr/bin");
        }),
    );

    it.effect("leaves the environment untouched when no home override is configured", () =>
      Effect.gen(function* () {
        const baseEnv = { HOME: "/original/home" };
        expect(yield* claudeEnvironment({ homePath: "" }, baseEnv)).toBe(baseEnv);
      }),
    );
  });

  describe("antigravityProfileDirectory", () => {
    it("is a stable per-instance directory under the server's state directory", () => {
      const first = antigravityProfileDirectory("/state", ProviderInstanceId.make("antigravity"));
      expect(first.startsWith("/state/providers/antigravity/")).toBe(true);
      expect(antigravityProfileDirectory("/state", ProviderInstanceId.make("antigravity"))).toBe(
        first,
      );
      expect(
        antigravityProfileDirectory("/state", ProviderInstanceId.make("antigravity_work")),
      ).not.toBe(first);
    });
  });

  describe("codexHomeLayout", () => {
    it.effect("direct mode: no shadow home configured, sharedHomePath defaults to ~/.codex", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir(), ".codex");

        const layout = yield* codexHomeLayout(
          decodeCodexSettings({ homePath: "", shadowHomePath: "" }),
        );

        expect(layout.mode).toBe("direct");
        expect(layout.sharedHomePath).toBe(resolved);
        expect(layout.effectiveHomePath).toBeUndefined();
        expect(layout.continuationKey).toBe(`codex:home:${resolved}`);
      }),
    );

    it.effect(
      "authOverlay mode: a configured shadow home resolves to an effectiveHomePath distinct from sharedHomePath",
      () =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const sharedHomePath = path.resolve(NodeOS.homedir(), ".codex");
          const effectiveHomePath = path.resolve(NodeOS.homedir(), ".codex-shadow");

          const layout = yield* codexHomeLayout(
            decodeCodexSettings({ homePath: "", shadowHomePath: "~/.codex-shadow" }),
          );

          expect(layout.mode).toBe("authOverlay");
          expect(layout.sharedHomePath).toBe(sharedHomePath);
          expect(layout.effectiveHomePath).toBe(effectiveHomePath);
          expect(layout.effectiveHomePath).not.toBe(layout.sharedHomePath);
        }),
    );
  });
});
