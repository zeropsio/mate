import { Button } from "../ui/button";

// Header row shown when older turns exist beyond the loaded window. A quiet
// press, no spinner animation; the label change is the loading indicator.
export function TimelineLoadEarlierHeader({
  loading,
  onLoadEarlier,
  fade,
}: {
  loading: boolean;
  onLoadEarlier: () => void;
  fade: boolean;
}) {
  return (
    <div className={fade ? "pt-10 sm:pt-12" : "pt-3 sm:pt-4"}>
      <div className="mx-auto w-full max-w-3xl pb-2">
        <Button
          variant="ghost-muted"
          size="sm"
          className="w-full"
          onClick={onLoadEarlier}
          disabled={loading}
        >
          {loading ? "Loading earlier turns…" : "Load earlier turns"}
        </Button>
      </div>
    </div>
  );
}
