import { Button } from "../ui/button";
import type { useQuestionAttachments } from "./useQuestionAttachments";

export function ComposerQuestionAttachments(props: {
  readonly questionAttachments?: ReturnType<typeof useQuestionAttachments> | undefined;
}) {
  return (
    <>
      {props.questionAttachments?.current.map(({ attachment }) => (
        <div key={attachment.id} className="flex items-center gap-2 px-3 pb-2">
          <span>{attachment.name}</span>
          <span>
            {props.questionAttachments?.uploads[attachment.id]?.status === "ready"
              ? "Attached to this answer"
              : props.questionAttachments?.uploads[attachment.id]?.status === "failed"
                ? "Upload failed"
                : "Uploading"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${attachment.name} from this answer`}
            onClick={() => props.questionAttachments?.remove(attachment.id)}
          >
            Remove
          </Button>
          {props.questionAttachments?.uploads[attachment.id]?.status === "failed" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => props.questionAttachments?.retry(attachment.id)}
            >
              Retry upload
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
