import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

// Header row shown when older turns exist beyond the loaded window. A quiet press; while the
// turns are on their way it holds its words and shows the kit's spinner beside them.
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
          {loading ? <Spinner aria-label="Earlier turns" /> : null}
          Load earlier turns
        </Button>
      </div>
    </div>
  );
}
