import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  makeOutcomePresentation,
  presentOutcomes,
  recoveryOutcome,
  recoveryPreparationFailure,
  restartWay,
  type RecoveryOutcome,
} from "@t3tools/client-runtime/data";
import type { TargetKey } from "@t3tools/client-runtime/zerops/environments";
import { useContext, useEffect } from "react";
import { useAccountDataOptional, type AccountData } from "./accountData";
import { useAccountOperations } from "./accountOperations";
import { currentAccountEpoch } from "./accountLifetime";
import { sameValue } from "~/lib/sameValue";
import { randomUUID } from "~/lib/utils";
import { intendContainer, readContainerInitAt } from "./zeropsContainers";

type RecoveryOrigin = "recovery" | "restart-confirmation" | "deploy-confirmation";
interface Invocation {
  readonly requestId: string;
  readonly origin: string;
  readonly slot: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly action: "start" | "restart" | "redeploy";
  readonly preparationFailure?: string;
}
const originKey = (kind: RecoveryOrigin, orgId: string | null, projectId: string) =>
  `${kind}:${orgId}/${projectId}`;
function makeOwner(data: AccountData["data"] | undefined) {
  const presentation = makeOutcomePresentation<Invocation>();
  // Who shows them moves with every switch of project: the same items are no news to a reader.
  const placements = Atom.make((get) =>
    data === undefined
      ? []
      : presentOutcomes(
          get(presentation.invocations),
          (invocation) =>
            invocation.preparationFailure === undefined
              ? get(data.project(recoveryOutcome, invocation))
              : recoveryPreparationFailure(invocation.action, invocation.preparationFailure),
          get(presentation.origins),
          get(presentation.dismissed),
        ),
  ).pipe(Atom.withEquality(sameValue));
  return { ...presentation, placements };
}
const owners = new WeakMap<AccountData["data"], ReturnType<typeof makeOwner>>();
const EMPTY = makeOwner(undefined);
function ownerOf(data: AccountData["data"] | undefined) {
  if (data === undefined) return EMPTY;
  let owner = owners.get(data);
  if (owner === undefined) {
    owner = makeOwner(data);
    owners.set(data, owner);
  }
  return owner;
}
export function useOwner() {
  const account = useAccountDataOptional();
  return { account, owner: ownerOf(account?.data), registry: useContext(RegistryContext) };
}

interface RecoveryTarget {
  readonly key: TargetKey;
  readonly projectId: string;
  readonly serviceId: string;
  readonly status: string | undefined;
  readonly name: string;
  readonly projectStatus?: string;
}

/** The command reads the same owner verdict as every renderer, including on a repeated press. */
export function useRecoveryCommand(origin: RecoveryOrigin) {
  const { account, owner, registry } = useOwner();
  const operations = useAccountOperations();
  return async (target: RecoveryTarget, action: "start" | "restart" | "redeploy") => {
    if (account?.orgId == null) throw new Error("No organization is open.");
    const { orgId } = account;
    const epoch = currentAccountEpoch();
    const prior = registry
      .get(owner.invocations)
      .findLast(
        (item) =>
          item.orgId === orgId &&
          item.action === action &&
          item.projectId === target.projectId &&
          item.serviceId === target.serviceId,
      );
    if (prior !== undefined) {
      const verdict = registry
        .get(owner.placements)
        .find((item) => item.invocation.requestId === prior.requestId)?.outcome;
      if (verdict?.retry.action?.kind === "retry") {
        await operations.askAgain(prior.requestId);
        return { requestId: prior.requestId, progress: operations.readProgress(prior.requestId) };
      }
      if (verdict !== undefined && !verdict.terminal && verdict.retry.action === null)
        return { requestId: prior.requestId, progress: operations.readProgress(prior.requestId) };
    }
    const requestId = randomUUID();
    const originId = originKey(origin, orgId, target.projectId);
    const invocation: Invocation = {
      requestId,
      origin: originId,
      slot: `${originId}/${action}/${target.serviceId}`,
      orgId,
      projectId: target.projectId,
      serviceId: target.serviceId,
      name: target.name,
      action,
    };
    registry.set(owner.invocations, [...registry.get(owner.invocations), invocation]);
    let initAt: string | null;
    try {
      initAt = action === "restart" ? await readContainerInitAt(target.key) : null;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The container could not be read.";
      registry.set(
        owner.invocations,
        registry
          .get(owner.invocations)
          .map((item) =>
            item.requestId === requestId ? { ...item, preparationFailure: reason } : item,
          ),
      );
      return { requestId, progress: { stage: "unsent", next: "send-again", reason } as const };
    }
    if (epoch !== currentAccountEpoch())
      throw new Error("The account changed before the request was sent.");
    const result = await operations.submit(
      action === "redeploy"
        ? {
            kind: "mate-deploy",
            orgId,
            projectId: target.projectId,
            serviceId: target.serviceId,
          }
        : action === "restart"
          ? {
              kind: "mate-restart",
              orgId,
              projectId: target.projectId,
              serviceId: target.serviceId,
              way: restartWay(target.status),
            }
          : target.projectStatus === "STOPPED"
            ? { kind: "start-project", orgId, projectId: target.projectId }
            : {
                kind: "start-service",
                orgId,
                projectId: target.projectId,
                serviceId: target.serviceId,
              },
      requestId,
    );
    if (
      epoch === currentAccountEpoch() &&
      action === "restart" &&
      (result.progress.stage === "accepted" ||
        result.progress.stage === "reflected" ||
        (result.progress.stage === "done" && result.progress.outcome === "succeeded"))
    )
      intendContainer(target.key, { kind: "restart", initAt });
    return result;
  };
}

/** Local demand transfers primary presentation; it does not own or dispose the operation. */
export function useRecoveryFeedback(projectId: string | null, origin: RecoveryOrigin = "recovery") {
  const { account, owner, registry } = useOwner();
  const key = projectId === null ? null : originKey(origin, account?.orgId ?? null, projectId);
  const placements = useAtomValue(owner.placements);
  useEffect(() => {
    if (key === null) return;
    const change = (by: number) => {
      const next = new Map(registry.get(owner.origins));
      const count = (next.get(key) ?? 0) + by;
      if (count === 0) next.delete(key);
      else next.set(key, count);
      registry.set(owner.origins, next);
    };
    change(1);
    return () => change(-1);
  }, [key, owner, registry]);
  const items = placements.filter((item) => item.invocation.origin === key);
  return { items };
}

export type Placement = ReturnType<typeof presentOutcomes<Invocation, RecoveryOutcome>>[number];
