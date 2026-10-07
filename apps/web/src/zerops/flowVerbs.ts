/**
 * The verbs that move an application's flow — release, roll back, merge, close, run a deploy again,
 * add a service — each the account's operation, which the organization's official HQ executes as
 * the person (`flowWrites.ts`). A verb stays pending from its press until HQ's records show its
 * end, or HQ's link can no longer follow it: a second press meanwhile is answered that the first is
 * on its way, and nothing is sent twice. What HQ refused is said where the verbs are, until the
 * next verb. The account holds both, in memory, for every surface that draws the verbs.
 */
import { RegistryContext } from "@effect/atom-react";
import { flowAnswer, type FlowWriteIntent } from "@t3tools/client-runtime/data";
import { flowVerbKey, type FlowVerb } from "@t3tools/client-runtime/zerops";
import { HQ_WRITE_UNCERTAIN, hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { useAccountOperations, type AccountOperations } from "./accountOperations";
import type { ZeropsProjectFlow } from "./projectFlows";
import { useAccountDataOptional } from "./ZeropsAccountData";

/**
 * How a verb went, for the surface it was pressed on: the review stays open and says what
 * happened (pass 16, R6). A refusal carries the sentence `trouble` says too.
 */
export type FlowVerbOutcome =
  /**
   * Taken; a release and a roll back name the tag they made, which their review follows. A verb that
   * asked for deploys carries where HQ answered they stand; none where its answer was lost and HQ's
   * records showed it — HQ's navigation brings the jobs either way.
   */
  | {
      readonly ok: true;
      readonly tag?: string | undefined;
      readonly deploys?: HqDeployAnswer | undefined;
    }
  | { readonly ok: false; readonly reason: string };

export interface FlowVerbs {
  /** The verbs on their way, by `flowVerbKey`: a row shows its own and takes no second press. */
  readonly pending: ReadonlySet<string>;
  /** What the last verb's refusal said, until the next verb. */
  readonly trouble: string | null;
  /**
   * A release of what the flow's offer shows: its `entries`, named its chosen tag (the next patch
   * by default), tagging the `groupHead` it was read with.
   */
  readonly release: (flow: ZeropsProjectFlow, tag?: string) => Promise<FlowVerbOutcome>;
  /** A new release listing an earlier release's entries (guide 5.6). */
  readonly rollBack: (flow: ZeropsProjectFlow, tag: string) => Promise<FlowVerbOutcome>;
  /**
   * A change squashed into `main`, if its head is still `expectedHead` — the head its review
   * showed; none shown, HQ is not asked.
   */
  readonly merge: (
    groupId: string,
    change: { readonly repository: string; readonly number: number },
    expectedHead: string | undefined,
  ) => Promise<FlowVerbOutcome>;
  /** A change closed without merging, only at the head the person reviewed. */
  readonly close: (
    groupId: string,
    change: { readonly repository: string; readonly number: number },
    expectedHead: string | null,
  ) => Promise<FlowVerbOutcome>;
  /**
   * "Run again": the environment `projectId`'s newest deploy of `service`, at `sha`, asked again;
   * on its way until HQ's navigation brings a newer job than `after`.
   */
  readonly redeploy: (
    flow: ZeropsProjectFlow,
    projectId: string,
    deploy: { readonly service: string; readonly sha: string; readonly after: string },
  ) => Promise<FlowVerbOutcome>;
  /** "Add <service>": a service the environment's tier declares and its project lacks. */
  readonly addService: (
    flow: ZeropsProjectFlow,
    projectId: string,
    service: string,
  ) => Promise<FlowVerbOutcome>;
}

/** What a second press of a verb that is still on its way says: the first one is the one that counts. */
export const VERB_ALREADY_RUNNING = "It is already on its way.";
/** What a merge refused for a head nobody was shown says: HQ's own words for it. */
const HEAD_NOT_SHOWN = hqRefusalWords({ code: "conflict", reason: "head_moved" });
/** What a verb says when its project's flow has not been read at all. */
const NOT_READ_YET = "This project has not been read yet.";
/** What a release says while the recipe has nothing on `main` to tag: HQ's own words for it. */
const NO_GROUP_MAIN = hqRefusalWords({ code: "conflict", reason: "no_group_main" });

const refused = (reason: string): FlowVerbOutcome => ({ ok: false, reason });

/** The verbs on their way and the last refusal, for one account's operations. */
interface Board {
  pending: ReadonlySet<string>;
  trouble: string | null;
  readonly listeners: Set<() => void>;
}

const boards = new WeakMap<AccountOperations, Board>();

function boardOf(operations: AccountOperations): Board {
  let board = boards.get(operations);
  if (board === undefined) {
    board = { pending: new Set(), trouble: null, listeners: new Set() };
    boards.set(operations, board);
  }
  return board;
}

function publish(board: Board, change: Partial<Pick<Board, "pending" | "trouble">>): void {
  Object.assign(board, change);
  for (const listener of board.listeners) listener();
}

export function useFlowVerbs(): FlowVerbs {
  const operations = useAccountOperations();
  const account = useAccountDataOptional();
  const registry = useContext(RegistryContext);
  const orgId = account?.orgId ?? null;
  const data = account?.data;
  const board = boardOf(operations);
  const subscribe = useCallback(
    (listener: () => void) => {
      board.listeners.add(listener);
      return () => {
        board.listeners.delete(listener);
      };
    },
    [board],
  );
  const pending = useSyncExternalStore(subscribe, () => board.pending);
  const trouble = useSyncExternalStore(subscribe, () => board.trouble);

  /**
   * Sends the verb's intent as the account's operation, the verb on its way from the press until
   * its end. HQ's refusal is handed back in its words — and said where the verbs are, for a verb
   * whose refusal `says` — and its answer is the outcome.
   */
  const run = useCallback(
    async (
      verb: FlowVerb,
      intent: (orgId: string) => FlowWriteIntent,
      says: boolean,
    ): Promise<FlowVerbOutcome> => {
      if (orgId === null || data === undefined) return refused(NOT_READ_YET);
      const key = flowVerbKey(verb);
      if (board.pending.has(key)) return refused(VERB_ALREADY_RUNNING);
      publish(board, { pending: new Set(board.pending).add(key) });
      const done = () => {
        const next = new Set(board.pending);
        next.delete(key);
        publish(board, { pending: next });
      };
      const { requestId, progress } = await operations.submit(intent(orgId)).catch((cause) => {
        done();
        throw cause;
      });
      const reason =
        progress.stage === "refused"
          ? progress.reason
          : progress.stage === "unsent"
            ? (progress.reason ?? "HQ could not be reached.")
            : progress.stage === "uncertain"
              ? HQ_WRITE_UNCERTAIN
              : null;
      // Nothing was taken: nothing is on its way.
      if (progress.stage === "refused" || progress.stage === "unsent") done();
      else void operations.untilEnd(requestId, orgId).then(done);
      if (reason !== null) {
        if (says) publish(board, { trouble: reason });
        return refused(reason);
      }
      if (says) publish(board, { trouble: null });
      const answer = registry.get(data.project(flowAnswer, requestId));
      return { ok: true, tag: answer?.tag, deploys: answer?.deploys };
    },
    [board, data, operations, orgId, registry],
  );

  /** Says a refusal decided before anything is sent, where the verbs are. */
  const refuse = useCallback(
    (reason: string): FlowVerbOutcome => {
      publish(board, { trouble: reason });
      return refused(reason);
    },
    [board],
  );

  const release = useCallback(
    (flow: ZeropsProjectFlow, tag?: string): Promise<FlowVerbOutcome> => {
      const offer = flow.release;
      if (!offer.gate.allowed) return Promise.resolve(refused(offer.gate.reason));
      const { groupHead } = offer;
      if (groupHead === undefined) return Promise.resolve(refuse(NO_GROUP_MAIN));
      return run(
        { kind: "release", groupId: flow.groupId },
        (orgId) => ({
          kind: "release",
          orgId,
          appId: flow.groupId,
          tag: tag ?? offer.suggestion,
          groupHead,
          entries: offer.entries.map(({ service, commit }) => ({ service, sha: commit })),
        }),
        true,
      );
    },
    [refuse, run],
  );

  const rollBack = useCallback(
    (flow: ZeropsProjectFlow, earlier: string): Promise<FlowVerbOutcome> => {
      const groupHead = flow.repos?.find((repo) => repo.name === RECIPE_REPO)?.mainHead;
      if (groupHead == null) return Promise.resolve(refuse(NO_GROUP_MAIN));
      return run(
        { kind: "roll-back", groupId: flow.groupId, tag: earlier },
        (orgId) => ({ kind: "roll-back", orgId, appId: flow.groupId, tag: earlier, groupHead }),
        true,
      );
    },
    [refuse, run],
  );

  const merge = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
      expectedHead: string | undefined,
    ): Promise<FlowVerbOutcome> => {
      // Only the head whose change was shown: one nobody saw is never merged, and HQ is not asked.
      if (expectedHead === undefined) return Promise.resolve(refused(HEAD_NOT_SHOWN));
      const link: ChangeLink = { appId: groupId, repo: change.repository, number: change.number };
      return run(
        { kind: "merge", groupId, ...change },
        (orgId) => ({ kind: "merge-change", orgId, link, expectedHead }),
        false,
      );
    },
    [run],
  );

  const close = useCallback(
    (
      groupId: string,
      change: { readonly repository: string; readonly number: number },
      expectedHead: string | null,
    ): Promise<FlowVerbOutcome> => {
      const link: ChangeLink = { appId: groupId, repo: change.repository, number: change.number };
      return run(
        { kind: "close", groupId, ...change },
        (orgId) => ({ kind: "close-change", orgId, link, expectedHead }),
        false,
      );
    },
    [run],
  );

  const redeploy = useCallback(
    (
      flow: ZeropsProjectFlow,
      projectId: string,
      deploy: { readonly service: string; readonly sha: string; readonly after: string },
    ): Promise<FlowVerbOutcome> => {
      const environment = flow.environmentInputs.find(
        (entry) => entry.projectId === projectId,
      )?.environment;
      if (environment === undefined) return Promise.resolve(refused(NOT_READ_YET));
      return run(
        { kind: "redeploy", groupId: flow.groupId, projectId, service: deploy.service },
        (orgId) => ({
          kind: "redeploy",
          orgId,
          appId: flow.groupId,
          projectId,
          environment,
          ...deploy,
        }),
        false,
      );
    },
    [run],
  );

  const addService = useCallback(
    (flow: ZeropsProjectFlow, projectId: string, service: string): Promise<FlowVerbOutcome> => {
      const environment = flow.environmentInputs.find(
        (entry) => entry.projectId === projectId,
      )?.environment;
      if (environment === undefined) return Promise.resolve(refused(NOT_READ_YET));
      return run(
        { kind: "add-service", groupId: flow.groupId, projectId, service },
        (orgId) => ({
          kind: "add-service",
          orgId,
          appId: flow.groupId,
          projectId,
          environment,
          service,
        }),
        false,
      );
    },
    [run],
  );

  return useMemo(
    () => ({ pending, trouble, release, rollBack, merge, close, redeploy, addService }),
    [addService, close, merge, pending, redeploy, release, rollBack, trouble],
  );
}
