import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ZeropsApiError } from "../../../zerops/api.ts";
import { HQ_BIRTH_START, type HqBirthDeps } from "../../../zerops/hq/birth.ts";
import { birthSnapshot, HQ_BIRTH_RECORD_KEY } from "../../../zerops/hq/birthJournal.ts";
import { hqBirthProgress, hqBirthRequestId } from "../../projections/hqBirthProgress.ts";
import { operationProgress } from "../../projections/operation.ts";
import { makeAccountStore, readsOfState } from "../../store.ts";
import { makeOperations } from "../coordinator.ts";
import { hqProvisionExecutor } from "./hqProvision.ts";

const orgId = "org";
const notCalled = () => Promise.reject(new Error("Unexpected birth step"));

function setup(uncertain = false) {
  const store = makeAccountStore(AtomRegistry.make());
  const stopped = {
    step: "deploy",
    reason: uncertain ? "Zerops can no longer be followed here." : "Insufficient credit",
    uncertain,
  } as const;
  const record = {
    ...HQ_BIRTH_START,
    step: "deploy" as const,
    projectId: "hq",
    importId: "birth",
    serviceId: "service",
    stopped,
  };
  let marked = false;
  let markedError: Error | null = null;
  const calls: string[] = [];
  const env = new Map([[HQ_BIRTH_RECORD_KEY, birthSnapshot(record)]]);
  const deps: HqBirthDeps = {
    run: async (intent) => {
      calls.push(intent.kind);
      if (intent.kind !== "hq-birth-note") throw new Error("Unexpected birth write");
      env.set(intent.key, intent.content);
      return undefined as never;
    },
    reads: {
      journal: async () => env,
      births: async () => ({ underway: [{ projectId: "hq", record }], unrecorded: false }),
      markedHq: async () => {
        if (markedError !== null) throw markedError;
        return marked
          ? { kind: "official", projectId: "hq", address: "https://hq.example" }
          : { kind: "none" };
      },
    },
    waits: { untilServices: notCalled, untilZone: notCalled, untilProcessEnds: notCalled },
    now: () => 0,
    newBirthId: () => "claim",
  };
  const submit = hqProvisionExecutor({ store, deps });
  const operations = makeOperations({
    store,
    executors: {
      zerops: {
        submit: (id, intent) =>
          intent.kind === "hq-birth" ? submit(id, intent) : Effect.die("Unexpected intent"),
      },
    },
    makeId: () => hqBirthRequestId(orgId, 1),
  });
  return {
    store,
    operations,
    calls,
    loseMarkedRead: (error: Error) => {
      markedError = error;
    },
    mark: () => {
      marked = true;
    },
  };
}

describe("HQ setup operation", () => {
  it.effect("losing the official-HQ read leaves its outcome unknown without birth writes", () =>
    Effect.gen(function* () {
      const { store, operations, calls, loseMarkedRead } = setup();
      loseMarkedRead(new ZeropsApiError("Zerops could not be reached.", "network"));
      yield* operations.submit({
        kind: "hq-birth",
        orgId,
        zeropsApi: "https://api.example",
        again: false,
      });
      const read = readsOfState(store.state());
      expect(operationProgress.derive(read, hqBirthRequestId(orgId, 1))).toMatchObject({
        stage: "unresolved",
        nextActor: "person",
      });
      expect(read.operation(hqBirthRequestId(orgId, 1))?.receipt?.outcome).toEqual({
        kind: "pending",
      });
      expect(calls).toEqual([]);
    }),
  );
  it.effect("an unobservable setup stays unresolved and names its recovery action", () =>
    Effect.gen(function* () {
      const { store, operations, calls } = setup(true);
      yield* operations.submit({
        kind: "hq-birth",
        orgId,
        zeropsApi: "https://api.example",
        again: false,
      });
      const read = readsOfState(store.state());
      expect(operationProgress.derive(read, hqBirthRequestId(orgId, 1))).toMatchObject({
        stage: "unresolved",
        nextActor: "person",
        nextAction: "Press Again to read HQ's setup journal.",
      });
      expect(read.operation(hqBirthRequestId(orgId, 1))?.receipt?.outcome).toEqual({
        kind: "pending",
      });
      yield* operations.retry(hqBirthRequestId(orgId, 1));
      expect(calls).toEqual(["hq-birth-note", "hq-birth-note"]);
    }),
  );
  it.effect("a fresh gate reads a journal's refusal and never retries its write", () =>
    Effect.gen(function* () {
      const { store, operations, calls } = setup();
      yield* operations.submit({
        kind: "hq-birth",
        orgId,
        zeropsApi: "https://api.example",
        again: false,
      });
      expect(hqBirthProgress.derive(readsOfState(store.state()), orgId)).toMatchObject({
        running: false,
        failed: { reason: "Insufficient credit", step: "deploy" },
      });
      expect(calls).toEqual(["hq-birth-note", "hq-birth-note"]);
      yield* operations.retry(hqBirthRequestId(orgId, 1));
      expect(calls).toEqual(["hq-birth-note", "hq-birth-note"]);
    }),
  );

  it.effect("an already official HQ ends the operation without running birth writes", () =>
    Effect.gen(function* () {
      const { store, operations, calls, mark } = setup();
      mark();
      yield* operations.submit({
        kind: "hq-birth",
        orgId,
        zeropsApi: "https://api.example",
        again: true,
      });
      expect(hqBirthProgress.derive(readsOfState(store.state()), orgId)).toMatchObject({
        record: { step: "done" },
        running: false,
        failed: null,
      });
      expect(calls).toEqual([]);
    }),
  );
});
