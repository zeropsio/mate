export function ReviewCommentDiffLoading({ patch }: { patch: string }) {
  return (
    <div className="space-y-2">
      <div role="status" className="text-caption text-muted-foreground">
        Loading diff...
      </div>
      <pre className="overflow-x-auto rounded-control bg-muted/40 p-2 text-caption">{patch}</pre>
    </div>
  );
}
