import { CatchBoundary } from "@tanstack/react-router";
import { createContext, lazy, Suspense, use, useMemo, useState, type ReactNode } from "react";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { Button } from "../ui/button";
import { ReviewCommentDiffLoading } from "./ReviewCommentDiffLoading";
import { Text } from "~/components/ui/text";
import { Card } from "~/components/ui/card";

const loadDiffRenderer = () => import("./ReviewCommentDiffRenderer");

const DiffFailureContext = createContext<{ rawPatch: ReactNode; retry: () => void } | null>(null);

function DiffFailure() {
  const failure = use(DiffFailureContext);
  if (!failure) return null;
  return (
    <div className="space-y-2">
      <Text render={<div />} variant="note" role="alert">
        Could not load diff.
      </Text>
      {failure.rawPatch}
      <Button variant="secondary" size="sm" onClick={failure.retry}>
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
    () => (
      <Card variant="inset">
        <pre className="overflow-x-auto p-2 text-caption">{comment.diff}</pre>
      </Card>
    ),
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
