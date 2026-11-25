import { MessageCircle, X } from "lucide-react";

import {
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import { cn } from "~/lib/utils";

interface ComposerPendingReviewCommentsProps {
  comments: ReadonlyArray<ReviewCommentContext>;
  onRemove: (commentId: string) => void;
  className?: string;
}

export function ComposerPendingReviewComments({
  comments,
  onRemove,
  className,
}: ComposerPendingReviewCommentsProps) {
  if (comments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {comments.map((comment) => {
        const label = `${comment.filePath} ${comment.rangeLabel}`;
        const chip = (
          <span key={comment.id} className={cn(COMPOSER_INLINE_CHIP_CLASS_NAME, "pr-1")}>
            <MessageCircle className={cn(COMPOSER_INLINE_CHIP_ICON_CLASS_NAME, "size-3.5")} />
            <span className={COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME}>{label}</span>
            <Button
              variant="ghost-muted"
              size="icon-2xs"
              aria-label={`Remove comment on ${label}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove(comment.id);
              }}
            >
              <X aria-hidden />
            </Button>
          </span>
        );
        if (comment.text.length === 0) return chip;
        return (
          <Tooltip key={comment.id}>
            <TooltipTrigger render={chip} />
            <TooltipPopup side="top">
              <span className="whitespace-pre-wrap">{comment.text}</span>
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}
