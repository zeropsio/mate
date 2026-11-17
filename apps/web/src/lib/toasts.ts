import { Toast } from "@base-ui/react/toast";
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
