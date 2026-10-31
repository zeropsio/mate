import type { HqRemoteProbe } from "@t3tools/shared/hqChanges";
import { captureAccountLifetime } from "./accountLifetime";
import { platformMembership, readsOfState } from "@t3tools/client-runtime/data";
/**
 * The account's operations: one coordinator per account store and session client, with Zerops
 * and the organization's official HQ wired as the owners of their kinds. A verb submits an intent here and reads where it stands through
 * the operation's progress projection; it never calls the platform itself.
 */
import {
  creationSteps,
  mateRegistration,
  registrationRequestId,
  accountReadsAtom,
  makeOperations,
  makeHqExecutor,
  makeZeropsExecutor,
  recordedEnvironment,
  recordedMoveRemainder,
  type MoveRemainder,
  runToEnd,
  type RunToEnd,
  operationEnd,
  operationProgress,
  type AccountStore,
  type CreationRead,
  type DetailDemand,
  type OperationEnd,
  type OperationProgress,
  type Operations,
  type HqGitCandidateIntent,
} from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/reactivity";
import { createContext, useContext } from "react";

import { randomUUID } from "~/lib/utils";

import { hqProjectIdOf, hqWritesOf } from "./hqWrites";
import type { ZeropsSessionValue } from "./ZeropsSessionProvider";

type SessionClient = ZeropsSessionValue["client"];

export interface AccountOperations {
  /** Records and sends one intent; resolves with where it stands once its owner has answered. */
  readonly submit: (
    intent: Parameters<Operations["submit"]>[0],
    requestId?: string,
  ) => Promise<{
    readonly requestId: string;
    readonly progress: OperationProgress;
    /** What the owner said of how it ended, once it has; `null` before. */
    readonly evidence: string | null;
  }>;
  /**
   * Asks the owner again after a lost answer — by its facts where it keeps no ids: never a send.
   * What it cannot tell yet stays uncertain.
   */
  readonly askAgain: (requestId: string) => Promise<void>;
  /** Resolves once the operation is final for now, or can no longer be followed (`operationEnd`). */
  readonly untilEnd: (requestId: string, orgId: string) => Promise<NonNullable<OperationEnd>>;
  /** Runs one intent to its end: its owner's result, or what stopped it (`runToEnd`). */
  readonly run: RunToEnd;
  /** Candidate plaintext goes directly to the executor, never the recorded intent. */
  readonly runGitCandidate?: (
    intent: HqGitCandidateIntent,
    token: string,
  ) => Promise<HqRemoteProbe>;
  readonly readProgress: (requestId: string) => OperationProgress;
  readonly untilMoveRemainder: (
    key: Parameters<typeof recordedMoveRemainder.derive>[1],
  ) => Promise<MoveRemainder>;
  /**
   * The environment HQ's navigation records for a project attached to `appId`, once it does:
   * its name, and whether HQ holds a key that works. Rejects with what stops the wait.
   */
  readonly untilEnvironment: (
    orgId: string,
    appId: string,
    projectId: string,
  ) => Promise<{ readonly name: string; readonly keyed: boolean; readonly declaration: string }>;
  /** Where a creation's steps stand now, read off their operations (`creationSteps`). */
  readonly readCreation: (orgId: string, creationId: string) => CreationRead;
}

/** What an HQ write says where its effect can no longer be followed in HQ's navigation. */
export const HQ_UNFOLLOWED = "HQ isn't answering. HQ may have taken it anyway.";

/** What a wait on HQ's navigation says once HQ's link observes nothing more. */
const HQ_UNOBSERVED = "HQ isn't answering.";

const coordinators = new WeakMap<AccountStore, WeakMap<SessionClient, AccountOperations>>();

