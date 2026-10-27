import { toastManager } from "~/components/ui/toast";
import { stackedThreadToast } from "~/components/ui/toastHelpers";

/** What the shell shows of one outcome: a floating notification, never a region in the page. */
export interface RecoveryToast {
  readonly type: "success" | "error" | "warning" | "loading";
  readonly title: string;
  readonly description: string | undefined;
  readonly action: { readonly label: string; readonly run: () => void };
  /** The person closed it. */
  readonly onDismiss: () => void;
}
export interface RecoveryToastSink {
  readonly show: (requestId: string, toast: RecoveryToast) => void;
  readonly close: (requestId: string) => void;
}

function appToastSink(): RecoveryToastSink {
  const open = new Map<string, RecoveryToast>();
  const toastId = (requestId: string) => `recovery-${requestId}`;
  return {
    show: (requestId, toast) => {
      const options = stackedThreadToast({
        type: toast.type,
        title: toast.title,
        // null, not undefined: an update omits undefined keys and would keep the old details.
        description: toast.description ?? null,
        timeout: 0,
        actionProps: {
          children: toast.action.label,
          onClick: () => open.get(requestId)?.action.run(),
          // Focus on the action holds a success's five visible seconds, as it held the strip's.
          ...({ "data-recovery-request": requestId } as object),
        },
        data: { hideCopyButton: toast.type !== "error" },
      });
      if (open.has(requestId)) {
        open.set(requestId, toast);
        toastManager.update(toastId(requestId), options);
        return;
      }
      open.set(requestId, toast);
      toastManager.add({
        ...options,
        id: toastId(requestId),
        onClose: () => {
          const latest = open.get(requestId);
          if (latest === undefined) return;
          open.delete(requestId);
          latest.onDismiss();
        },
      });
    },
    close: (requestId) => {
      if (!open.delete(requestId)) return;
      toastManager.close(toastId(requestId));
    },
  };
}
/** Each outcome is one app toast, keyed by its requestId and closed when the owner drops it. */
export const appRecoveryToasts = appToastSink();
