import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { useAccountOperations } from "~/zerops/accountOperations";
import { useOwner, type Placement } from "~/zerops/recoveryOutcomes";
import {
  appRecoveryToasts,
  type RecoveryToast,
  type RecoveryToastSink,
} from "~/zerops/recoveryToasts";

export function RecoveryItems({
  items,
  onRetry,
  actions = true,
}: {
  readonly items: ReadonlyArray<Placement>;
  readonly actions?: boolean;
  readonly onRetry?: ((action: "start" | "restart" | "redeploy") => void) | undefined;
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
              size="sm"
              variant="ghost"
              onClick={() => void operations.askAgain(invocation.requestId)}
            >
              {outcome.retry.label}
            </Button>
          ) : null}
          {actions && outcome.retry.action?.kind === "submit" && onRetry !== undefined ? (
            <Button size="sm" variant="ghost" onClick={() => onRetry(invocation.action)}>
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
              size="sm"
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
export function RecoveryOutcomeStatus({
  toasts = appRecoveryToasts,
}: { readonly toasts?: RecoveryToastSink } = {}) {
  const { account, owner, registry } = useOwner();
  const operations = useAccountOperations();
  const navigate = useNavigate();
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
  // requestId → what its toast shows; a person-closed pending result stays closed until it changes.
  const shown = useRef(new Map<string, string>());
  const closed = useRef(new Map<string, string>());
  useEffect(() => {
    const next = new Map<string, string>();
    for (const { invocation, outcome } of items) {
      const id = invocation.requestId;
      const shape = {
        type: outcome.succeeded
          ? "success"
          : outcome.terminal
            ? "error"
            : outcome.busy
              ? "loading"
              : "warning",
        title: `${invocation.name}: ${outcome.text}`,
        description: outcome.details,
        action:
          outcome.retry.action?.kind === "retry"
            ? { label: outcome.retry.label, run: () => void operations.askAgain(id) }
            : {
                label: `Open ${invocation.name}`,
                run: () =>
                  void navigate({
                    to: "/mate/$projectId",
                    params: { projectId: invocation.projectId },
                  }),
              },
      } as const;
      const key = JSON.stringify([shape.type, shape.title, shape.description, shape.action.label]);
      const toast: RecoveryToast = {
        ...shape,
        // Dismissing a settled result is the person's; a pending one only hides until it changes.
        onDismiss: () => {
          shown.current.delete(id);
          if (outcome.terminal)
            registry.set(owner.dismissed, new Set([...registry.get(owner.dismissed), id]));
          else closed.current.set(id, key);
        },
      };
      if (closed.current.get(id) === key) continue;
      closed.current.delete(id);
      next.set(id, key);
      if (shown.current.get(id) !== key) toasts.show(id, toast);
    }
    for (const id of shown.current.keys()) if (!next.has(id)) toasts.close(id);
    for (const id of closed.current.keys())
      if (!items.some((item) => item.invocation.requestId === id)) closed.current.delete(id);
    shown.current = next;
  });
  useEffect(
    () => () => {
      for (const id of shown.current.keys()) toasts.close(id);
      shown.current = new Map();
    },
    [toasts],
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
            visible={item.invocation.orgId === account?.orgId}
          />
        ))}
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