export function accountOperations(
  store: AccountStore,
  registry: AtomRegistry.AtomRegistry,
  client: SessionClient,
  demandDetail: (demand: DetailDemand) => () => void,
  revalidate: (demand: DetailDemand) => void,
  readDetail: (demand: DetailDemand) => Promise<boolean>,
): AccountOperations {
  let byClient = coordinators.get(store);
  if (byClient === undefined) {
    byClient = new WeakMap();
    coordinators.set(store, byClient);
  }
  const held = byClient.get(client);
  if (held !== undefined) return held;
  // A browser without Web Locks has its project record writes serialized within the page only.
  const locks: LockManager | undefined = globalThis.navigator?.locks;
  const hqExecutor = makeHqExecutor({
    apiOf: hqWritesOf,
    zerops: client,
    active: captureAccountLifetime(),
    hqProjectIdOf,
    gitStore: store,
  });
  const operations = makeOperations({
    store,
    executors: {
      hq: hqExecutor,
      zerops: makeZeropsExecutor({
        client,
        viewerOf: (orgId) => platformMembership.derive(readsOfState(store.state()), orgId).viewer,
        active: captureAccountLifetime(),
        readDetail,
        store,
        registry,
        demandDetail,
        revalidate: (orgId, demand) => {
          if (registry.get(accountReadsAtom)?.orgId === orgId) revalidate(demand);
        },
        nowMs: () => Date.now(),
        makeId: randomUUID,
        run: (intent, options) => run(intent, options),
        ...(locks === undefined ? {} : { locks }),
      }),
    },
    makeId: randomUUID,
  });
  const runStep = runToEnd({ operations, store, registry });
  const run: RunToEnd = (intent, options) => {
    const projectId =
      intent.kind === "create-mate-record"
        ? intent.mate.projectId
        : intent.kind === "attach-project" && intent.attach.kind === "mate"
          ? intent.attach.projectId
          : intent.kind === "bind-birth"
            ? intent.projectId
            : null;
    if (options.requestId !== undefined)
      return Effect.runPromise(operations.retry(options.requestId)).then(() =>
        runStep(intent, options),
      );
    if (projectId === null) return runStep(intent, options);
    const key = { orgId: options.orgId, projectId };
    const current = registry.get(store.data.project(mateRegistration, key));
    return runStep(intent, {
      ...options,
      requestId: registrationRequestId(key, current.attempt + 1),
    });
  };
  const untilEnd = (requestId: string, orgId: string) =>
    new Promise<NonNullable<OperationEnd>>((resolve) => {
      const atom = store.data.project(operationEnd, { requestId, orgId });
      let cancel: () => void = () => {};
      cancel = registry.subscribe(
        atom,
        (end) => {
          if (end === null) return;
          resolve(end);
          cancel();
        },
        { immediate: true },
      );
    });
  const untilEnvironment: AccountOperations["untilEnvironment"] = (orgId, appId, projectId) =>
    new Promise((resolve, reject) => {
      let ended = false;
      let cancel: (() => void) | undefined;
      cancel = registry.subscribe(
        store.data.project(recordedEnvironment, { orgId, appId, projectId }),
        (recorded) => {
          if (ended || recorded.kind === "waiting") return;
          ended = true;
          if (recorded.kind === "recorded")
            resolve({
              name: recorded.name,
              keyed: recorded.keyed,
              declaration: recorded.declaration,
            });
          else reject(new Error(recorded.kind === "refused" ? recorded.reason : HQ_UNOBSERVED));
          cancel?.();
        },
        { immediate: true },
      );
      if (ended) cancel();
    });
  const made: AccountOperations = {
    readProgress: (requestId) => registry.get(store.data.project(operationProgress, requestId)),
    untilMoveRemainder: (key) =>
      new Promise((resolve, reject) => {
        let ended = false;
        let cancel: (() => void) | undefined;
        cancel = registry.subscribe(
          store.data.project(recordedMoveRemainder, key),
          (value) => {
            if (ended || value.kind === "checking" || value.kind === "waiting") return;
            ended = true;
            if (value.kind === "unobserved" || value.kind === "withheld")
              reject(
                new Error("HQ must confirm the original Move before its project can be renamed."),
              );
            else resolve(value);
            cancel?.();
          },
          { immediate: true },
        );
        if (ended) cancel();
      }),
    untilEnd,
    untilEnvironment,
    readCreation: (orgId, creationId) =>
      registry.get(store.data.project(creationSteps, { orgId, creationId })),
    run,
    runGitCandidate: async (intent, token) => {
      const requestId = randomUUID();
      const submitted = Effect.runPromise(
        hqExecutor.submitGitCandidate(operations, requestId, intent, token),
      );
      token = "";
      await submitted;
      // The same request is already recorded: runToEnd follows it without resending.
      if (intent.kind === "probe-git-remote")
        return runStep(intent, { orgId: intent.orgId, requestId, unobserved: HQ_UNFOLLOWED });
      const result = await runStep(intent, {
        orgId: intent.orgId,
        requestId,
        unobserved: HQ_UNFOLLOWED,
      });
      return result.probe;
    },
    askAgain: (requestId) => Effect.runPromise(operations.retry(requestId)),
    submit: async (intent, named) => {
      const requestId = await Effect.runPromise(operations.submit(intent, named));
      const outcome = store.state().operations.get(requestId)?.receipt?.outcome;
      return {
        requestId,
        progress: registry.get(store.data.project(operationProgress, requestId)),
        evidence: outcome === undefined || outcome.kind === "pending" ? null : outcome.evidence,
      };
    },
  };
  byClient.set(client, made);
  return made;
}

/** The mounted account's operations, which its data mount builds over the store it owns. */
export const AccountOperationsContext = createContext<AccountOperations | null>(null);

/** The operations, where the account's data is held; `null` outside it (a harness, a test). */
export function useAccountOperationsOptional(): AccountOperations | null {
  return useContext(AccountOperationsContext);
}

export function useAccountOperations(): AccountOperations {
  const operations = useContext(AccountOperationsContext);
  if (operations === null)
    throw new Error("useAccountOperations must be used inside ZeropsAccountData.");
  return operations;
}
