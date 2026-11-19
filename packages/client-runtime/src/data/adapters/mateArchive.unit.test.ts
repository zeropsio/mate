import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/reactivity";
import {
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  OrchestrationShellSnapshot,
} from "@t3tools/contracts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { makeArchiveReads, makeArchiveWire } from "./mateArchive.ts";
import { mateArchive } from "../projections/mateArchive.ts";

const decodeArchive = Schema.decodeUnknownSync(OrchestrationShellSnapshot);

const env = EnvironmentId.make("open");
const empty: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  updatedAt: "2026-10-07T00:00:00Z",
  projects: [],
  threads: [],
};
const shown = (store: AccountStore, ids = [env], connected = ids) =>
  mateArchive.derive(readsOfState(store.state()), { environmentIds: ids, connectedIds: connected });
const until = (store: AccountStore, predicate: () => boolean) =>
  new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    check();
  });

// witness: packages/client-runtime/src/data/adapters/mateArchive.ts | yield* signal(scope, { kind: "handshake" }); → yield* signal(scope, { kind: "handshake" }); yield* signal(scope, { kind: "baseline-committed" });
it("AD22: A Mate's archive not yet read is unknown, never the owner's empty archive", async () => {
  const atoms = AtomRegistry.make();
  const store = makeAccountStore(atoms);
  const beforeAnswer = Promise.withResolvers<ReturnType<typeof shown>>();
  const reads = makeArchiveReads(store, {
    read: () =>
      Effect.sync(() => {
        beforeAnswer.resolve(shown(store));
        return empty;
      }),
  });
  try {
    expect(shown(store)).toMatchObject({ snapshots: [], isLoading: true });
    expect(shown(store, [env], [])).toMatchObject({ snapshots: [], isLoading: false });
    const done = until(store, () => shown(store).snapshots.length === 1);
    reads.demand(env);
    expect(await beforeAnswer.promise).toMatchObject({ snapshots: [], isLoading: true });
    await done;
    expect(shown(store)).toMatchObject({
      snapshots: [{ environmentId: env, snapshot: empty }],
      isLoading: false,
    });
  } finally {
    reads.close();
    atoms.dispose();
  }
});

// witness: packages/client-runtime/src/data/adapters/mateArchive.ts | answer.failure.outcome === "authoritative-denial" → answer.failure.outcome === "access-unverified"
it("AD23: A denial withholds the archive held before without claiming it was deleted", async () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let denied = false;
  const reads = makeArchiveReads(store, {
    read: () =>
      !denied
        ? Effect.succeed(empty)
        : Effect.fail({ outcome: "authoritative-denial", message: "No longer allowed." }),
  });
  const first = until(store, () => shown(store).snapshots.length === 1);
  const release = reads.demand(env);
  await first;
  denied = true;
  const refused = until(store, () => shown(store).failures.length === 1);
  reads.again(env);
  await refused;
  expect(shown(store).snapshots).toEqual([]);
  expect(readsOfState(store.state()).fact("mateArchive", env)).toMatchObject({
    kind: "withheld",
    reason: "denied",
  });
  release();
  reads.close();
  registry.dispose();
});

function archiveRegistry(archived: OrchestrationShellSnapshot): EnvironmentRegistry["Service"] {
  return {
    run: (_id, effect) =>
      Effect.gen(function* () {
        const prepared = yield* SubscriptionRef.make(Option.some({ mateEngine: 1 }));
        const session = yield* SubscriptionRef.make(
          Option.some({
            client: {
              [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: () => Effect.succeed(empty),
              [WS_METHODS.engineGetArchivedShellSnapshot]: () => Effect.succeed(archived),
            },
          }),
        );
        return yield* effect.pipe(
          Effect.provideService(EnvironmentSupervisor, {
            target: { environmentId: env },
            prepared,
            session,
          } as never),
        );
      }),
  } as EnvironmentRegistry["Service"];
}

// witness: packages/client-runtime/src/data/adapters/mateArchive.ts | request(WS_METHODS.engineGetArchivedShellSnapshot, { → request("orchestration.getArchivedShellSnapshot", {
it("AD24: A conversation the engine archived appears in the archived list", async () => {
  const atoms = AtomRegistry.make();
  const store = makeAccountStore(atoms);
  const archived = decodeArchive({
    ...empty,
    snapshotSequence: 466,
    threads: [
      {
        id: "5a0345f1-1ab7-4b01-9fef-4410b3e16067",
        projectId: "gus",
        title: "Gus conversation",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: empty.updatedAt,
        updatedAt: empty.updatedAt,
        archivedAt: empty.updatedAt,
        settledOverride: null,
        settledAt: null,
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      },
    ],
  });
  const registry = archiveRegistry(archived);
  const reads = makeArchiveReads(store, makeArchiveWire(registry));
  try {
    const done = until(store, () => !shown(store).isLoading);
    reads.demand(env);
    await done;
    expect(
      shown(store).snapshots.flatMap(({ snapshot }) => snapshot.threads.map((thread) => thread.id)),
    ).toEqual(["5a0345f1-1ab7-4b01-9fef-4410b3e16067"]);
  } finally {
    reads.close();
    atoms.dispose();
  }
});
