import { useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";

import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";

function ReviewSheetOpener() {
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)} ref={from} variant="secondary">
        Review a change
      </Button>
      <ZeropsReviewDialog
        from={from.current}
        labelledBy="kit-review-title"
        onClosed={() => {}}
        onOpenChange={setOpen}
        open={open}
      >
        <div className="flex flex-col gap-2 p-8">
          <h2 className="m-0 font-semibold text-title" id="kit-review-title">
            Add the changelog page
          </h2>
          <p className="m-0 text-muted-foreground text-body">
            The review's own pages fill this sheet: the change, its comments, its release steps.
          </p>
        </div>
      </ZeropsReviewDialog>
    </>
  );
}

export default defineKitSection({
  id: "review-sheet",
  title: "ZeropsReviewDialog",
  purpose:
    "The sheet a change is reviewed and released in: it grows from what opened it, holds while it reads, and its Escape steps back a layer before it closes.",
  group: "Chosen",
  kind: "Overlays",
  source: "apps/web/src/components/zerops/review/ZeropsReviewDialog.tsx",
  render: () => (
    <Specimen label="<ZeropsReviewDialog from labelledBy>">
      <ReviewSheetOpener />
    </Specimen>
  ),
});
