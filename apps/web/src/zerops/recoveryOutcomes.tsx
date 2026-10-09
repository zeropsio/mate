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
import { useContext, useEffect, useRef, useState } from "react";
import { useAccountDataOptional, type AccountData } from "./accountData";
import { useAccountOperations } from "./accountOperations";
import { currentAccountEpoch } from "./accountLifetime";
import { randomUUID } from "~/lib/utils";
import { intendContainer, readContainerInitAt } from "./zeropsContainers";
import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";

export type RecoveryOrigin = "recovery" | "restart-confirmation";
interface Invocation {
  readonly requestId: string;
  readonly origin: string;
  readonly slot: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly action: "start" | "restart";
  readonly preparationFailure?: string;
}
const originKey = (kind: RecoveryOrigin, orgId: string | null, projectId: string) =>
  `${kind}:${orgId}/${projectId}`;
function makeOwner(data: AccountData["data"] | undefined) {
  const presentation = makeOutcomePresentation<Invocation>();
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
  );
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
function useOwner() {
  const account = useAccountDataOptional();
  return { account, owner: ownerOf(account?.data), registry: useContext(RegistryContext) };
}

export interface RecoveryTarget {
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
  return async (target: RecoveryTarget, action: "start" | "restart") => {
    if (account?.orgId == null) throw new Error("No organization is open.");
    const { orgId } = account;
    const epoch = currentAccountEpoch();
    const prior = registry
      .get(owner.invocations)
      .findLast(
        (item) =>
          item.orgId === orgId &&
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
      action === "restart"
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

type Placement = ReturnType<typeof presentOutcomes<Invocation, RecoveryOutcome>>[number];
export function RecoveryItems({
  items,
  onRetry,
  actions = true,
}: {
  readonly items: ReadonlyArray<Placement>;
  readonly actions?: boolean;
  readonly onRetry?: ((action: "start" | "restart") => void) | undefined;
}) {
  const operations = useAccountOperations();
  const { owner, registry } = useOwner();
  return (
    <div className="grid gap-2">
      {items.map(({ invocation, outcome }) => (
        <div
          key={invocation.requestId}
          role="status"
          aria-live="off"
          data-recovery-request={invocation.requestId}
          className="flex flex-wrap items-center gap-2"
        >
          <span>
            {invocation.name}: {outcome.text} {outcome.details}
          </span>
          {actions && outcome.retry.action?.kind === "retry" ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void operations.askAgain(invocation.requestId)}
            >
              {outcome.retry.label}
            </Button>
          ) : null}
          {actions && outcome.retry.action?.kind === "submit" && onRetry !== undefined ? (
            <Button size="compact" variant="ghost" onClick={() => onRetry(invocation.action)}>
              {outcome.retry.label}
            </Button>
          ) : null}
          {actions && onRetry === undefined ? (
            <Link to="/mate/$projectId" params={{ projectId: invocation.projectId }}>
              Open {invocation.name}
            </Link>
          ) : null}
          {actions && outcome.terminal ? (
            <Button
              size="compact"
              variant="ghost"
              aria-label={`Dismiss ${invocation.name}'s ${invocation.action} result`}
              onClick={() =>
                registry.set(
                  owner.dismissed,
                  new Set([...registry.get(owner.dismissed), invocation.requestId]),
                )
              }
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The signed-in composition owns the fallback for origins that released their presentation. */
export function RecoveryOutcomeStatus() {
  const { account, owner, registry } = useOwner();
  const [expanded, setExpanded] = useState(false);
  const placements = useAtomValue(owner.placements);
  useEffect(() => {
    const retained = new Set(placements.map((item) => item.invocation.requestId));
    const before = registry.get(owner.invocations);
    const next = before.filter((item) => retained.has(item.requestId));
    if (next.length !== before.length) registry.set(owner.invocations, next);
    const dismissed = registry.get(owner.dismissed);
    if (dismissed.size > 0)
      registry.set(owner.dismissed, new Set([...dismissed].filter((id) => retained.has(id))));
  }, [owner, registry, placements]);
  const items = placements.filter(
    (item) => item.primary === "shell" && item.invocation.orgId === account?.orgId,
  );
  return (
    <>
      <RecoveryAnnouncements items={placements} />
      {placements
        .filter((item) => item.outcome.succeeded)
        .map((item) => (
          <RecoverySuccessExpiry
            key={item.invocation.requestId}
            item={item}
            visible={
              item.invocation.orgId === account?.orgId &&
              (item.primary !== "shell" || expanded || item === items.at(-1))
            }
          />
        ))}
      <div
        className="max-h-40 min-h-10 shrink-0 overflow-y-auto px-4 py-2"
        aria-label="Recovery results"
      >
        <RecoveryItems items={expanded ? items : items.slice(-1)} />
        {items.length > 1 ? (
          <Button size="compact" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : `${items.length} recovery results`}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** Five visible seconds expire only success feedback, never the operation's outcome. */
function RecoverySuccessExpiry({
  item,
  visible,
}: {
  readonly item: Placement;
  readonly visible: boolean;
}) {
  const { owner, registry } = useOwner();
  const remaining = useRef(5_000);
  const requestId = item.invocation.requestId;
  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let since: number | undefined;
    const pause = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (since !== undefined) remaining.current -= Date.now() - since;
      since = undefined;
    };
    const schedule = () => {
      pause();
      if (
        !visible ||
        document.visibilityState === "hidden" ||
        document.activeElement?.closest(`[data-recovery-request="${requestId}"]`)
      )
        return;
      since = Date.now();
      timer = setTimeout(
        () => registry.set(owner.dismissed, new Set([...registry.get(owner.dismissed), requestId])),
        Math.max(0, remaining.current),
      );
    };
    document.addEventListener("visibilitychange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    schedule();
    return () => {
      pause();
      document.removeEventListener("visibilitychange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, [owner, registry, requestId, visible, item.primary]);
  return null;
}

/** Only changed owner phrases are announced; transferring presentation does not replay them. */
function RecoveryAnnouncements({ items }: { readonly items: ReadonlyArray<Placement> }) {
  const previous = useRef(new Map<string, string>());
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const next = new Map(
      items.map(({ invocation, outcome }) => [
        invocation.requestId,
        `${invocation.name}: ${outcome.text} ${outcome.details ?? ""}`,
      ]),
    );
    const changed = [...next]
      .filter(([id, text]) => previous.current.get(id) !== text)
      .map(([, text]) => text);
    const removed = [...previous.current.keys()].some((id) => !next.has(id));
    previous.current = next;
    if (changed.length > 0 || removed) setAnnouncement(changed.join(" "));
  }, [items]);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );
}
