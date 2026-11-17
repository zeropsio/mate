import { Toast, type ToastManagerAddOptions } from "@base-ui/react/toast";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";

// The toast store sits below the kit that draws it (`components/ui/toast.tsx`), so modules
// below the surfaces raise toasts without importing the kit.

export type ThreadToastData = {
  threadRef?: ScopedThreadRef | null;
  threadId?: ThreadId | null;
  leadingIcon?: ReactNode;
  tooltipStyle?: boolean;
  onClose?: (() => void) | undefined;
  dismissAfterVisibleMs?: number;
  hideCopyButton?: boolean;
  additionalActions?: ReadonlyArray<{
    id: string;
    props: ComponentPropsWithoutRef<"button">;
  }>;
  secondaryActionProps?: ComponentPropsWithoutRef<"button">;
  secondaryActionVariant?: "primary" | "secondary" | "ghost" | "destructive" | "link";
  /** Optional extra body shown after toggling “Show details” (e.g. a list of pending RPCs). */
  expandableContent?: ReactNode;
  expandableLabels?: { expand?: string; collapse?: string };
  /** When set with `expandableContent`, the summary + label act as one text disclosure (no separate chevron row). */
  expandableDescriptionTrigger?: boolean;
  actionLayout?: "inline" | "stacked-end";
  actionVariant?: "primary" | "secondary" | "ghost" | "destructive" | "link";
};

export const toastManager = Toast.createToastManager<ThreadToastData>();
export const anchoredToastManager = Toast.createToastManager<ThreadToastData>();

type StackedThreadToastOptions = {
  type: "error" | "warning" | "success" | "info" | "loading";
  title: ReactNode;
  description?: ReactNode;
  timeout?: number;
  priority?: "low" | "high";
  actionProps?: ComponentPropsWithoutRef<"button">;
  /** Merged into `data`; `actionLayout` is always forced to `"stacked-end"` by the helper. */
  actionVariant?: ThreadToastData["actionVariant"];
  data?: Omit<ThreadToastData, "actionLayout">;
};

/**
 * Defined `actionProps` that hide a previous toast CTA on `toastManager.update`.
 * Passing `actionProps: undefined` is a no-op because updates omit undefined keys.
 */
export const hiddenToastActionProps = {
  children: null,
} as const satisfies Pick<ComponentPropsWithoutRef<"button">, "children">;

/**
 * Thread toast using the stacked body + bottom action row (copy for errors, CTA on its own row).
 */
export function stackedThreadToast(
  options: StackedThreadToastOptions,
): ToastManagerAddOptions<ThreadToastData> {
  const { type, title, description, timeout, priority, actionProps, actionVariant, data } = options;

  // Helper-owned `actionLayout` must win over any caller-provided `data`, so spread
  // the caller's data first and apply `actionLayout: "stacked-end"` last.
  const mergedData: ThreadToastData = {
    ...(data !== undefined ? data : {}),
    actionLayout: "stacked-end",
  };
  if (actionVariant !== undefined) {
    mergedData.actionVariant = actionVariant;
  }

  const payload: ToastManagerAddOptions<ThreadToastData> = {
    type,
    title,
    data: mergedData,
  };

  if (description !== undefined) {
    payload.description = description;
  }
  if (timeout !== undefined) {
    payload.timeout = timeout;
  }
  if (priority !== undefined) {
    payload.priority = priority;
  }
  if (actionProps !== undefined) {
    payload.actionProps = actionProps;
  }

  return payload;
}
