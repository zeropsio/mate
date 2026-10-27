/**
 * Puts `mac` on every agent's PATH inside a Zerops container: a script in
 * `~/.local/bin` (first on the container's PATH) that runs this server's own
 * `mate mac`. Written at startup through the path the server was started
 * with, so it follows the installed version's `current` link. A failure only
 * costs agents the command, so it is logged, never fatal.
 *
 * @module MacCommandShim
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config.ts";
import { isZeropsEnvironment } from "../ZeropsEnvironment.ts";
import { shellQuote } from "./MacHost.ts";

/** Every word goes after `--`, so agent-device flags pass through the CLI parser untouched. */
export const renderMacCommandShim = (nodePath: string, entryPath: string): string =>
  `#!/bin/sh\n# Zerops Mate: work on the Mac paired with this Mate. Run: mac help\nexec ${shellQuote(nodePath)} ${shellQuote(entryPath)} mac -- "$@"\n`;

export const installMacCommandShim = Effect.fn("MacCommandShim.install")(function* (input: {
  readonly homeDir: string;
  readonly nodePath: string;
  readonly entryPath: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(input.homeDir, ".local", "bin");
  const target = path.join(dir, "mac");
  const content = renderMacCommandShim(input.nodePath, input.entryPath);
  const current = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => ""));
  if (current === content) return;
  yield* fs.makeDirectory(dir, { recursive: true });
  yield* fs.writeFileString(target, content);
  yield* fs.chmod(target, 0o755);
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const entryPath = process.argv[1];
    if (!isZeropsEnvironment(config) || !entryPath) return;
    yield* installMacCommandShim({
      homeDir: config.homeDir,
      nodePath: process.execPath,
      entryPath,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not put the mac command on the agents' PATH", cause),
    ),
  ),
);
