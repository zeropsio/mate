import { CatchBoundary } from "@tanstack/react-router";
import { createContext, lazy, Suspense, use, useMemo, useState, type ReactNode } from "react";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { Button } from "../ui/button";
import { ReviewCommentDiffLoading } from "./ReviewCommentDiffLoading";

const loadDiffRenderer = () => import("./ReviewCommentDiffRenderer");

const DiffFailureContext = createContext<{ rawPatch: ReactNode; retry: () => void } | null>(null);

function DiffFailure() {
  const failure = use(DiffFailureContext);
  if (!failure) return null;
  return (
    <div className="space-y-2">
      <div role="alert" className="text-xs text-muted-foreground">
        Could not load diff.
      </div>
      {failure.rawPatch}
      <Button variant="outline" size="sm" onClick={failure.retry}>
        Retry diff
      </Button>
    </div>
  );
}

export function ReviewCommentDiff({
  comment,
  theme,
  loadRenderer = loadDiffRenderer,
}: {
  comment: ReviewCommentContext;
  theme: "light" | "dark";
  loadRenderer?: typeof loadDiffRenderer;
}) {
  const [renderer, setRenderer] = useState(() => ({ component: lazy(loadRenderer), attempt: 0 }));
  const Renderer = renderer.component;
  const rawPatch = useMemo(
    () => <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">{comment.diff}</pre>,
    [comment.diff],
  );
  const failure = useMemo(
    () => ({
      rawPatch,
      retry: () =>
        setRenderer((current) => ({ component: lazy(loadRenderer), attempt: current.attempt + 1 })),
    }),
    [rawPatch, loadRenderer],
  );

  return (
    <DiffFailureContext value={failure}>
      <CatchBoundary
        getResetKey={() => `${comment.id}:${renderer.attempt}`}
        errorComponent={DiffFailure}
      >
        <Suspense fallback={<ReviewCommentDiffLoading patch={comment.diff} />}>
          <Renderer comment={comment} theme={theme} />
        </Suspense>
      </CatchBoundary>
    </DiffFailureContext>
  );
}
