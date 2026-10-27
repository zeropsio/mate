export function ReviewCommentDiffLoading({ patch }: { patch: string }) {
  return (
    <div className="space-y-2">
      <div role="status" className="text-xs text-muted-foreground">
        Loading diff...
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted/40 p-2 text-xs">{patch}</pre>
    </div>
  );
}
