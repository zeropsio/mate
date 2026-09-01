import type { ReactNode } from "react";

import { Button } from "../ui/button";

interface FileBrowserPanelStateInput {
  readonly hasData: boolean;
  readonly error: string | null;
  readonly isPending: boolean;
}

type FileBrowserPanelViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string; readonly retryPending: boolean }
  | { readonly kind: "ready" };

export function resolveFileBrowserPanelState(
  input: FileBrowserPanelStateInput,
): FileBrowserPanelViewState {
  if (input.hasData) return { kind: "ready" };
  if (input.error !== null) {
    return {
      kind: "error",
      message: input.error,
      retryPending: input.isPending,
    };
  }
  return { kind: "loading" };
}

export function FileBrowserPanelState(
  props: FileBrowserPanelStateInput & {
    readonly children: ReactNode;
    readonly onRetry: () => void;
  },
) {
  const state = resolveFileBrowserPanelState(props);
  if (state.kind === "ready") return props.children;
  if (state.kind === "loading") {
    return (
      <div
        role="status"
        className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
      >
        Loading files…
      </div>
    );
  }

  return (
    <div role="alert" className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-start gap-3">
        <p className="text-xs leading-relaxed text-destructive">{state.message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={state.retryPending}
          aria-busy={state.retryPending || undefined}
          onClick={props.onRetry}
        >
          {state.retryPending ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  );
}
