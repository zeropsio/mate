import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Loading } from "../ui/loading";
import { Skeleton } from "../ui/skeleton";

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
    // Where the tree's rows paint, never centred: a few names of a tree's lengths.
    return (
      <div className="min-h-0 flex-1 px-3 py-2.5">
        <Loading label="The files">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="ms-4 h-3 w-32" />
            <Skeleton className="ms-4 h-3 w-20" />
            <Skeleton className="h-3 w-40" />
          </div>
        </Loading>
      </div>
    );
  }

  return (
    <div role="alert" className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="flex max-w-sm flex-col items-start gap-3">
        <p className="text-caption leading-relaxed text-foreground">{state.message}</p>
        <Button
          type="button"
          variant="secondary"
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
