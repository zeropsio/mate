/**
 * The per-turn workspace capture is gone (migration 062), and with it the deletion of a
 * conversation's snapshot refs. The refs it left under `refs/t3/checkpoints/` would hold their
 * objects in every repository it wrote to for good, so each start deletes them there — a Mate's
 * service checkouts, else the server's own folder — and git can collect the objects. A repository
 * already swept lists none; one that cannot be reached keeps its refs until a later start. A pool
 * container a thread's agent leased is that thread's, never swept.
 *
 * @module checkpointRefsSweep
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { isLeaseRepository, ZeropsRepositorySource } from "../zerops/ZeropsRepositorySource.ts";
import { VcsProcess } from "./VcsProcess.ts";

const CHECKPOINT_REFS = "refs/t3/checkpoints/";

/** Deletes the capture's refs in one repository; how many there were. */
export const removeCheckpointRefs = Effect.fn("checkpointRefsSweep.remove")(function* (
  cwd: string,
) {
  const vcs = yield* VcsProcess;
  const listed = yield* vcs.run({
    operation: "checkpointRefsSweep.list",
    command: "git",
    args: ["for-each-ref", "--format=%(refname)", CHECKPOINT_REFS],
    cwd,
    // A folder that is no repository holds none.
    allowNonZeroExit: true,
  });
  const refs = listed.stdout.split("\n").filter((ref) => ref.startsWith(CHECKPOINT_REFS));
  if (refs.length === 0) return 0;
  yield* vcs.run({
    operation: "checkpointRefsSweep.delete",
    command: "git",
    args: ["update-ref", "--stdin"],
    cwd,
    stdin: refs.map((ref) => `delete ${ref}\n`).join(""),
  });
  return refs.length;
});

/** Sweeps every repository the capture wrote to, each on its own; a failure leaves the others. */
export const sweepCheckpointRefs = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const listed = yield* (yield* ZeropsRepositorySource).list;
  const services =
    listed._tag === "available"
      ? listed.repositories.filter((repository) => !isLeaseRepository(repository))
      : [];
  const targets =
    services.length > 0 ? services.map((repository) => repository.mountPath) : [config.cwd];
  yield* Effect.forEach(
    targets,
    (cwd) =>
      removeCheckpointRefs(cwd).pipe(
        Effect.tap((removed) =>
          removed > 0
            ? Effect.logInfo("Removed the workspace capture's checkpoint refs.", { cwd, removed })
            : Effect.void,
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not remove the workspace capture's checkpoint refs.", {
            cwd,
            cause,
          }),
        ),
      ),
    { concurrency: "unbounded", discard: true },
  );
});

export const layer = Layer.effectDiscard(Effect.forkScoped(sweepCheckpointRefs));
