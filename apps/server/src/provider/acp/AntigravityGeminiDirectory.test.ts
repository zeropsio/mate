import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { isolatedAntigravityGeminiDirectory } from "./AntigravityGeminiDirectory.ts";

it.layer(NodeServices.layer)("isolatedAntigravityGeminiDirectory", (it) => {
  it.effect(
    "keeps agy's login and settings, starts with no conversations or MCP servers, and goes with its scope",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-gemini-home-" });
        const app = path.join(home, "antigravity-cli");
        yield* fs.makeDirectory(path.join(app, "conversations"), { recursive: true });
        yield* fs.makeDirectory(path.join(app, "brain"), { recursive: true });
        yield* fs.makeDirectory(path.join(home, "config"), { recursive: true });
        yield* fs.writeFileString(path.join(app, "antigravity-oauth-token"), "token");
        yield* fs.writeFileString(path.join(app, "settings.json"), "{}");
        yield* fs.writeFileString(path.join(app, "conversation_summaries.db"), "history");
        yield* fs.writeFileString(path.join(app, "conversations", "a.pb"), "conversation");
        const servers = '{"mcpServers":{"zerops":{"command":"zcp"}}}';
        yield* fs.writeFileString(path.join(home, "config", "mcp_config.json"), servers);

        const isolated = yield* Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* isolatedAntigravityGeminiDirectory(home);
            const own = path.join(directory, "antigravity-cli");
            expect(yield* fs.readLink(path.join(own, "antigravity-oauth-token"))).toBe(
              path.join(app, "antigravity-oauth-token"),
            );
            expect(yield* fs.readFileString(path.join(own, "settings.json"))).toBe("{}");
            expect((yield* fs.readDirectory(own)).toSorted()).toEqual([
              "antigravity-oauth-token",
              "settings.json",
            ]);
            expect(
              JSON.parse(
                yield* fs.readFileString(path.join(directory, "config", "mcp_config.json")),
              ),
            ).toEqual({ mcpServers: {} });
            return directory;
          }),
        );

        expect(yield* fs.exists(isolated)).toBe(false);
        expect(yield* fs.readFileString(path.join(app, "antigravity-oauth-token"))).toBe("token");
        expect(yield* fs.readFileString(path.join(app, "conversations", "a.pb"))).toBe(
          "conversation",
        );
        expect(yield* fs.readFileString(path.join(home, "config", "mcp_config.json"))).toBe(
          servers,
        );
      }).pipe(Effect.scoped),
  );
});
