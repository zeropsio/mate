// @effect-diagnostics nodeBuiltinImport:off -- Native watch handles and inode timestamps identify daemon publications.
/** Watches the daemon's publication, including creation/replacement of its directory. No polling. */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

interface EndpointWatcher {
  readonly close: () => void;
  readonly onError: (listener: (error: Error) => void) => void;
}

export type WatchEndpoint = (
  path: string,
  change: (filename: string | null) => void,
) => EndpointWatcher;

const watchReal: WatchEndpoint = (path, change) => {
  const watcher = NodeFS.watch(path, (_event, filename) => change(filename));
  return {
    close: () => watcher.close(),
    onError: (listener) => {
      watcher.on("error", listener);
    },
  };
};

const isMissing = (error: unknown) => Predicate.isObject(error) && error.code === "ENOENT";
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const observeStreamPorts = (
  homeDir: string,
  watch: WatchEndpoint = watchReal,
): Stream.Stream<number | undefined, string> =>
  Stream.callback<number | undefined, string>((mailbox) =>
    Effect.gen(function* () {
      const directory = NodePath.join(homeDir, ".agent-browser");
      const file = NodePath.join(directory, "default.stream");
      let homeWatcher: EndpointWatcher | undefined;
      let directoryWatcher: EndpointWatcher | undefined;
      let directoryIdentity: string | undefined;
      let publication: string | undefined;
      const fail = (error: unknown) => Queue.failCauseUnsafe(mailbox, Cause.fail(reason(error)));
      const publish = () => {
        try {
          let nextPublication = "absent";
          let port: number | undefined;
          try {
            const descriptor = NodeFS.openSync(file, "r");
            let raw: string;
            let stat: NodeFS.BigIntStats;
            try {
              raw = NodeFS.readFileSync(descriptor, "utf8").trim();
              stat = NodeFS.fstatSync(descriptor, { bigint: true });
            } finally {
              NodeFS.closeSync(descriptor);
            }
            const parsed = Number(raw);
            if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536 && String(parsed) === raw)
              port = parsed;
            // Duplicate fs notifications describe one publication. An atomic replacement or
            // rewrite, even to the same port, is a new daemon endpoint lifecycle.
            nextPublication = `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${raw}`;
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          if (publication !== nextPublication) {
            publication = nextPublication;
            Queue.offerUnsafe(mailbox, port);
          }
        } catch (error) {
          fail(error);
        }
      };
      const attachDirectory = () => {
        try {
          let identity: string | undefined;
          try {
            const stat = NodeFS.statSync(directory, { bigint: true });
            identity = `${stat.dev}:${stat.ino}`;
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
          if (identity !== directoryIdentity) {
            directoryWatcher?.close();
            directoryWatcher = undefined;
            directoryIdentity = identity;
            if (identity !== undefined) {
              directoryWatcher = watch(directory, (filename) => {
                if (filename === null || filename === "default.stream") publish();
              });
              directoryWatcher.onError(fail);
            }
          }
          publish();
        } catch (error) {
          fail(error);
        }
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          directoryWatcher?.close();
          homeWatcher?.close();
        }),
      );
      yield* Effect.try({
        try: () => {
          // Observe the parent before the first read so late creation is never missed.
          homeWatcher = watch(homeDir, (filename) => {
            if (filename === null || filename === ".agent-browser") attachDirectory();
          });
          homeWatcher.onError(fail);
          attachDirectory();
        },
        catch: reason,
      });
    }),
  );
