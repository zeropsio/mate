// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";

// Directory notifications discover creation/replacement; the file's own watcher
// observes appends, which need not produce another directory notification.
export const waitForFileContent = (
  filePath: string,
  accepts: (content: string) => boolean = (content) => content.trim().length > 0,
) =>
  Effect.callback<string>((resume) => {
    let closed = false;
    let fileWatcher: NodeFS.FSWatcher | undefined;
    const read = () => {
      if (closed) return;
      void NodeFSP.readFile(filePath, "utf8").then(
        (content) => {
          if (closed) return;
          try {
            if (accepts(content)) resume(Effect.succeed(content));
          } catch (error) {
            resume(Effect.die(error));
          }
        },
        (error: NodeJS.ErrnoException) => {
          if (!closed && error.code !== "ENOENT") resume(Effect.die(error));
        },
      );
    };
    const watchFile = (): void => {
      if (closed) return;
      fileWatcher?.close();
      fileWatcher = undefined;
      try {
        fileWatcher = NodeFS.watch(filePath, (event) => {
          if (event === "rename") watchFile();
          read();
        });
        fileWatcher.on("error", (error) => resume(Effect.die(error)));
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return;
        resume(Effect.die(error));
      }
    };
    const directoryWatcher = NodeFS.watch(NodePath.dirname(filePath), (_event, filename) => {
      if (filename !== null && filename.toString() !== NodePath.basename(filePath)) return;
      watchFile();
      read();
    });
    directoryWatcher.on("error", (error) => resume(Effect.die(error)));
    watchFile();
    read();
    return Effect.sync(() => {
      closed = true;
      fileWatcher?.close();
      directoryWatcher.close();
    });
  });
