import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** agy's own folder under the Gemini folder (`agy acp --app-data-dir`'s default). */
const APP_DATA = "antigravity-cli";
/** What a session writes: its conversation, its working folder, and their index. */
const SESSION_STATE = new Set([
  "conversations",
  "brain",
  "implicit",
  "conversation_summaries.db",
  "conversation_summaries.db-wal",
  "conversation_summaries.db-shm",
]);
/** The user's hooks, plugins and MCP servers; on a Mate it names zcp's MCP server. */
const CONFIG = "config";
const NO_MCP_SERVERS = '{"mcpServers":{}}\n';

/**
 * A Gemini folder of a helper's own (`agy acp --gemini-dir`), for a run that must touch nothing
 * and leave nothing behind: the model catalog's check and text generation. agy's sign-in and
 * settings are linked from the user's; its conversations start empty and go with the scope, so
 * none lands in the person's history; its configuration is a fresh one with no MCP servers and
 * no hooks. Gone with its scope: the links go, never what they point at.
 */
export const isolatedAntigravityGeminiDirectory = Effect.fn("isolatedAntigravityGeminiDirectory")(
  function* (geminiHome: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const isolated = yield* fs.makeTempDirectoryScoped({ prefix: "t3-antigravity-gemini-" });
    const entriesOf = (directory: string) =>
      fs.readDirectory(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const entry of yield* entriesOf(geminiHome)) {
      if (entry === CONFIG || entry === APP_DATA) continue;
      yield* fs.symlink(path.join(geminiHome, entry), path.join(isolated, entry));
    }
    yield* fs.makeDirectory(path.join(isolated, APP_DATA));
    for (const entry of yield* entriesOf(path.join(geminiHome, APP_DATA))) {
      if (SESSION_STATE.has(entry)) continue;
      yield* fs.symlink(
        path.join(geminiHome, APP_DATA, entry),
        path.join(isolated, APP_DATA, entry),
      );
    }
    yield* fs.makeDirectory(path.join(isolated, CONFIG));
    yield* fs.writeFileString(path.join(isolated, CONFIG, "mcp_config.json"), NO_MCP_SERVERS);
    return isolated;
  },
);
